"""Генерация сценария для банка преподавателя (`POST /v1/scenarios/compose`).

Фронт присылает заготовку `Scenario` (своя модель, `frontend/src/domain/types.ts`), собранную по
классификатору: тип происшествия, адрес, службы, осложнение и эталон (`expected`). Эталон и
структуру строят правила — от них зависит оценка, их модель не трогает. Модель пишет живой текст:
название, описание происшествия со слов заявителя, ответ руководителя, эталонный доклад и реплики
исполнителей. Каждое поле проверяется; не прошло проверку — остаётся текст шаблона.

Проверки поля (причина отказа пишется в лог INFO, без текста сценария):
- длина в пределах поля;
- не повтор шаблона: маленькая модель любит вернуть черновик слово в слово и дописать адрес
  (так было со сценарием b7392178: `applied` с description, а в банке шаблон «Признаки: …»).
  Название и описание засчитываются, только если в них хотя бы `ECHO_MIN_NEW_WORDS` новых слов —
  не из черновика и не из адреса (слова короче 4 букв сверяются целиком, длинные — по началу);
  остальные поля, совпавшие с черновиком, просто не применяются;
- без спойлеров — только для скрытых осложнений (zone, duplicate, refusal): регулярные выражения
  по началу слова, чтобы «не нашли», «не нашёл» не считались «не наш».
"""

from __future__ import annotations

import copy
import logging
import re
from typing import Any

from ..ports import LLMProvider
from .llm import ask_json
from .rules import match_groups

log = logging.getLogger(__name__)

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
# выдавать её не должны. Каждое выражение привязано к началу слова (см. `_spoils`).
SPOILERS = (
    r"ддс",
    r"реагир",
    r"не должн",
    r"дубл",
    r"организац",
    r"чуж",
    r"проводить не будут",
    r"зарегистрирован",
    r"не наш(?!е?л)",
    r"отказ от",
    r"откаж",
    r"отказыва",
)
_SPOILER_RE = re.compile(r"(?<![а-яa-z0-9])(?:" + "|".join(SPOILERS) + ")")
HIDDEN_COMPLICATIONS = frozenset({"zone", "duplicate", "refusal"})

# сколько слов, которых нет ни в черновике, ни в адресе, нужно, чтобы текст не считался повтором
ECHO_MIN_NEW_WORDS = 2
_ADDRESS_WORDS = frozenset({"улица", "ул", "дом", "корп", "корпус", "подъезд", "кв"})

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
        # черновые title и description не показываем: модель их повторяет слово в слово
        "Черновик реплик (перепиши живее, факты и названия организаций не меняй):",
        f"chief_reply: {scenario.get('chiefReply', '')}",
        f"sample_report: {exp.get('sampleReport', '')}",
        "inputs: " + " | ".join(i.get("text", "") for i in inputs),
        "",
        "Требования:",
        "title — короткое название сценария, до 90 знаков;",
        "description — описание происшествия, как его записал оператор 112 со слов заявителя: "
        "2–4 предложения, конкретные детали (этаж, что видно, есть ли пострадавшие); "
        "адрес не повторяй; не пиши «Признаки:» и не перечисляй признаки списком. Пример: "
        "«Звонит соседка: в лифте третьего подъезда застрял мужчина, кабина стоит между 5 и 6 "
        "этажами, свет есть, отвечает через дверь. Пострадавших нет.»;",
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


def _words(text: str) -> list[str]:
    # «Д.Д.С.» и «д-д-с» склеиваем обратно в «ддс»: цепочка однобуквенных слов — одно слово
    out: list[str] = []
    run = ""
    for w in re.findall(r"[а-яa-z0-9]+", text.lower().replace("ё", "е")):
        if len(w) == 1 and w.isalpha():
            run += w
            continue
        if run:
            out.append(run)
            run = ""
        out.append(w)
    if run:
        out.append(run)
    return out


def _spoils(text: str) -> bool:
    return _SPOILER_RE.search(" ".join(_words(text))) is not None


def _same_root(a: str, b: str) -> bool:
    # короткие слова («в», «не», «дом») — только целиком, иначе все слова на «в» стали бы старыми
    n = min(5, len(a), len(b))
    return a[:n] == b[:n] if n >= 4 else a == b


def _new_words(text: str, *known: str) -> int:
    seen = [w for k in known for w in _words(k)]
    return sum(
        1
        for w in _words(text)
        if len(w) >= 3
        and not w.isdigit()
        and w not in _ADDRESS_WORDS
        and not any(_same_root(w, k) for k in seen)
    )


def _echoes(text: str, draft_text: str, address: str) -> bool:
    return _new_words(text, draft_text, address) < ECHO_MIN_NEW_WORDS


def _same(text: str, draft_text: Any) -> bool:
    return _words(text) == _words(str(draft_text or ""))


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
        hidden = complication in HIDDEN_COMPLICATIONS
        address = _address(draft)

        def reject(field: str, reason: str) -> None:
            rejected.append(field)
            log.info("compose: поле %s не применено — %s", field, reason)

        def check_free_text(field: str, value: Any, draft_text: str, lo: int, hi: int):
            text = _text(value, lo, hi)
            if text is None:
                reject(field, f"длина вне {lo}–{hi} знаков")
            elif _echoes(text, draft_text, address):
                reject(field, "повтор шаблона")
            elif hidden and _spoils(text):
                reject(field, "выдаёт скрытое осложнение")
            else:
                return text
            return None

        if out.get("title"):
            title = check_free_text("title", out["title"], str(draft.get("title") or ""), 8, 120)
            if title is not None:
                scenario["title"] = title
                applied.append("title")
        if out.get("description"):
            draft_desc = str(draft["incident"]["descriptions"][0].get("text") or "")
            desc = check_free_text("description", out["description"], draft_desc, 30, 700)
            if desc is not None:
                scenario["incident"]["descriptions"][0]["text"] = desc
                applied.append("description")

        # ответ руководителя должен сохранить организацию, куда передаётся информация
        chief = _text(out.get("chief_reply"), 10, 400)
        org = (
            (exp.get("commentMustMention") or [[]])[0]
            if complication in {"zone", "refusal"}
            else []
        )
        if chief and _same(chief, draft.get("chiefReply")):
            log.info("compose: поле chiefReply не применено — совпадает с черновиком")
        elif chief and (not org or not match_groups(chief, [org])[1]):
            scenario["chiefReply"] = chief
            applied.append("chiefReply")
        elif out.get("chief_reply"):
            reject("chiefReply", "нет организации из эталона или длина")

        # эталонный доклад должен проходить ту же проверку, что и доклад обучающегося
        report = _text(out.get("sample_report"), 15, 400)
        if report and _same(report, (draft.get("expected") or {}).get("sampleReport")):
            log.info("compose: поле sampleReport не применено — совпадает с черновиком")
        elif report and not match_groups(report, exp.get("reportMustMention") or [])[1]:
            exp["sampleReport"] = report
            applied.append("sampleReport")
        elif out.get("sample_report"):
            reject("sampleReport", "не проходит проверку доклада или длина")

        inputs = scenario.get("inputs") or []
        texts = [_text(t, 3, 300) for t in out.get("inputs") or []]
        same = all(
            t is not None and _same(t, i.get("text")) for t, i in zip(texts, inputs, strict=False)
        )
        if inputs and len(texts) == len(inputs) and all(texts) and not same:
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
