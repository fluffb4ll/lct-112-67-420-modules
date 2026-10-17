"""ai/docker/fetch-models.sh: проверка sha256, отметка о проверке, старый .part.

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


def fetch(tmp_path: Path) -> str:
    out = tmp_path / "out"
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin") + ":/sbin:/usr/sbin",
        "DDS_HF_BASE": f"file://{tmp_path / 'mirror'}",
        "DDS_MODELS_DIR": str(out),
        "DDS_LLM_MODEL_URL": f"file://{tmp_path / 'mirror' / 'llm.gguf'}",
        "DDS_LLM_MODEL_PATH": str(out / "llm" / "model.gguf"),
        "DDS_LLM_MODEL_SHA256": hashlib.sha256(LLM).hexdigest(),
    }
    r = subprocess.run(
        ["sh", str(SCRIPT)], env=env, capture_output=True, text=True, timeout=60, check=True
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
