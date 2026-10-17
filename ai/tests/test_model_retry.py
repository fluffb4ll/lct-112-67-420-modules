"""Повтор загрузки моделей: LLM и голос пробуются снова с растущей паузой, без перезапуска."""

import pytest

pytest.importorskip("httpx")

from fastapi.testclient import TestClient

from dds_ai.backoff import Backoff
from dds_ai.bridge.voice import VoiceService, _download
from dds_ai.service import create_app
from tests.fakes import FakeLLM, StubJudge
from tests.test_bridge_voice import Clock


def test_backoff_doubles_up_to_cap_and_resets():
    clock = Clock()
    b = Backoff(clock, first_s=10, max_s=35)
    assert not b.waiting() and b.delay_s == 0
    delays = []
    for _ in range(4):
        b.failed()
        delays.append(b.delay_s)
    assert delays == [10, 20, 35, 35]
    clock.now += 34
    assert b.waiting()
    clock.now += 1
    assert not b.waiting()
    b.failed()
    b.succeeded()
    assert not b.waiting() and b.delay_s == 0


def test_llm_load_is_retried_with_growing_pause():
    clock = Clock()
    calls = []
    llm = FakeLLM()

    def loader():
        calls.append(clock.now)
        if len(calls) < 3:
            raise FileNotFoundError("нет файла /models/llm/model.gguf")
        return llm, StubJudge()

    c = TestClient(create_app(voice=VoiceService(env={}), load_models=loader, clock=clock))
    assert len(calls) == 1 and c.get("/health").json()["llm"] is None
    clock.now += 59
    c.get("/api/v1/ai/preflight")
    assert len(calls) == 1  # пауза 60 с ещё идёт — по правилам, без попытки
    clock.now += 2
    c.get("/api/v1/ai/preflight")
    assert len(calls) == 2  # вторая неудача — пауза удвоилась до 120 с
    clock.now += 119
    c.get("/api/v1/ai/preflight")
    assert len(calls) == 2
    clock.now += 2
    pre = c.get("/api/v1/ai/preflight").json()
    assert len(calls) == 3
    assert {x["component"]: x["health"] for x in pre["components"]}["llm"] == "ok"
    assert c.get("/health").json()["llm"]["model_name"] == "fake-llm"
    clock.now += 10_000
    c.get("/api/v1/ai/preflight")
    assert len(calls) == 3  # загружена — больше не грузим


def test_llm_not_configured_is_not_retried():
    clock = Clock()
    calls = []

    def loader():
        calls.append(1)
        return None, None

    c = TestClient(create_app(voice=VoiceService(env={}), load_models=loader, clock=clock))
    clock.now += 10_000
    c.get("/api/v1/ai/preflight")
    assert calls == [1]


def test_voice_retry_pause_doubles(monkeypatch):
    import dds_ai.voice.stt.faster_whisper_provider as fw

    clock = Clock()
    calls = []

    def broken(*a, **k):
        calls.append(1)
        raise ImportError("веса ещё качаются")

    monkeypatch.setattr(fw, "FasterWhisperSTT", broken)
    svc = VoiceService(env={"DDS_STT_MODEL": "small"}, clock=clock)
    c = TestClient(create_app(llm=FakeLLM(), judge=StubJudge(), voice=svc))
    assert c.post("/v1/stt", content=b"x").status_code == 503
    clock.now += 61
    assert c.post("/v1/stt", content=b"x").status_code == 503
    assert len(calls) == 2
    clock.now += 61  # вторая пауза — 120 с
    assert c.post("/v1/stt", content=b"x").status_code == 503
    assert len(calls) == 2
    clock.now += 60
    c.post("/v1/stt", content=b"x")
    assert len(calls) == 3


class Endless:
    """Ответ сервера, который отдаёт байты медленно и бесконечно (часы сдвигает каждое чтение)."""

    def __init__(self, clock):
        self.clock = clock

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self, n):
        self.clock.now += 10
        return b"x" * 16


def test_voice_download_has_overall_deadline(monkeypatch, tmp_path):
    import dds_ai.bridge.voice as voice

    clock = Clock()
    timeouts = []

    def urlopen(url, timeout):
        timeouts.append(timeout)
        return Endless(clock)

    monkeypatch.setattr(voice.urllib.request, "urlopen", urlopen)
    dest = tmp_path / "ru_RU-irina-medium.onnx"
    with pytest.raises(TimeoutError):
        _download("https://example.invalid/irina.onnx", dest, timeout_s=45, clock=clock)
    assert not dest.exists() and list(tmp_path.iterdir()) == []  # .part удалён
    assert timeouts == [45]  # тайм-аут сокета не больше оставшегося срока

    # через сервис: срок из DDS_VOICE_DOWNLOAD_TIMEOUT_S, блокировка голоса освобождена
    svc = VoiceService(
        env={"DDS_TTS_VOICE_PATH": str(dest), "DDS_VOICE_DOWNLOAD_TIMEOUT_S": "30"}, clock=clock
    )
    c = TestClient(create_app(llm=FakeLLM(), judge=StubJudge(), voice=svc))
    r = c.post("/v1/tts", json={"text": "привет"})
    assert r.status_code == 503 and "30" in r.json()["detail"]
    assert not svc._tts_load.locked()
