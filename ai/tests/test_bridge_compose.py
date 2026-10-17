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
        "title": "Лифт застрял между этажами на Кировоградской",
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


def test_title_giving_away_complication_is_rejected():
    out = compose_scenario(
        {"scenario": draft(), "complication": "zone"},
        answer(title="Застревание в лифте — не наш дом"),
    )
    assert "title" in out["rejected"]


def test_spoiler_with_punctuation_is_caught():
    out = compose_scenario(
        {"scenario": draft(), "complication": "zone"},
        answer(
            description="Женщина застряла в лифте. Звонили в Д.Д.С., там сказали — дом чужая УК."
        ),
    )
    assert "description" in out["rejected"]


@pytest.mark.parametrize(
    "broken",
    [
        {"incident": None},
        {"incident": {"descriptions": []}},
        {"expected": "x"},
    ],
)
def test_malformed_draft_is_value_error(broken):
    with pytest.raises(ValueError):
        compose_scenario({"scenario": {**draft(), **broken}}, None)


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


def test_draft_echo_is_not_applied():
    # реальный случай (сценарий b7392178): модель вернула описание шаблона с адресом в конце,
    # `applied` было с description, а в банк ушёл шаблонный текст «Признаки: …»
    d = draft("progress")
    d["title"] = "Застревание в лифте, Кировоградская, 15"
    d["incident"]["descriptions"][0]["text"] = "Застревание в лифте. Признаки: лифт, застревание."
    out = compose_scenario(
        {"scenario": d, "complication": "progress"},
        answer(
            title="Застревание в лифте, Кировоградская, 15.",
            description="Застревание в лифте. Признаки: лифт, застревание. "
            "Кировоградская улица, д. 15.",
            chief_reply=d["chiefReply"],
            sample_report=d["expected"]["sampleReport"],
            inputs=["Выехали."],
        ),
    )
    assert out["by"] == "template" and out["applied"] == []
    assert {"title", "description"} <= set(out["rejected"])
    assert out["scenario"] == d


def test_echo_rejection_is_logged_without_user_text(caplog):
    d = draft("progress")
    echo = d["incident"]["descriptions"][0]["text"] + " Кировоградская улица, д. 15, подъезд 2."
    with caplog.at_level("INFO", logger="dds_ai.bridge.compose"):
        compose_scenario({"scenario": d, "complication": "progress"}, answer(description=echo))
    log = caplog.text
    assert "description" in log and "повтор" in log
    assert "Кировоградская" not in log


@pytest.mark.parametrize(
    ("phrase", "spoils"),
    [
        ("но не нашли ключ", False),
        ("но не нашёл ключ", False),
        ("но не нашла ключ", False),
        ("а дом не наш", True),
        ("это не нашего района", True),
        ("вызов не нашей зоны", True),
    ],
)
def test_words_like_ne_nashli_are_not_spoilers(phrase, spoils):
    out = compose_scenario(
        {"scenario": draft(), "complication": "zone"},
        answer(
            description="Женщина застряла в лифте между 7 и 8 этажами. Соседи пытались помочь, "
            f"{phrase} от машинного отделения."
        ),
    )
    assert ("description" in out["rejected"]) is spoils
    assert ("description" in out["applied"]) is not spoils


def test_short_draft_words_do_not_make_new_words_old():
    # в черновике есть «в» и «не»: слова на эти буквы — всё равно новые
    out = compose_scenario(
        {"scenario": draft("progress"), "complication": "progress"},
        answer(title="Внутри взрослых нет, вода не выключена"),
    )
    assert "title" in out["applied"]


def test_spoilers_checked_only_for_hidden_complications():
    text = "Застряли в лифте. Соседи вызвали аварийную организацию, ждут на площадке."
    progress = compose_scenario(
        {"scenario": draft("progress"), "complication": "progress"}, answer(description=text)
    )
    zone = compose_scenario({"scenario": draft(), "complication": "zone"}, answer(description=text))
    assert "description" in progress["applied"]
    assert "description" in zone["rejected"]


def test_prompt_does_not_ask_to_rewrite_template_text():
    llm = answer()
    d = draft()
    d["incident"]["descriptions"][0]["text"] = "Шаблон. Признаки: лифт, застревание."
    compose_scenario({"scenario": d, "complication": "zone"}, llm)
    prompt = llm.prompts[0]
    assert "Признаки: лифт, застревание." not in prompt
    assert d["title"] not in prompt
