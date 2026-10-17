"""Мост к бэкенду: оценка сданной карточки (`POST /api/v1/ai/evaluate`) и preflight."""

import json

import pytest

from dds_ai.bridge.evaluate import evaluate_card
from tests.fakes import FakeLLM

EXPECTED = {
    "path": ["Не принята"],
    "sample": {
        "Не принята": "Не обслуживаем: лифты обслуживает ООО «Практика». Информация передана."
    },
    "commentMustMention": [
        ["практик"],
        ["передан", "сообщ", "проинформ"],
        ["не обслужива", "не наш", "обслуживает"],
    ],
    "callRequired": True,
    "reportMustMention": [["кировоградск", "22"], ["лифт"]],
    "sampleReport": "Докладываю: Кировоградская, 22 — застревание в лифте.",
    "explanation": "",
}
SCENARIO = {"title": "Застревание в лифте", "skills": ["zone", "refusal_comment", "report"]}
CHIEF = "chief-1"


def request(events, notes="Кировоградская 22, застревание в лифте"):
    return {
        "cardId": "00000000-0000-0000-0000-000000000001",
        "scenarioId": "00000000-0000-0000-0000-000000000002",
        "submittedCard": {
            "incident": {"description": "Застряла в лифте"},
            "decision": {"action": "Не принята", "reason": events_comment(events)},
            "dispatch": {"dispatchNotes": notes},
            "trainingLog": {
                "events": events,
                "chiefContactIds": [CHIEF],
                "norms": {"openSec": 30, "totalSec": 180},
            },
        },
        "referenceCard": {"expected": EXPECTED, "scenario": SCENARIO},
        "operatorNotes": notes,
        "metrics": {"durationSeconds": 90},
    }


def events_comment(events):
    return next((e.get("comment") for e in events if e.get("kind") == "status_set"), "")


def run(comment, report="Кировоградская, 22 — застревание в лифте, медпомощь не нужна"):
    return [
        {"t": 0, "kind": "arrived"},
        {"t": 8_000, "kind": "opened"},
        {"t": 40_000, "kind": "status_set", "status": "Не принята", "comment": comment},
        {"t": 60_000, "kind": "call_started", "contactId": CHIEF},
        {"t": 80_000, "kind": "call_ended", "contactId": CHIEF, "transcript": report},
        {"t": 90_000, "kind": "finished"},
    ]


GOOD = "Не обслуживаем, лифты обслуживает ООО Практика. Информация передана в их диспетчерскую."
# тот же смысл другими словами: правила по корням не узнают «практик» и «передан»
PARAPHRASE = "Дом не в нашей зоне, лифтами занимается управляющая компания, диспетчер УК уведомлён."


def test_good_answer_scores_full_without_llm():
    out = evaluate_card(request(run(GOOD)), None)
    assert out["aiScore"] == out["finalScore"] == 100
    assert out["aiComplianceErrors"] == {}
    assert out["evaluatedBy"] == "rules"
    assert "правилам регламента" in out["aiRecommendations"]


def test_wrong_status_is_failed_and_explained():
    events = run(GOOD)
    events[2]["status"] = "Принята"
    out = evaluate_card(request(events), None)
    assert out["aiScore"] < 70 and out["passed"] is False
    assert "Правильный первичный статус" in out["aiComplianceErrors"]
    assert "незачёт" in out["aiRecommendations"]


def judge(comment_score, report_score=10):
    return FakeLLM(
        lambda _: json.dumps(
            {
                "comment_score": comment_score,
                "report_score": report_score,
                "remarks": ["Назовите организацию, куда передана информация."],
                "summary": "Статус верный, комментарий по сути верный.",
            },
            ensure_ascii=False,
        )
    )


def test_llm_credits_paraphrase_but_rules_alone_do_not():
    rules_only = evaluate_card(request(run(PARAPHRASE)), None)
    with_llm = evaluate_card(request(run(PARAPHRASE)), judge(10))
    content = {c["id"]: c for c in with_llm["checks"]}["comment_content"]
    assert with_llm["aiScore"] > rules_only["aiScore"]
    assert content["by"] == "llm" and content["points"] == content["max"]
    assert with_llm["evaluatedBy"] == "rules+llm"
    assert "Разбор ИИ: Статус верный" in with_llm["aiRecommendations"]
    assert "Назовите организацию" in with_llm["aiRecommendations"]


def test_llm_cannot_lower_rule_points():
    out = evaluate_card(request(run(GOOD)), judge(0, 0))
    assert out["aiScore"] == 100


def test_llm_cannot_credit_missing_comment_or_call():
    events = [e for e in run("") if e["kind"] not in {"call_started", "call_ended"}]
    out = evaluate_card(request(events, notes=""), judge(10, 10))
    checks = {c["id"]: c for c in out["checks"]}
    assert checks["comment_content"]["points"] == 0
    assert checks["report_call"]["points"] == 0


def test_broken_llm_falls_back_to_rules():
    def boom(_):
        raise RuntimeError("model crashed")

    out = evaluate_card(request(run(GOOD)), FakeLLM(boom))
    assert out["aiScore"] == 100 and out["evaluatedBy"] == "rules"
    assert "не ответила" in out["aiRecommendations"]


def test_garbage_llm_output_falls_back_to_rules():
    out = evaluate_card(request(run(PARAPHRASE)), FakeLLM(lambda _: "не знаю"))
    assert out["evaluatedBy"] == "rules"


def test_card_without_training_log_is_scored_from_decision():
    req = request([])
    req["submittedCard"]["decision"] = {"action": "Не принята", "reason": GOOD}
    del req["submittedCard"]["trainingLog"]
    out = evaluate_card(req, None)
    checks = {c["id"]: c for c in out["checks"]}
    assert checks["primary_status"]["points"] == checks["primary_status"]["max"]
    assert checks["comment_content"]["ok"]
    assert "Журнал действий не передан" in out["aiRecommendations"]


@pytest.fixture
def client(monkeypatch):
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    from dds_ai.service import create_app

    monkeypatch.delenv("DDS_LLM_MODEL_PATH", raising=False)
    return TestClient(create_app())


def test_backend_routes(client):
    pre = client.get("/api/v1/ai/preflight").json()
    assert {c["component"] for c in pre["components"]} == {"rules", "llm"}
    assert pre["voicePathOk"] is True
    r = client.post("/api/v1/ai/evaluate", json=request(run(GOOD)))
    assert r.status_code == 200
    body = r.json()
    assert body["aiScore"] == 100 and isinstance(body["aiRecommendations"], str)
    assert set(body["aiGrammarScore"]) >= {"score", "max", "status"}
