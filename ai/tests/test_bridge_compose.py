"""Мост к фронту: генерация текста сценария поверх заготовки по классификатору."""

import json

import pytest

from dds_ai.bridge.compose import compose_scenario
from tests.fakes import FakeLLM


def draft(complication="zone"):
    return {
        "id": "sc-1",
        "title": "Застревание в лифте — не наш дом",
        "difficulty": 2,
        "incident": {
            "applicant": {"name": "Громова Лидия", "status": "очевидец"},
            "address": {"street": "Кировоградская улица", "house": "15"},
            "descriptions": [{"at": "", "author": "227", "text": "Застревание в лифте."}],
            "type": {
                "card": "ЛИФТ",
                "signs": ["Лифт", "Застревание"],
                "finalType": "Застревание в лифте",
            },
        },
        "expected": {
            "path": ["Не принята"],
            "sample": {"Не принята": "Не обслуживаем: дом УК «Домовой». Информация передана."},
            "commentMustMention": [["домов"], ["передан", "сообщ"]],
            "callRequired": True,
            "reportMustMention": [["кировоградск", "15"], ["лифт"]],
            "sampleReport": "Докладываю: Кировоградская, 15 — застревание в лифте.",
            "explanation": "Сгенерировано по классификатору.",
        },
        "chiefReply": "Дом УК «Домовой», не наш. Конец связи.",
        "inputs": [
            {"afterStatus": "Принята", "delaySec": 10, "from": "Мастер", "text": "Выехали."}
        ],
    }


def answer(**over):
    base = {
        "title": "Лифт застрял между этажами в доме чужой УК",
        "description": "Женщина застряла в лифте между 7 и 8 этажами, в кабине одна. Свет горит, "
        "связь с диспетчером лифта не отвечает. Пострадавших нет.",
        "chief_reply": "Это дом «Домового», не наш. Передайте им и закрывайте. Конец связи.",
        "sample_report": "Докладываю: Кировоградская, 15 — застревание в лифте, пострадавших нет.",
        "inputs": ["Бригада выехала на место."],
    }
    base.update(over)
    return FakeLLM(lambda _: json.dumps(base, ensure_ascii=False))


def test_llm_text_applied_and_reference_kept():
    out = compose_scenario({"scenario": draft(), "complication": "zone", "difficulty": 2}, answer())
    sc = out["scenario"]
    assert out["by"] == "llm"
    assert set(out["applied"]) == {"title", "description", "chiefReply", "sampleReport", "inputs"}
    assert sc["incident"]["descriptions"][0]["text"].startswith("Женщина застряла")
    assert sc["expected"]["path"] == ["Не принята"]
    assert sc["expected"]["commentMustMention"] == draft()["expected"]["commentMustMention"]
    assert "языковой моделью" in sc["expected"]["explanation"]


def test_report_without_address_is_rejected():
    out = compose_scenario(
        {"scenario": draft(), "complication": "zone"},
        answer(sample_report="Докладываю: лифт застрял."),
    )
    assert "sampleReport" in out["rejected"]
    assert out["scenario"]["expected"]["sampleReport"] == draft()["expected"]["sampleReport"]


def test_chief_reply_losing_organisation_is_rejected():
    out = compose_scenario(
        {"scenario": draft(), "complication": "zone"},
        answer(chief_reply="Не наш дом. Конец связи."),
    )
    assert "chiefReply" in out["rejected"]
    assert out["scenario"]["chiefReply"] == draft()["chiefReply"]


def test_description_giving_away_complication_is_rejected():
    out = compose_scenario(
        {"scenario": draft(), "complication": "zone"},
        answer(description="Застряли в лифте. Дом обслуживает другая организация, ДДС не едет."),
    )
    assert "description" in out["rejected"]
    assert out["scenario"]["incident"]["descriptions"][0]["text"] == "Застревание в лифте."


def test_without_llm_returns_template():
    out = compose_scenario({"scenario": draft()}, None)
    assert out["by"] == "template" and out["scenario"] == draft()


def test_draft_is_not_mutated():
    d = draft()
    compose_scenario({"scenario": d, "complication": "zone"}, answer())
    assert d == draft()


def test_route(monkeypatch):
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    from dds_ai.service import create_app

    monkeypatch.delenv("DDS_LLM_MODEL_PATH", raising=False)
    client = TestClient(create_app(llm=answer()))
    r = client.post("/v1/scenarios/compose", json={"scenario": draft(), "complication": "zone"})
    assert r.status_code == 200 and r.json()["by"] == "llm"
    assert client.post("/v1/scenarios/compose", json={}).status_code == 422
