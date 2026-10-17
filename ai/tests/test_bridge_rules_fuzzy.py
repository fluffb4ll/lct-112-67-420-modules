"""Нечёткое совпадение корней в докладе руководителю: текст доклада приходит из STT с ошибками."""

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


@pytest.mark.parametrize(
    ("text", "stem"),
    [
        ("состревание в лифте", "застре"),  # з/с и безударная о/а
        ("застриване в лифте", "застре"),  # е/и
        ("кирафоградская 22", "кировоградск"),  # одна правка в длинном корне (в/ф, о/а)
        ("кировградская 22", "кировоградск"),  # пропуск буквы в длинном корне
    ],
)
def test_misheard_roots_match(text, stem):
    assert match_groups(text, [[stem]], fuzzy=True)[0] == 1


@pytest.mark.parametrize(
    ("text", "stem"),
    [
        ("приехал застройщик", "застре"),  # другое слово с похожим началом
        ("нас заставили ждать", "застре"),
        ("упал лист с крыши", "лифт"),  # короткий корень — только точно
        ("в листе", "лифт"),
        ("дом 91", "19"),  # числа — только точно
        ("ушли домой", "домов"),  # 5 букв: правка не прощается
        ("кировская 22", "кировоградск"),
    ],
)
def test_different_words_do_not_match(text, stem):
    assert match_groups(text, [[stem]], fuzzy=True)[0] == 0


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
