"""Голос для фронта: распознавание (`POST /v1/stt`) и синтез (`POST /v1/tts`) на сервере.

Речь не уходит в облако: STT — faster-whisper (CTranslate2, CPU), TTS — Piper (onnxruntime, CPU).
Модели грузятся лениво при первом запросе, чтобы сервис поднимался быстро и без них.

Настройка окружением:
  DDS_STT_MODEL        — размер модели faster-whisper («small», «base»…) или путь к каталогу
                         с весами; пусто — STT выключен. Веса по имени скачиваются один раз
                         в HF_HOME (в compose это том /models), дальше работают офлайн.
  DDS_TTS_VOICE_PATH   — путь к женскому голосу Piper (`*.onnx`, рядом `*.onnx.json`);
                         пусто — TTS выключен.
  DDS_TTS_VOICE_PATH_MALE — путь к мужскому голосу; пусто — мужские реплики женским голосом.
  DDS_TTS_VOICE_URL, DDS_TTS_VOICE_URL_MALE — откуда скачать голос, если файла нет
                         (по умолчанию rhasspy/piper-voices: irina и denis).
  DDS_STT_MAX_BYTES    — предел размера записи, байт (по умолчанию 10 МБ; больше — 413).
  DDS_STT_MAX_SECONDS  — предел длительности записи, с (по умолчанию 120; больше — 422).
  DDS_VOICE_LOCK_TIMEOUT_S — сколько ждать, пока модель занята другой записью или фразой
                         (по умолчанию 15 с; дольше — 503 «занято, повторите»).

Модели STT и TTS грузятся под разными блокировками: долгая докачка голоса Piper не держит
распознавание. Неудачная загрузка запоминается на `RETRY_LOAD_AFTER_S` (60 с): за это время
запросы сразу получают 503, `/v1/voice` показывает модель недоступной; потом — новая попытка
(том с моделями могли докачать, не перезапуская сервис).

Нет модели, нет пакета, сбой — `VoiceUnavailable`; фронт откатывается на Web Speech или ввод
текстом (`frontend/src/training/voice.ts`).
"""

from __future__ import annotations

import io
import logging
import os
import threading
import time
import urllib.request
import wave
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

from ..ports import STTProvider, TTSProvider
from ..voice.normalize import normalize_for_tts
from ..voice.stt import AudioTooLong

log = logging.getLogger(__name__)

PIPER_VOICES = "https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU"
DEFAULT_VOICE_URLS = {
    "female": f"{PIPER_VOICES}/irina/medium/ru_RU-irina-medium.onnx",
    "male": f"{PIPER_VOICES}/denis/medium/ru_RU-denis-medium.onnx",
}
_ENV_SUFFIX = {"female": "", "male": "_MALE"}
DEFAULT_MAX_AUDIO_BYTES = 10 * 1024 * 1024
DEFAULT_MAX_AUDIO_SECONDS = 120.0
MAX_TTS_CHARS = 600
# Подсказки распознаванию (адрес, тип происшествия, ключевые слова доклада) идут в
# initial_prompt whisper, а у него окно ~224 токена: длинный список обрезаем, а не роняем запрос.
STT_MAX_HINTS = 12
STT_HINT_MAX_CHARS = 60
STT_HINTS_MAX_CHARS = 300
DEFAULT_VOICE_LOCK_TIMEOUT_S = 15.0
RETRY_LOAD_AFTER_S = 60.0


class VoiceUnavailable(RuntimeError):
    pass


class VoiceBusy(VoiceUnavailable):
    """Модель занята другим запросом дольше срока ожидания — 503, можно повторить."""


class AudioTooLarge(ValueError):
    """Запись больше предела по размеру — 413."""

    def __init__(self, limit: int):
        super().__init__(f"запись больше {limit / 1024 / 1024:g} МБ — сократите доклад")


def _env_num(env: dict[str, str], name: str, default: float) -> float:
    try:
        value = float(env.get(name) or default)
    except ValueError:
        log.warning("%s=%r — не число, беру %s", name, env.get(name), default)
        return default
    return value if value > 0 else default


def clean_hints(hints: Iterable[str]) -> list[str]:
    """Подсказки без пустых и повторов, каждая и весь список — в пределах длины."""
    out: list[str] = []
    seen: set[str] = set()
    total = 0
    for raw in hints:
        hint = " ".join(str(raw).split())[:STT_HINT_MAX_CHARS]
        if not hint or hint.lower() in seen:
            continue
        if len(out) >= STT_MAX_HINTS or total + len(hint) > STT_HINTS_MAX_CHARS:
            break
        seen.add(hint.lower())
        out.append(hint)
        total += len(hint) + 2  # ", " между подсказками
    return out


def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    for suffix in ("", ".json"):
        target = Path(f"{dest}{suffix}")
        if target.exists():
            continue
        tmp = target.with_name(target.name + ".part")
        log.info("downloading %s", url + suffix)
        with urllib.request.urlopen(url + suffix, timeout=60) as r, open(tmp, "wb") as f:
            while chunk := r.read(1 << 16):
                f.write(chunk)
        tmp.rename(target)


def _present(model: str) -> bool:
    """Имя модели («small») скачается при первом запросе; путь к каталогу весов должен быть.

    Для голоса Piper файл тоже может докачаться, поэтому .onnx-путь считается доступным.
    Каталог faster-whisper без `model.bin` (недокачан) — недоступен: пусть фронт сразу
    откатится на распознавание браузером, а не пишет звук впустую.
    """
    if not model:
        return False
    if os.path.isdir(model):
        return os.path.exists(os.path.join(model, "model.bin"))
    return not os.path.isabs(model) or model.endswith(".onnx") or os.path.exists(model)


class VoiceService:
    def __init__(
        self,
        *,
        stt: STTProvider | None = None,
        tts: TTSProvider | None = None,
        env: dict[str, str] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._clock = clock
        self._env = dict(os.environ if env is None else env)
        self.max_audio_bytes = int(
            _env_num(self._env, "DDS_STT_MAX_BYTES", DEFAULT_MAX_AUDIO_BYTES)
        )
        self.max_audio_seconds = _env_num(
            self._env, "DDS_STT_MAX_SECONDS", DEFAULT_MAX_AUDIO_SECONDS
        )
        self.lock_timeout_s = _env_num(
            self._env, "DDS_VOICE_LOCK_TIMEOUT_S", DEFAULT_VOICE_LOCK_TIMEOUT_S
        )
        self._stt = stt
        # голос → (адаптер, имя голоса); переданный адаптер обслуживает оба голоса
        self._tts: dict[str, tuple[TTSProvider, str]] = (
            {} if tts is None else {g: (tts, "default") for g in _ENV_SUFFIX}
        )
        # последняя ошибка загрузки и когда она случилась (по `clock`)
        self._stt_error: str | None = None
        self._stt_failed_at = 0.0
        self._tts_error: dict[str, str] = {}
        self._tts_failed_at: dict[str, float] = {}
        self._stt_load = threading.Lock()
        self._tts_load = threading.Lock()
        self._stt_run = threading.Lock()  # одна модель — одно распознавание за раз
        self._tts_run = threading.Lock()

    # --- что доступно ---

    def _recent(self, failed_at: float | None) -> bool:
        return failed_at is not None and self._clock() - failed_at < RETRY_LOAD_AFTER_S

    def _stt_down(self) -> bool:
        return self._stt_error is not None and self._recent(self._stt_failed_at)

    def _tts_down(self, gender: str) -> bool:
        return gender in self._tts_error and self._recent(self._tts_failed_at.get(gender))

    def capabilities(self) -> dict[str, Any]:
        return {
            "stt": self._stt is not None
            or (_present(self._env.get("DDS_STT_MODEL", "")) and not self._stt_down()),
            "tts": "female" in self._tts
            or (_present(self._env.get("DDS_TTS_VOICE_PATH", "")) and not self._tts_down("female")),
            "sttModel": None if self._stt is None else self._stt.model_ref.model_dump(mode="json"),
            "ttsModels": {
                g: t.model_ref.model_dump(mode="json") for g, (t, _) in self._tts.items()
            },
            "errors": {
                k: v
                for k, v in {
                    "stt": self._stt_error if self._stt_down() else None,
                    **{f"tts_{g}": e for g, e in self._tts_error.items() if self._tts_down(g)},
                }.items()
                if v
            },
        }

    # --- ленивая загрузка ---

    def _wait_load(self, lock: threading.Lock, what: str) -> None:
        # первая загрузка (и скачивание голоса) идёт под блокировкой; ждём её не дольше, чем работу
        if not lock.acquire(timeout=self.lock_timeout_s):
            raise VoiceBusy(f"{what} ещё загружается — повторите через несколько секунд")

    def _get_stt(self) -> STTProvider:
        if self._stt is not None:
            return self._stt
        self._wait_load(self._stt_load, "модель распознавания")
        try:
            return self._load_stt()
        finally:
            self._stt_load.release()

    def _load_stt(self) -> STTProvider:
        if self._stt is not None:
            return self._stt
        model = self._env.get("DDS_STT_MODEL", "")
        if not model:
            raise VoiceUnavailable("STT не настроен (DDS_STT_MODEL)")
        if self._stt_down():
            raise VoiceUnavailable(self._stt_error or "STT недоступен")
        try:
            from ..voice.stt.faster_whisper_provider import FasterWhisperSTT

            self._stt = FasterWhisperSTT(model, max_seconds=self.max_audio_seconds)
        except Exception as exc:
            self._stt_error = f"STT не загрузился: {exc}"
            self._stt_failed_at = self._clock()
            log.warning(self._stt_error)
            raise VoiceUnavailable(self._stt_error) from exc
        self._stt_error = None
        return self._stt

    def _get_tts(self, gender: str) -> tuple[TTSProvider, str]:
        if gender not in _ENV_SUFFIX:
            raise ValueError(f"неизвестный голос {gender!r}")
        if gender in self._tts:
            return self._tts[gender]
        if not self._env.get(f"DDS_TTS_VOICE_PATH{_ENV_SUFFIX[gender]}") and "female" in self._tts:
            return self._tts["female"]  # мужской голос не настроен — женский, без блокировки
        self._wait_load(self._tts_load, "голос")
        try:
            return self._load_tts(gender)
        finally:
            self._tts_load.release()

    def _load_tts(self, gender: str) -> tuple[TTSProvider, str]:
        if gender in self._tts:
            return self._tts[gender]
        suffix = _ENV_SUFFIX[gender]
        path = self._env.get(f"DDS_TTS_VOICE_PATH{suffix}", "")
        if not path or self._tts_down(gender):
            if gender != "female":
                return self._load_tts("female")  # нет мужского голоса — говорим женским
            raise VoiceUnavailable(
                self._tts_error.get(gender) or "TTS не настроен (DDS_TTS_VOICE_PATH)"
            )
        try:
            from ..voice.tts.piper_provider import PiperTTS

            p = Path(path)
            if not p.exists():
                _download(
                    self._env.get(f"DDS_TTS_VOICE_URL{suffix}") or DEFAULT_VOICE_URLS[gender], p
                )
            self._tts[gender] = (PiperTTS(str(p), voice_name=p.stem), p.stem)
            self._tts_error.pop(gender, None)
        except Exception as exc:
            self._tts_error[gender] = f"TTS ({gender}) не загрузился: {exc}"
            self._tts_failed_at[gender] = self._clock()
            log.warning(self._tts_error[gender])
            if gender != "female":
                return self._load_tts("female")
            raise VoiceUnavailable(self._tts_error[gender]) from exc
        return self._tts[gender]

    # --- работа ---

    def transcribe(self, audio: bytes, hints: list[str] | None = None) -> dict[str, Any]:
        if not audio:
            raise ValueError("пустая запись")
        if len(audio) > self.max_audio_bytes:
            raise AudioTooLarge(self.max_audio_bytes)
        stt = self._get_stt()
        if not self._stt_run.acquire(timeout=self.lock_timeout_s):
            raise VoiceBusy("сервер распознаёт другую запись — повторите через несколько секунд")
        try:
            segments = stt.transcribe(audio, hints=tuple(clean_hints(hints or ())))
        except AudioTooLong:
            raise
        except Exception as exc:
            raise VoiceUnavailable(f"распознавание не удалось: {exc}") from exc
        finally:
            self._stt_run.release()
        text = " ".join(s.text for s in segments if s.text).strip()
        conf = [s.confidence for s in segments if s.confidence is not None]
        return {
            "text": text,
            "confidence": round(sum(conf) / len(conf), 3) if conf else None,
            "model": stt.model_ref.model_dump(mode="json"),
        }

    def synthesize(self, text: str, *, voice: str = "female", intonation: str = "neutral") -> bytes:
        text = " ".join(text.split())[:MAX_TTS_CHARS]
        if not text:
            raise ValueError("пустой текст")
        tts, voice_name = self._get_tts(voice)
        if not self._tts_run.acquire(timeout=self.lock_timeout_s):
            raise VoiceBusy("сервер озвучивает другую фразу — повторите через несколько секунд")
        try:
            pcm = tts.synthesize(normalize_for_tts(text), voice=voice_name, intonation=intonation)
        except Exception as exc:
            raise VoiceUnavailable(f"синтез не удался: {exc}") from exc
        finally:
            self._tts_run.release()
        return pcm_to_wav(pcm, int(getattr(tts, "sample_rate", 22050)))


def pcm_to_wav(pcm: bytes, sample_rate: int) -> bytes:
    if pcm[:4] == b"RIFF":
        return pcm
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm)
    return buf.getvalue()
