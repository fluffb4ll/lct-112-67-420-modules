"""Мост к фронту: генерация текста сценария поверх заготовки по классификатору."""

import json

import pytest

from dds_ai.bridge.compose import RETRY_HINT, compose_scenario
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


def test_chief_reply_with_an_invented_number_is_rejected():
    """По номеру из ответа руководителя обучающийся звонит — выдуманный уведёт его в никуда."""
    out = compose_scenario(
        {"scenario": draft(), "complication": "zone"},
        answer(chief_reply="Дом УК «Домовой», не наш. Звоните им на 2299, передайте. Конец связи."),
    )
    assert "chiefReply" in out["rejected"]
    assert out["scenario"]["chiefReply"] == draft()["chiefReply"]


def test_text_is_asked_apart_from_the_service_fields():
    """Два запроса: сначала название и описание, потом служебные тексты — так короче ответ."""
    llm = answer()
    compose_scenario({"scenario": draft(), "complication": "zone"}, llm)
    assert len(llm.prompts) == 2
    assert "chief_reply" not in llm.prompts[0]
    assert "sample_report" in llm.prompts[1]


def test_second_attempt_when_the_first_answer_is_unusable():
    """Негодный ответ про текст — просим его ещё раз: иначе в сценарии остался бы шаблон."""
    usable = answer()
    first = [json.dumps({"title": "", "description": ""})]
    llm = FakeLLM(lambda p: first.pop(0) if first else usable.answer(p))
    out = compose_scenario({"scenario": draft(), "complication": "zone"}, llm)
    assert len(llm.prompts) == 3
    assert out["by"] == "llm"
    assert out["scenario"]["incident"]["descriptions"][0]["text"].startswith("Женщина застряла")


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


def test_spoilers_depend_on_complication():
    text = "Застряли в лифте. Соседи вызвали аварийную организацию, ждут на площадке."
    progress = compose_scenario(
        {"scenario": draft("progress"), "complication": "progress"}, answer(description=text)
    )
    zone = compose_scenario({"scenario": draft(), "complication": "zone"}, answer(description=text))
    none = compose_scenario(
        {"scenario": draft("none"), "complication": "none"}, answer(description=text)
    )
    assert "description" in progress["applied"]
    assert "description" in zone["rejected"]
    assert "description" in none["applied"]


@pytest.mark.parametrize(
    ("title", "spoils"),
    [
        ("Бригада устранила застревание у Кировоградской", True),
        ("Лифт застрял, мастер выехал и прибыл на место", True),
        ("Неисправность устранена, работы завершены", True),
        ("Мужчина застрял в кабине, просит поскорее устранить", False),
    ],
)
def test_progress_title_must_not_reveal_work_stages(title, spoils):
    out = compose_scenario(
        {"scenario": draft("progress"), "complication": "progress"}, answer(title=title)
    )
    assert ("title" in out["rejected"]) is spoils
    assert ("title" in out["applied"]) is not spoils


def test_word_forms_of_draft_words_are_not_new():
    # «лифтах» — «лифте» из черновика в другой форме: нового слова одно («мужчина»), это повтор
    d = draft("progress")
    d["title"] = "Застревание в лифте"
    out = compose_scenario(
        {"scenario": d, "complication": "progress"}, answer(title="Застревание: мужчина в лифтах")
    )
    assert "title" in out["rejected"] and "title" not in out["applied"]


def test_prompt_does_not_ask_to_rewrite_template_text():
    llm = answer()
    d = draft()
    d["incident"]["descriptions"][0]["text"] = "Шаблон. Признаки: лифт, застревание."
    compose_scenario({"scenario": d, "complication": "zone"}, llm)
    prompt = llm.prompts[0]
    assert "Признаки: лифт, застревание." not in prompt
    assert d["title"] not in prompt


# --- два запроса (текст, затем служебные поля) вместе с проверками полей ---------------------


def routed(text, rest):
    """Фейк, отвечающий по запросу: во втором (служебном) запросе есть «sample_report»."""

    def reply(prompt):
        return json.dumps(rest if "sample_report" in prompt else text, ensure_ascii=False)

    return FakeLLM(reply)


def draft_rest(d):
    """Служебные поля слово в слово как в черновике: их не применяют и не отклоняют."""
    return {
        "chief_reply": d["chiefReply"],
        "sample_report": d["expected"]["sampleReport"],
        "inputs": [i["text"] for i in d["inputs"]],
    }


def distinct_draft():
    d = draft()
    d["incident"]["descriptions"][0]["text"] = "Шаблон. Признаки: лифт, застревание."
    return d


def test_echo_is_rejected_on_the_retry_too():
    d = distinct_draft()
    echo = {
        "title": d["title"] + ".",
        "description": d["incident"]["descriptions"][0]["text"] + " Кировоградская улица, д. 15.",
    }
    llm = routed(echo, draft_rest(d))
    out = compose_scenario({"scenario": d, "complication": "zone"}, llm)
    assert len(llm.prompts) == 3
    assert llm.prompts[1].endswith(RETRY_HINT)
    assert "sample_report" in llm.prompts[2]
    assert out["by"] == "template" and out["applied"] == []
    assert out["rejected"] == ["title", "description"]
    assert out["scenario"] == d
    # в повторе черновые название и описание тоже не показываем
    assert d["title"] not in llm.prompts[1]
    assert "Признаки: лифт, застревание." not in llm.prompts[1]


def test_no_retry_when_title_alone_is_applied():
    d = distinct_draft()
    text = {
        "title": "Мужчина застрял в кабине у Кировоградской",
        "description": d["incident"]["descriptions"][0]["text"] + " Кировоградская улица, д. 15.",
    }
    llm = routed(text, draft_rest(d))
    out = compose_scenario({"scenario": d, "complication": "zone"}, llm)
    assert len(llm.prompts) == 2
    assert out["applied"] == ["title"] and out["rejected"] == ["description"]


@pytest.mark.parametrize(
    ("title", "echo"),
    [
        ("Застревание в лифте: мужчина", True),  # одно новое слово
        ("Застревание в лифте: мужчина кричит", False),  # ECHO_MIN_NEW_WORDS = 2
        ("Застревание в лифте, Кировоградская улица, дом 15, мужчина", True),  # адрес не новый
    ],
)
def test_echo_boundary_is_two_new_words(title, echo):
    d = draft()
    d["title"] = "Застревание в лифте"
    out = compose_scenario({"scenario": d, "complication": "zone"}, answer(title=title))
    assert ("title" in out["rejected"]) is echo
    assert ("title" in out["applied"]) is not echo


def test_echo_is_checked_against_the_draft_not_the_rewritten_scenario():
    """`answer()` возвращает все поля на оба запроса: ко второму название уже переписано.

    Сверяй `_apply` с переписанным сценарием — то же название во втором ответе было бы повтором.
    """
    llm = answer()
    d = draft()
    out = compose_scenario({"scenario": d, "complication": "zone"}, llm)
    assert len(llm.prompts) == 2
    assert out["rejected"] == []
    assert set(out["applied"]) == {"title", "description", "chiefReply", "sampleReport", "inputs"}
    # второй запрос строится по черновику, а не по уже переписанному сценарию
    rest = llm.prompts[1]
    assert f"chief_reply: {d['chiefReply']}" in rest
    assert "Передайте им и закрывайте" not in rest
    assert "Лифт застрял между этажами на Кировоградской" not in rest


@pytest.mark.parametrize(
    ("complication", "spoils"),
    [("progress", True), ("zone", False), ("refusal", False), ("none", False)],
)
def test_work_stage_spoilers_only_for_progress(complication, spoils):
    text = "Женщина застряла в лифте между 7 и 8 этажами, бригада выехала, соседи ждут на площадке."
    out = compose_scenario(
        {"scenario": draft(), "complication": complication},
        answer(description=text, chief_reply="Это дом «Домового», не наш. Конец связи."),
    )
    assert ("description" in out["rejected"]) is spoils
    assert ("description" in out["applied"]) is not spoils


def test_no_spoiler_check_without_hidden_complication():
    text = "Женщина застряла в лифте, звонила в ДДС, ждёт на площадке между этажами."
    none = compose_scenario({"scenario": draft(), "complication": "none"}, answer(description=text))
    zone = compose_scenario({"scenario": draft(), "complication": "zone"}, answer(description=text))
    assert "description" in none["applied"]
    assert "description" in zone["rejected"]


def test_unchanged_chief_reply_is_neither_applied_nor_rejected():
    out = compose_scenario(
        {"scenario": draft(), "complication": "zone"},
        answer(chief_reply="дом  УК «Домовой» —  не наш!  Конец связи"),
    )
    assert "chiefReply" not in out["applied"] and "chiefReply" not in out["rejected"]
    assert out["scenario"]["chiefReply"] == draft()["chiefReply"]


def test_chief_reply_may_repeat_address_digits():
    reply = "Кировоградская, 15 — это дом «Домового», не наш. Передайте им. Конец связи."
    out = compose_scenario({"scenario": draft(), "complication": "zone"}, answer(chief_reply=reply))
    assert "chiefReply" in out["applied"]
    assert out["scenario"]["chiefReply"] == reply


@pytest.mark.parametrize(
    ("complication", "needs_org"), [("zone", True), ("refusal", True), ("progress", False)]
)
def test_chief_reply_must_keep_organisation_only_for_zone_and_refusal(complication, needs_org):
    reply = "Не наш дом, передайте информацию и закрывайте. Конец связи."
    out = compose_scenario(
        {"scenario": draft(), "complication": complication}, answer(chief_reply=reply)
    )
    assert ("chiefReply" in out["rejected"]) is needs_org
    assert ("chiefReply" in out["applied"]) is not needs_org


@pytest.mark.parametrize("same", ["Выехали.", "выехали"])
def test_inputs_identical_to_draft_are_neither_applied_nor_rejected(same):
    out = compose_scenario({"scenario": draft(), "complication": "zone"}, answer(inputs=[same]))
    assert "inputs" not in out["applied"] and "inputs" not in out["rejected"]
    assert out["scenario"]["inputs"] == draft()["inputs"]


def test_fewer_inputs_matching_the_draft_prefix_are_rejected():
    d = draft()
    d["inputs"].append(
        {"afterStatus": "Принята", "delaySec": 30, "from": "Мастер", "text": "На месте."}
    )
    out = compose_scenario({"scenario": d, "complication": "zone"}, answer(inputs=["Выехали."]))
    assert "inputs" in out["rejected"]
