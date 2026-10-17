"""Генерация сценария для банка преподавателя (`POST /v1/scenarios/compose`).

Фронт присылает заготовку `Scenario` (своя модель, `frontend/src/domain/types.ts`), собранную по
классификатору: тип происшествия, адрес, службы, осложнение и эталон (`expected`). Эталон и
структуру строят правила — от них зависит оценка, их модель не трогает. Модель пишет живой текст:
название, описание происшествия со слов заявителя, ответ руководителя, эталонный доклад и реплики
исполнителей. Каждое поле проверяется; не прошло проверку — остаётся текст шаблона.
"""

from __future__ import annotations

import copy
import re
from typing import Any

from ..ports import LLMProvider
from .llm import ask_json
from .rules import match_groups

COMPOSE_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "description": {"type": "string"},
        "chief_reply": {"type": "string"},
        "sample_report": {"type": "string"},
        "inputs": {"type": "array", "items": {"type": "string"}, "maxItems": 4},
    },
    "required": ["title", "description", "chief_reply", "sample_report", "inputs"],
    "additionalProperties": False,
}

COMPOSE_TIMEOUT_S = 50.0

COMPLICATION_HINTS = {
    "zone": "дом обслуживает другая организация — служба ДДС реагировать не должна",
    "duplicate": "по этому же адресу несколько минут назад уже зарегистрирована карточка (дубль)",
    "refusal": "после выезда выясняется, что объект чужой, и работы проводить не будут",
    "progress": "служба отрабатывает происшествие полностью: выезд, прибытие, завершение работ",
}
DEFAULT_HINT = "обычное происшествие в зоне ответственности службы"
# особенность выясняет обучающийся; название и описание (их видно в списке занятий)
# выдавать её не должны
SPOILERS = (
    "ддс",
    "реагир",
    "не должн",
    "дубл",
    "организац",
    "чуж",
    "проводить не будут",
    "зарегистрирован",
    "не наш",
    "отказ от",
    "откаж",
    "отказыва",
)

DIFFICULTY_HINTS = {
    1: "заявитель спокоен и говорит чётко",
    2: "заявитель взволнован, путается в деталях",
    3: "заявитель в панике, перебивает, адрес называет не сразу",
}


def _address(scenario: dict[str, Any]) -> str:
    a = scenario.get("incident", {}).get("address", {}) or {}
    parts = [
        a.get("street"),
        a.get("house") and f"д. {a['house']}",
        a.get("building") and f"корп. {a['building']}",
    ]
    return ", ".join(p for p in parts if p)


def _prompt(scenario: dict[str, Any], complication: str, difficulty: int) -> str:
    inc = scenario.get("incident", {})
    exp = scenario.get("expected", {})
    typ = inc.get("type", {}) or {}
    descriptions = inc.get("descriptions") or [{}]
    inputs = scenario.get("inputs") or []
    applicant = inc.get("applicant", {}) or {}
    samples = exp.get("sample") or {}
    lines = [
        "Ты пишешь учебный сценарий для тренажёра диспетчера ДДС (дежурно-диспетчерской службы "
        "управы района) системы 112 Москвы. Данные синтетические.",
        "",
        f"Тип происшествия: {typ.get('finalType', '')} (группа «{typ.get('card', '')}»)",
        f"Признаки: {', '.join(typ.get('signs') or [])}",
        f"Адрес: {_address(scenario)}",
        f"Заявитель: {applicant.get('name', '')}, {applicant.get('status', '')}",
        "Скрытая особенность (диспетчер выясняет её сам — в title, description и inputs "
        "не упоминай): " + COMPLICATION_HINTS.get(complication, DEFAULT_HINT),
        f"Сложность: {DIFFICULTY_HINTS.get(difficulty, DIFFICULTY_HINTS[1])}",
        f"Верные действия диспетчера: статусы {' → '.join(exp.get('path') or [])}",
        f"Эталонные комментарии: {'; '.join(f'{k}: {v}' for k, v in samples.items())}",
        "",
        "Черновик (перепиши живее и конкретнее, факты не меняй):",
        f"title: {scenario.get('title', '')}",
        f"description: {descriptions[0].get('text', '')}",
        f"chief_reply: {scenario.get('chiefReply', '')}",
        f"sample_report: {exp.get('sampleReport', '')}",
        "inputs: " + " | ".join(i.get("text", "") for i in inputs),
        "",
        "Требования:",
        "title — короткое название сценария, до 90 знаков;",
        "description — описание происшествия, как его записал оператор 112 со слов заявителя: "
        "2–4 предложения, конкретные детали (этаж, что видно, есть ли пострадавшие); "
        "адрес не повторяй;",
        "chief_reply — ответ руководителя диспетчеру по телефону, разговорный, 1–3 предложения, "
        "сохрани названия организаций из черновика, закончи «Конец связи.»;",
        "sample_report — эталонный доклад диспетчера руководителю: начни «Докладываю:», назови "
        "улицу и номер дома, суть происшествия и принятые меры;",
        f"inputs — ровно {len(inputs)} реплик исполнителя в том же порядке и с тем же смыслом "
        "(пустой список, если черновик пуст).",
        "Пиши по-русски. Ответь только JSON.",
    ]
    return "\n".join(lines)


def _text(value: Any, lo: int, hi: int) -> str | None:
    s = " ".join(str(value or "").split())
    return s if lo <= len(s) <= hi else None


def _letters(text: str) -> str:
    # «Д.Д.С.», «д-д-с» и «не  наш» сводим к буквам, чтобы их не пропустить
    return re.sub(r"[^а-яёa-z]+", "", text.lower())


def _spoils(text: str) -> bool:
    low = _letters(text)
    return any(_letters(s) in low for s in SPOILERS)


def _check_shape(draft: dict[str, Any]) -> None:
    inc = draft.get("incident")
    if not isinstance(inc, dict):
        raise ValueError("scenario.incident is required")
    desc = inc.get("descriptions")
    if not isinstance(desc, list) or not desc or not isinstance(desc[0], dict):
        raise ValueError("scenario.incident.descriptions must be a non-empty list")
    for key in ("expected",):
        if draft.get(key) is not None and not isinstance(draft[key], dict):
            raise ValueError(f"scenario.{key} must be an object")
    if draft.get("inputs") is not None and not isinstance(draft["inputs"], list):
        raise ValueError("scenario.inputs must be a list")


def compose_scenario(body: dict[str, Any], llm: LLMProvider | None) -> dict[str, Any]:
    draft = body.get("scenario")
    if not isinstance(draft, dict):
        raise ValueError("scenario is required")
    _check_shape(draft)
    complication = str(body.get("complication") or "none")
    difficulty = int(body.get("difficulty") or draft.get("difficulty") or 1)
    scenario = copy.deepcopy(draft)
    if not isinstance(scenario.get("expected"), dict):
        scenario["expected"] = {}
    exp = scenario["expected"]

    out = ask_json(
        llm,
        _prompt(draft, complication, difficulty),
        schema=COMPOSE_SCHEMA,
        max_tokens=700,
        timeout_s=COMPOSE_TIMEOUT_S,
    )
    applied: list[str] = []
    rejected: list[str] = []
    if out is not None:
        title = _text(out.get("title"), 8, 120)
        if title is not None and not _spoils(title):
            scenario["title"] = title
            applied.append("title")
        elif out.get("title"):
            rejected.append("title")
        desc = _text(out.get("description"), 30, 700)
        if desc is not None and not _spoils(desc):
            scenario["incident"]["descriptions"][0]["text"] = desc
            applied.append("description")
        elif out.get("description"):
            rejected.append("description")

        # ответ руководителя должен сохранить организацию, куда передаётся информация
        chief = _text(out.get("chief_reply"), 10, 400)
        org = (
            (exp.get("commentMustMention") or [[]])[0]
            if complication in {"zone", "refusal"}
            else []
        )
        if chief and (not org or not match_groups(chief, [org])[1]):
            scenario["chiefReply"] = chief
            applied.append("chiefReply")
        elif out.get("chief_reply"):
            rejected.append("chiefReply")

        # эталонный доклад должен проходить ту же проверку, что и доклад обучающегося
        report = _text(out.get("sample_report"), 15, 400)
        if report and not match_groups(report, exp.get("reportMustMention") or [])[1]:
            exp["sampleReport"] = report
            applied.append("sampleReport")
        elif out.get("sample_report"):
            rejected.append("sampleReport")

        inputs = scenario.get("inputs") or []
        texts = [_text(t, 3, 300) for t in out.get("inputs") or []]
        if inputs and len(texts) == len(inputs) and all(texts):
            for item, text in zip(inputs, texts, strict=True):
                item["text"] = text
            applied.append("inputs")

    if applied:
        note = (
            "Текст сценария написан языковой моделью; "
            "эталон и проверки — по правилам классификатора."
        )
        exp["explanation"] = f"{exp.get('explanation', '')} {note}".strip()

    return {
        "scenario": scenario,
        "by": "llm" if applied else "template",
        "applied": applied,
        "rejected": rejected,
        "model": None if llm is None else llm.model_ref.model_dump(mode="json"),
    }
