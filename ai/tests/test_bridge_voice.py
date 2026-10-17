"""Голос для фронта: /v1/voice, /v1/stt, /v1/tts поверх адаптеров (здесь — двойники)."""

import io
import wave

import pytest

pytest.importorskip("httpx")

from fastapi.testclient import TestClient

from dds_ai.bridge.voice import VoiceService, pcm_to_wav
from dds_ai.ports import TranscriptSegment
from dds_ai.service import create_app
from tests.fakes import FakeSTT, FakeTTS


class SpeakingSTT(FakeSTT):
    def transcribe(self, audio, *, hints=()):
        super().transcribe(audio, hints=hints)
        return [
            TranscriptSegment(
                text="Докладываю, Кировоградская",
                start_ms=0,
                end_ms=900,
                final=True,
                confidence=0.9,
            ),
            TranscriptSegment(
                text="двадцать два, лифт.", start_ms=900, end_ms=1800, final=True, confidence=0.7
            ),
        ]


def client(voice):
    return TestClient(create_app(llm=None, judge=None, voice=voice))


@pytest.fixture(autouse=True)
def no_models(monkeypatch):
    monkeypatch.delenv("DDS_LLM_MODEL_PATH", raising=False)


def test_stt_joins_segments():
    stt = SpeakingSTT()
    c = client(VoiceService(stt=stt, env={}))
    r = c.post(
        "/v1/stt?hints=Кировоградская",
        content=b"webm-bytes",
        headers={"Content-Type": "audio/webm"},
    )
    assert r.status_code == 200
    assert r.json()["text"] == "Докладываю, Кировоградская двадцать два, лифт."
    assert r.json()["confidence"] == 0.8
    assert stt.calls == [b"webm-bytes"]


def test_tts_returns_wav():
    c = client(VoiceService(tts=FakeTTS(), env={}))
    r = c.post("/v1/tts", json={"text": "Конец связи.", "voice": "male"})
    assert r.status_code == 200 and r.headers["content-type"] == "audio/wav"
    with wave.open(io.BytesIO(r.content)) as w:
        assert w.getnchannels() == 1 and w.getsampwidth() == 2


def test_not_configured_is_503_and_reported():
    c = client(VoiceService(env={}))
    assert c.get("/v1/voice").json()["stt"] is False
    assert c.post("/v1/stt", content=b"x").status_code == 503
    assert c.post("/v1/tts", json={"text": "привет"}).status_code == 503


def test_bad_input_is_422():
    c = client(VoiceService(stt=SpeakingSTT(), tts=FakeTTS(), env={}))
    assert c.post("/v1/stt", content=b"").status_code == 422
    assert c.post("/v1/tts", json={"text": "  "}).status_code == 422
    assert c.post("/v1/tts", json={"text": "привет", "voice": "robot"}).status_code == 422


def test_crashing_model_is_503():
    c = client(VoiceService(stt=FakeSTT(fail=True), tts=FakeTTS(fail=True), env={}))
    assert c.post("/v1/stt", content=b"x").status_code == 503
    assert c.post("/v1/tts", json={"text": "привет"}).status_code == 503


def test_failed_load_is_remembered(monkeypatch):
    svc = VoiceService(env={"DDS_STT_MODEL": "small"})
    import dds_ai.voice.stt.faster_whisper_provider as fw

    calls = []

    def broken(*a, **k):
        calls.append(1)
        raise ImportError("faster-whisper не установлен")

    monkeypatch.setattr(fw, "FasterWhisperSTT", broken)
    c = client(svc)
    assert c.post("/v1/stt", content=b"x").status_code == 503
    assert c.post("/v1/stt", content=b"x").status_code == 503
    assert len(calls) == 1
    caps = c.get("/v1/voice").json()
    assert caps["stt"] is False and "stt" in caps["errors"]


def test_wav_passthrough():
    wav = pcm_to_wav(b"\x00\x00" * 10, 16000)
    assert pcm_to_wav(wav, 16000) == wav


def test_male_voice_falls_back_to_female(monkeypatch, tmp_path):
    import dds_ai.voice.tts.piper_provider as pp

    loaded = []

    class Piper(FakeTTS):
        def __init__(self, path, *, voice_name):
            super().__init__()
            loaded.append(voice_name)

    monkeypatch.setattr(pp, "PiperTTS", Piper)
    female = tmp_path / "ru_RU-irina-medium.onnx"
    female.write_bytes(b"onnx")
    svc = VoiceService(env={"DDS_TTS_VOICE_PATH": str(female)})
    assert svc.synthesize("Принял.", voice="male")[:4] == b"RIFF"
    assert loaded == ["ru_RU-irina-medium"]


def test_incomplete_whisper_dir_is_not_offered(tmp_path):
    (tmp_path / "config.json").write_text("{}")
    svc = VoiceService(env={"DDS_STT_MODEL": str(tmp_path)})
    assert svc.capabilities()["stt"] is False
    (tmp_path / "model.bin").write_bytes(b"x")
    assert svc.capabilities()["stt"] is True


def test_oversized_recording_is_413():
    c = client(VoiceService(stt=SpeakingSTT(), tts=FakeTTS(), env={"DDS_STT_MAX_BYTES": "4"}))
    r = c.post("/v1/stt", content=b"x" * 10)
    assert r.status_code == 413 and "МБ" in r.json()["detail"]


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def test_failed_load_is_retried_after_pause(monkeypatch):
    import dds_ai.voice.stt.faster_whisper_provider as fw

    clock = Clock()
    svc = VoiceService(env={"DDS_STT_MODEL": "small"}, clock=clock)
    calls = []

    def flaky(*a, **k):
        calls.append(1)
        if len(calls) == 1:
            raise ImportError("веса ещё качаются")
        return SpeakingSTT()

    monkeypatch.setattr(fw, "FasterWhisperSTT", flaky)
    c = client(svc)
    assert c.post("/v1/stt", content=b"x").status_code == 503
    clock.now += 59
    assert c.post("/v1/stt", content=b"x").status_code == 503
    assert len(calls) == 1 and c.get("/v1/voice").json()["stt"] is False
    clock.now += 2  # пауза прошла — модель снова предлагается и грузится
    caps = c.get("/v1/voice").json()
    assert caps["stt"] is True and "stt" not in caps["errors"]
    assert c.post("/v1/stt", content=b"x").status_code == 200
    assert len(calls) == 2


def test_failed_tts_load_is_retried_after_pause(monkeypatch, tmp_path):
    import dds_ai.voice.tts.piper_provider as pp

    clock = Clock()
    calls = []

    def flaky(path, *, voice_name):
        calls.append(voice_name)
        if len(calls) == 1:
            raise RuntimeError("битый onnx")
        return FakeTTS()

    monkeypatch.setattr(pp, "PiperTTS", flaky)
    voice = tmp_path / "ru_RU-irina-medium.onnx"
    voice.write_bytes(b"onnx")
    c = client(VoiceService(env={"DDS_TTS_VOICE_PATH": str(voice)}, clock=clock))
    assert c.post("/v1/tts", json={"text": "привет"}).status_code == 503
    assert c.post("/v1/tts", json={"text": "привет"}).status_code == 503
    assert c.get("/v1/voice").json()["tts"] is False
    clock.now += 61
    assert c.get("/v1/voice").json()["tts"] is True
    assert c.post("/v1/tts", json={"text": "привет"}).status_code == 200
    assert len(calls) == 2


def test_stt_and_tts_load_under_separate_locks(monkeypatch, tmp_path):
    import threading

    import dds_ai.voice.stt.faster_whisper_provider as fw
    import dds_ai.voice.tts.piper_provider as pp

    monkeypatch.setattr(fw, "FasterWhisperSTT", lambda *a, **k: SpeakingSTT())
    monkeypatch.setattr(pp, "PiperTTS", lambda *a, **k: FakeTTS())
    voice = tmp_path / "ru_RU-irina-medium.onnx"
    voice.write_bytes(b"onnx")
    svc = VoiceService(env={"DDS_STT_MODEL": "small", "DDS_TTS_VOICE_PATH": str(voice)})

    def loads_while_other_lock_held(held, work):
        held.acquire()  # долгая загрузка другой модели
        try:
            t = threading.Thread(target=work, daemon=True)
            t.start()
            t.join(timeout=2)
            return not t.is_alive()
        finally:
            held.release()

    assert loads_while_other_lock_held(svc._tts_load, lambda: svc.transcribe(b"x"))
    assert loads_while_other_lock_held(svc._stt_load, lambda: svc.synthesize("привет"))
