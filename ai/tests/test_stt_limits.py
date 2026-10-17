"""STT: подсказки распознаванию и пределы записи (размер — 413, длительность — 422)."""

import sys
import types
from types import SimpleNamespace

import pytest

pytest.importorskip("httpx")

from fastapi.testclient import TestClient

from dds_ai.bridge.voice import (
    STT_HINTS_MAX_CHARS,
    STT_MAX_HINTS,
    AudioTooLarge,
    VoiceService,
    clean_hints,
)
from dds_ai.service import create_app
from dds_ai.voice.stt import AudioTooLong
from tests.fakes import FakeSTT


class HintSTT(FakeSTT):
    def __init__(self):
        super().__init__()
        self.hints: list[tuple[str, ...]] = []

    def transcribe(self, audio, *, hints=()):
        self.hints.append(tuple(hints))
        return super().transcribe(audio, hints=hints)


def client(voice):
    return TestClient(create_app(llm=None, judge=None, voice=voice))


@pytest.fixture(autouse=True)
def no_models(monkeypatch):
    monkeypatch.delenv("DDS_LLM_MODEL_PATH", raising=False)


def test_keyword_hints_reach_model():
    stt = HintSTT()
    c = client(VoiceService(stt=stt, env={}))
    r = c.post("/v1/stt?hints=Днепропетровская улица,19,Застревание в лифте,,19", content=b"a")
    assert r.status_code == 200
    assert stt.hints == [("Днепропетровская улица", "19", "Застревание в лифте")]


def test_long_hint_list_is_trimmed_not_rejected():
    stt = HintSTT()
    c = client(VoiceService(stt=stt, env={}))
    many = ",".join(f"слово{i} " + "х" * 80 for i in range(40))
    assert c.post(f"/v1/stt?hints={many}", content=b"a").status_code == 200
    sent = stt.hints[0]
    assert 0 < len(sent) <= STT_MAX_HINTS
    assert len(", ".join(sent)) <= STT_HINTS_MAX_CHARS


def test_clean_hints_drops_blanks_and_repeats():
    assert clean_hints(["  Лифт ", "лифт", "", "Застревание\n в лифте"]) == [
        "Лифт",
        "Застревание в лифте",
    ]


def test_size_limit_from_env():
    svc = VoiceService(stt=HintSTT(), env={"DDS_STT_MAX_BYTES": "8"})
    with pytest.raises(AudioTooLarge):
        svc.transcribe(b"x" * 9)
    assert svc.transcribe(b"x" * 8)["text"] == ""
    assert VoiceService(env={}).max_audio_bytes == 10 * 1024 * 1024


def test_bad_env_falls_back_to_defaults():
    svc = VoiceService(env={"DDS_STT_MAX_BYTES": "много", "DDS_STT_MAX_SECONDS": "-1"})
    assert (svc.max_audio_bytes, svc.max_audio_seconds) == (10 * 1024 * 1024, 120.0)


class TooLongSTT(FakeSTT):
    def transcribe(self, audio, *, hints=()):
        raise AudioTooLong("запись длиннее 120 с (300 с) — сократите доклад")


def test_too_long_recording_is_422_not_503():
    r = client(VoiceService(stt=TooLongSTT(), env={})).post("/v1/stt", content=b"a")
    assert r.status_code == 422 and "длиннее 120 с" in r.json()["detail"]


@pytest.fixture
def fake_whisper(monkeypatch):
    consumed = []

    class WhisperModel:
        duration = 30.0

        def __init__(self, *a, **k):
            pass

        def transcribe(self, audio, **kw):
            def segments():
                consumed.append(1)
                yield SimpleNamespace(text=" Докладываю ", start=0.0, end=1.0, avg_logprob=-0.1)

            return segments(), SimpleNamespace(duration=WhisperModel.duration)

    monkeypatch.setitem(
        sys.modules, "faster_whisper", types.SimpleNamespace(WhisperModel=WhisperModel)
    )
    return WhisperModel, consumed


def test_whisper_rejects_long_audio_before_decoding_segments(fake_whisper):
    from dds_ai.voice.stt.faster_whisper_provider import FasterWhisperSTT

    model, consumed = fake_whisper
    stt = FasterWhisperSTT("small", max_seconds=120)
    assert stt.transcribe(b"a")[0].text == "Докладываю"
    model.duration = 300.0
    with pytest.raises(AudioTooLong, match="120 с"):
        stt.transcribe(b"a")
    assert consumed == [1]  # второй раз сегменты не распознавались


def test_service_passes_duration_limit_to_whisper(fake_whisper):
    model, _ = fake_whisper
    model.duration = 45.0
    svc = VoiceService(env={"DDS_STT_MODEL": "small", "DDS_STT_MAX_SECONDS": "40"})
    r = client(svc).post("/v1/stt", content=b"a")
    assert r.status_code == 422 and "40 с" in r.json()["detail"]
