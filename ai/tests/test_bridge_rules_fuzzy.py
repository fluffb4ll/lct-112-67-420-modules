"""Нечёткое совпадение корней в докладе руководителю: текст доклада приходит из STT с ошибками."""

import json
from pathlib import Path

import pytest

from dds_ai.bridge.evaluate import evaluate_card
from dds_ai.bridge.rules import match_groups
from tests.test_bridge_evaluate import GOOD, request, run

# реальный ответ faster-whisper на доклад «…застревание в лифте…»
STT_REPORT = "Докладываю Днепропетровская улица, дом 19, состревание в листе, ребенок без взрослых"
GROUPS = [["днепро", "19"], ["застре"]]


def test_stt_report_with_misheard_root_is_credited():
    assert match_groups(STT_REPORT, GROUPS, fuzzy=True) == (2, [])


def test_strict_mode_keeps_exact_roots():
    # комментарии набраны руками и сверяются строго, как раньше
    assert match_groups(STT_REPORT, GROUPS)[1] == [["застре"]]


CASES = json.loads((Path(__file__).parent / "data" / "fuzzy_roots.json").read_text("utf-8"))


@pytest.mark.parametrize(("text", "stem", "why"), CASES["match"])
def test_misheard_roots_match(text, stem, why):
    assert match_groups(text, [[stem]], fuzzy=True)[0] == 1, why


@pytest.mark.parametrize(("text", "stem", "why"), CASES["no_match"])
def test_different_words_do_not_match(text, stem, why):
    assert match_groups(text, [[stem]], fuzzy=True)[0] == 0, why


def test_ui_case_zastryal_report_is_credited():
    # разбор писал «В докладе не прозвучало: «застре…»» на «Застрял»
    groups = [["днепропетровск", "19"], ["застре"], ["лифт"]]
    text = "Днепропетровская 19, застрял ребёнок, состревание в листе"
    assert match_groups(text, groups, fuzzy=True) == (3, [])
    assert match_groups("Застрял", [["застре"]], fuzzy=True) == (1, [])


def test_report_check_uses_fuzzy_roots_comment_check_does_not():
    expected_report = "Докладываю: Кировоградская, 22 — застревание в лифте."
    req = request(run(GOOD, report="Докладываю, Кировоградская 22, состревание в лифте"))
    req["referenceCard"]["expected"] = {
        **req["referenceCard"]["expected"],
        "reportMustMention": [["кировоградск", "22"], ["застре"]],
        "sampleReport": expected_report,
    }
    report = next(c for c in evaluate_card(req, None)["checks"] if c["id"] == "report_call")
    assert report["ok"], report["detail"]

    # тот же сбой в набранном комментарии не засчитывается
    req = request(run(GOOD.replace("Практика", "Прахтика").replace("передана", "пиредана")))
    comment = next(c for c in evaluate_card(req, None)["checks"] if c["id"] == "comment_content")
    assert not comment["ok"]
