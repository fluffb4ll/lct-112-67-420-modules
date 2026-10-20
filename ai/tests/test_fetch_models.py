"""ai/docker/fetch-models.sh: проверка sha256, отметка о проверке, старый .part, ответ 416.

Скрипт гоняется на этой машине (sh, curl, sha256sum) против зеркала file:// во временном
каталоге — сеть не нужна. В compose он работает в образе curlimages/curl (busybox).
"""

import hashlib
import os
import subprocess
import time
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "docker" / "fetch-models.sh"
WHISPER = "Systran/faster-whisper-small/resolve/main"
PIPER = "rhasspy/piper-voices/resolve/main/ru/ru_RU"
LLM = b"llm-weights"


def mirror(root: Path) -> None:
    root.mkdir(parents=True)
    (root / "llm.gguf").write_bytes(LLM)
    for f in ("model.bin", "config.json", "tokenizer.json", "vocabulary.txt"):
        path = root / WHISPER / f
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f)
    for v in ("irina", "denis"):
        for ext in ("onnx", "onnx.json"):
            path = root / PIPER / v / "medium" / f"ru_RU-{v}-medium.{ext}"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(ext)


def fetch(tmp_path: Path, path_prefix: str = "", **overrides: str | None) -> str:
    out = tmp_path / "out"
    env: dict[str, str | None] = {
        "PATH": path_prefix + os.environ.get("PATH", "/usr/bin:/bin") + ":/sbin:/usr/sbin",
        "DDS_HF_BASE": f"file://{tmp_path / 'mirror'}",
        "DDS_MODELS_DIR": str(out),
        "DDS_LLM_MODEL_URL": f"file://{tmp_path / 'mirror' / 'llm.gguf'}",
        "DDS_LLM_MODEL_PATH": str(out / "llm" / "model.gguf"),
        "DDS_LLM_MODEL_SHA256": hashlib.sha256(LLM).hexdigest(),
        **overrides,
    }
    r = subprocess.run(
        ["sh", str(SCRIPT)],
        env={k: v for k, v in env.items() if v is not None},
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    )
    return r.stdout


def test_hash_checked_once_and_mismatch_deleted(tmp_path):
    mirror(tmp_path / "mirror")
    out = tmp_path / "out"
    first = fetch(tmp_path)
    llm = out / "llm" / "model.gguf"
    assert llm.read_bytes() == LLM
    assert (out / "llm" / "model.gguf.sha256").read_text().split() == [
        hashlib.sha256(LLM).hexdigest(),
        str(len(LLM)),
    ]
    # у зеркала не те файлы, что у Systran/rhasspy: хеш не совпал — файла нет
    assert "sha256 не совпал" in first
    assert not (out / "whisper-small" / "model.bin").exists()
    assert not (out / "piper" / "ru_RU-irina-medium.onnx").exists()

    second = fetch(tmp_path)
    assert f"проверяю sha256 {llm}" not in second  # отметка совпала — гигабайт не считаем

    llm.write_bytes(b"broken")
    third = fetch(tmp_path)
    assert f"sha256 не совпал: {llm}" in third
    assert llm.read_bytes() == LLM  # скачан заново
    assert llm.with_name("model.gguf.bad").read_bytes() == b"broken"  # лежавший файл не стёрт

    bad = llm.with_name("model.gguf.bad")
    fourth = fetch(tmp_path)  # .bad мог быть своей моделью: живёт неделю, лог напоминает
    assert f"лежит {bad}" in fourth and bad.read_bytes() == b"broken"
    old = time.time() - 8 * 86400
    os.utime(bad, (old, old))
    fifth = fetch(tmp_path)
    assert f"удаляю {bad}" in fifth and not bad.exists()
    assert llm.read_bytes() == LLM


def test_our_mismatched_file_is_deleted_not_kept(tmp_path):
    mirror(tmp_path / "mirror")
    cfg = tmp_path / "out" / "whisper-small" / "config.json"
    cfg.parent.mkdir(parents=True)
    cfg.write_text("stale")
    log = fetch(tmp_path)
    assert f"sha256 не совпал: {cfg} — удаляю" in log
    assert not cfg.with_name("config.json.bad").exists()


def test_stale_part_is_discarded(tmp_path):
    mirror(tmp_path / "mirror")
    part = tmp_path / "out" / "llm" / "model.gguf.part"
    part.parent.mkdir(parents=True)
    part.write_bytes(b"old-version-")
    old = time.time() - 3 * 86400
    os.utime(part, (old, old))
    log = fetch(tmp_path)
    assert "старый недокачанный" in log
    assert (tmp_path / "out" / "llm" / "model.gguf").read_bytes() == LLM


def test_own_model_is_never_destroyed(tmp_path):
    mirror(tmp_path / "mirror")
    out = tmp_path / "out"
    # своя модель по своему пути при URL по умолчанию: хеш Qwen к ней не применяется
    own = out / "own" / "mine.gguf"
    own.parent.mkdir(parents=True)
    own.write_bytes(b"my-model")
    fetch(tmp_path, DDS_LLM_MODEL_URL=None, DDS_LLM_MODEL_SHA256=None, DDS_LLM_MODEL_PATH=str(own))
    assert own.read_bytes() == b"my-model"
    # своя модель по пути по умолчанию: не сошлась с Qwen — отложена в .bad, а не удалена
    default = out / "llm" / "model.gguf"
    default.parent.mkdir(parents=True)
    default.write_bytes(b"my-model")
    old = time.time() - 30 * 86400  # модель старая, но срок .bad — от отложения
    os.utime(default, (old, old))
    defaults = {"DDS_LLM_MODEL_URL": None, "DDS_LLM_MODEL_SHA256": None, "DDS_LLM_MODEL_PATH": None}
    fetch(tmp_path, **defaults)
    bad = default.with_name("model.gguf.bad")
    assert bad.read_bytes() == b"my-model"
    # следующие запуски (в том числе без проверки хеша) свою модель не удаляют
    log = fetch(tmp_path, **defaults)
    assert f"лежит {bad}" in log and bad.read_bytes() == b"my-model"
    fetch(tmp_path, DDS_FETCH_VERIFY="0", **defaults)
    assert bad.read_bytes() == b"my-model"


# curl: на докачку (-C -) уже целого или чужого .part сервер отвечает 416, curl выходит с 0
# и тело не пишет; у file:// кода ответа нет, поэтому HTTP изображает заглушка
FAKE_CURL = """#!/bin/sh
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out=$2; shift ;;
    -C|-w|--retry|--retry-delay|--connect-timeout) shift ;;
    -*) ;;
    *) url=$1 ;;
  esac
  shift
done
if [ -f "$out" ]; then printf 416; exit 0; fi
cp "${url#file://}" "$out" 2>/dev/null || { printf 404; exit 22; }
printf 200
"""


def test_416_on_resume_downloads_again(tmp_path):
    mirror(tmp_path / "mirror")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "curl").write_text(FAKE_CURL)
    (bin_dir / "curl").chmod(0o755)
    part = tmp_path / "out" / "llm" / "model.gguf.part"
    part.parent.mkdir(parents=True)
    part.write_bytes(b"other-version-longer-than-file")
    # без проверки хеша: 416 не должен давать чужой .part под именем модели
    log = fetch(tmp_path, f"{bin_dir}:", DDS_FETCH_VERIFY="0")
    assert "(416)" in log
    assert (tmp_path / "out" / "llm" / "model.gguf").read_bytes() == LLM
    assert not part.exists()


FAILING_MV = """#!/bin/sh
exit 1
"""


def test_failed_move_is_logged_and_nothing_is_overwritten(tmp_path):
    mirror(tmp_path / "mirror")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "mv").write_text(FAILING_MV)
    (bin_dir / "mv").chmod(0o755)
    llm = tmp_path / "out" / "llm" / "model.gguf"
    log = fetch(tmp_path, f"{bin_dir}:")
    assert f"не удалось переместить {llm}.part в {llm}" in log
    assert not llm.exists()
    # своя модель не отложилась в .bad — поверх неё не качаем
    llm.write_bytes(b"my-model")
    log = fetch(tmp_path, f"{bin_dir}:")
    assert f"не удалось переименовать {llm} в {llm}.bad" in log
    assert "не скачиваю поверх" in log and llm.read_bytes() == b"my-model"
