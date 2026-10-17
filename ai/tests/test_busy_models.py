"""Занятая модель: ожидание блокировки ограничено, вызывающий видит понятный отказ, а не висит."""

import pytest

from dds_ai.bridge.evaluate import evaluate_card
from dds_ai.bridge.llm import ask_json
from dds_ai.bridge.voice import VoiceBusy, VoiceService
from dds_ai.llm.errors import LLMBusy
from dds_ai.llm.llamacpp_provider import LlamaCppProvider
from tests.fakes import FakeLLM, FakeSTT, FakeTTS
from tests.test_bridge_compose import draft
from tests.test_bridge_evaluate import GOOD, request, run
from tests.test_llm_llamacpp import gguf, llama  # noqa: F401 — фикстуры


def busy(_prompt):
    raise LLMBusy("занята")


def test_llamacpp_gives_up_waiting_for_lock(llama, gguf):  # noqa: F811
    p = LlamaCppProvider(gguf, lock_timeout_s=0.05)
    p._lock.acquire()  # другой запрос держит контекст llama.cpp
    try:
        with pytest.raises(LLMBusy):
            p.complete_json("промпт", schema={"type": "object"}, max_tokens=8, timeout_s=30)
    finally:
        p._lock.release()
    assert p.complete("промпт", max_tokens=8)  # блокировка свободна — генерация идёт


def test_lock_timeout_from_env(llama, gguf, monkeypatch):  # noqa: F811
    monkeypatch.setenv("DDS_LLM_LOCK_TIMEOUT_S", "3")
    assert LlamaCppProvider(gguf).lock_timeout_s == 3
    monkeypatch.setenv("DDS_LLM_LOCK_TIMEOUT_S", "abc")
    assert LlamaCppProvider(gguf).lock_timeout_s == 20


def test_ask_json_passes_busy_through():
    with pytest.raises(LLMBusy):
        ask_json(FakeLLM(busy), "x", schema={}, max_tokens=8, timeout_s=1)


def test_evaluate_falls_back_to_rules_and_says_model_is_busy():
    out = evaluate_card(request(run(GOOD)), FakeLLM(busy))
    assert out["evaluatedBy"] == "rules" and out["aiScore"] == 100
    assert "занята" in out["aiRecommendations"]


@pytest.fixture
def make_client(monkeypatch):
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    from dds_ai.service import create_app

    monkeypatch.delenv("DDS_LLM_MODEL_PATH", raising=False)
    return lambda **kw: TestClient(create_app(**kw))


def test_compose_busy_is_503(make_client):
    c = make_client(llm=FakeLLM(busy), judge=None)
    r = c.post("/v1/scenarios/compose", json={"scenario": draft(), "complication": "zone"})
    assert r.status_code == 503 and "занята" in r.json()["detail"]


def test_evaluate_route_busy_is_200_by_rules(make_client):
    c = make_client(llm=FakeLLM(busy), judge=None)
    r = c.post("/api/v1/ai/evaluate", json=request(run(GOOD)))
    assert r.status_code == 200 and r.json()["evaluatedBy"] == "rules"


def test_voice_busy_is_503_and_lock_is_released(make_client):
    voice = VoiceService(stt=FakeSTT(), tts=FakeTTS(), env={"DDS_VOICE_LOCK_TIMEOUT_S": "0.05"})
    c = make_client(llm=None, judge=None, voice=voice)
    voice._stt_run.acquire()
    voice._tts_run.acquire()
    try:
        stt = c.post("/v1/stt", content=b"webm")
        tts = c.post("/v1/tts", json={"text": "Конец связи."})
    finally:
        voice._stt_run.release()
        voice._tts_run.release()
    assert stt.status_code == 503 and "повторите" in stt.json()["detail"]
    assert tts.status_code == 503 and "повторите" in tts.json()["detail"]
    assert c.post("/v1/stt", content=b"webm").status_code == 200
    assert c.post("/v1/tts", json={"text": "Конец связи."}).status_code == 200


def test_voice_busy_is_voice_unavailable():
    # старые обработчики `except VoiceUnavailable` ловят и занятость
    voice = VoiceService(stt=FakeSTT(), env={"DDS_VOICE_LOCK_TIMEOUT_S": "0.01"})
    voice._stt_run.acquire()
    try:
        with pytest.raises(VoiceBusy):
            voice.transcribe(b"x")
    finally:
        voice._stt_run.release()
