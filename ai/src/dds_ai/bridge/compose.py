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
import time
from typing import Any

from ..ports import LLMProvider
from .llm import ask_json
from .rules import match_groups

log = logging.getLogger(__name__)

# Пять полей просятся двумя запросами, а не одним. Адаптер llama.cpp по тайм-ауту выбрасывает
# всё, что успел написать, поэтому один длинный ответ на слабом сервере пропадает целиком и
# сценарий остаётся шаблонным. Сначала спрашиваем то, что видно преподавателю и обучающемуся —
# название и описание; служебные тексты идут вторым запросом, на остаток срока.
TEXT_SCHEMA = {
    "type": "object",
    "properties": {"title": {"type": "string"}, "description": {"type": "string"}},
    "required": ["title", "description"],
    "additionalProperties": False,
}
REST_SCHEMA = {
    "type": "object",
    "properties": {
        "chief_reply": {"type": "string"},
        "sample_report": {"type": "string"},
        "inputs": {"type": "array", "items": {"type": "string"}, "maxItems": 4},
    },
    "required": ["chief_reply", "sample_report", "inputs"],
    "additionalProperties": False,
}

# Сроки — запас, а не цель: модель останавливается на закрывающей скобке JSON, и когда она
# успевает, длинный срок ничего не стоит. Поэтому запас щедрый: пусть лучше медленный сервер
# допишет за три минуты, чем карточка в сотый раз останется шаблонной.
TEXT_TIMEOUT_S = 110.0
TEXT_TOKENS = 320
REST_TIMEOUT_S = 70.0
REST_TOKENS = 420
# Небольшая модель с первого раза часто промахивается мимо требований; повтор короче и по
# сроку, и по длине — помогает и когда написано негодное, и когда не успела
RETRY_TIMEOUT_S = 40.0
RETRY_TOKENS = 240
# Общий срок на все запросы одной карточки. Дальше ждёт уже не фронт, а nginx, и ответ
# пропадёт зря, поэтому сроки согласованы: здесь три минуты, у nginx и фронта — по 200 с
BUDGET_S = 180.0
MIN_SLICE_S = 20.0
RETRY_HINT = (
    "\nПредыдущий ответ не подошёл: он не выполнил требования выше. "
    "Напиши заново, короче и строго по требованиям. Ответь только JSON."
)

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
# «progress» тоже скрыт (промпт и фронт: особенность в title/description не называется):
# обучающийся сам доводит карточку до «Работы завершены». Выдаёт его ход работ службы —
# выезд, прибытие, завершение; просьба заявителя «устранить» — нет, «устранено» — да.
PROGRESS_SPOILERS = (
    r"ддс",
    r"выезд",
    r"выех",
    r"прибы",
    r"заверш",
    r"устранен",
    r"бригад",
    r"ход работ",
)


def _spoiler_re(parts: tuple[str, ...]) -> re.Pattern[str]:
    return re.compile(r"(?<![а-яa-z0-9])(?:" + "|".join(parts) + ")")


_SPOILER_RES = {
    "zone": _spoiler_re(SPOILERS),
    "duplicate": _spoiler_re(SPOILERS),
    "refusal": _spoiler_re(SPOILERS),
    "progress": _spoiler_re(PROGRESS_SPOILERS),
}
HIDDEN_COMPLICATIONS = frozenset(_SPOILER_RES)

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


def _context(scenario: dict[str, Any], complication: str, difficulty: int) -> list[str]:
    """Общая часть обоих запросов: что за происшествие и кто звонит."""
    inc = scenario.get("incident", {})
    typ = inc.get("type", {}) or {}
    applicant = inc.get("applicant", {}) or {}
    return [
        "Ты пишешь учебный сценарий для тренажёра диспетчера дежурно-диспетчерской службы "
        "управы района (система 112 Москвы). Данные синтетические.",
        "",
        f"Тип происшествия: {typ.get('finalType', '')} (группа «{typ.get('card', '')}»)",
        f"Признаки: {', '.join(typ.get('signs') or [])}",
        f"Адрес: {_address(scenario)}",
        f"Заявитель: {applicant.get('name', '')}, {applicant.get('status', '')}",
        "Скрытая особенность (диспетчер выясняет её сам, писать о ней нельзя): "
        + COMPLICATION_HINTS.get(complication, DEFAULT_HINT),
        f"Сложность: {DIFFICULTY_HINTS.get(difficulty, DIFFICULTY_HINTS[1])}",
        "",
    ]


def _text_prompt(scenario: dict[str, Any], complication: str, difficulty: int) -> str:
    """То, что видно в банке и в занятии: название и описание происшествия."""
    return "\n".join(
        _context(scenario, complication, difficulty)
        + [
            # черновые title и description не показываем: модель их повторяет слово в слово
            "Требования:",
            "title — короткое название сценария, до 90 знаков;",
            "description — описание происшествия, как его записал оператор 112 со слов "
            "заявителя: 2–4 предложения, конкретные детали (этаж, что видно, есть ли "
            "пострадавшие); адрес не повторяй; не пиши «Признаки:» и не перечисляй признаки "
            "списком. Пример: «Звонит соседка: в лифте третьего подъезда застрял мужчина, "
            "кабина стоит между 5 и 6 этажами, свет есть, отвечает через дверь. "
            "Пострадавших нет.»",
            # служебные слова задания модель охотно повторяет, а проверка такой текст
            # отклоняет и оставляет шаблон — просим не брать их сразу
            "Не пиши служебные слова задания: ДДС, реагирование, организация, дубль, "
            "зарегистрирована, отказ, чужой. Пиши только о самом происшествии.",
            "Пиши по-русски. Ответь только JSON.",
        ]
    )


def _rest_prompt(scenario: dict[str, Any], complication: str, difficulty: int) -> str:
    """Служебные тексты: ответ руководителя, эталонный доклад, реплики исполнителя."""
    exp = scenario.get("expected", {}) or {}
    samples = exp.get("sample") or {}
    inputs = scenario.get("inputs") or []
    return "\n".join(
        _context(scenario, complication, difficulty)
        + [
            f"Верные действия диспетчера: статусы {' → '.join(exp.get('path') or [])}",
            f"Эталонные комментарии: {'; '.join(f'{k}: {v}' for k, v in samples.items())}",
            "",
            "Черновик (перепиши живее, факты и названия организаций не меняй):",
            f"chief_reply: {scenario.get('chiefReply', '')}",
            f"sample_report: {exp.get('sampleReport', '')}",
            "inputs: " + " | ".join(i.get("text", "") for i in inputs),
            "",
            "Требования:",
            "chief_reply — ответ руководителя диспетчеру по телефону, разговорный, "
            "1–3 предложения, сохрани названия организаций из черновика, закончи "
            "«Конец связи.»;",
            "sample_report — эталонный доклад диспетчера руководителю: начни «Докладываю:», "
            "назови улицу и номер дома, суть происшествия и принятые меры;",
            f"inputs — ровно {len(inputs)} реплик исполнителя в том же порядке и с тем же "
            "смыслом (пустой список, если черновик пуст).",
            "Пиши по-русски. Ответь только JSON.",
        ]
    )


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


def _spoils(text: str, complication: str) -> bool:
    spoiler = _SPOILER_RES.get(complication)
    return spoiler is not None and spoiler.search(" ".join(_words(text))) is not None


def _same_root(a: str, b: str) -> bool:
    """Одно слово в другой форме: общее начало из 5 букв или из 4, если дальше только окончание.

    Короткие слова («в», «не», «дом») — только целиком, иначе все слова на «в» стали бы старыми.
    Окончание — до двух букв сверх общего начала у более короткого слова: «лифтах» = «лифте»,
    «лифтом» = «лифта»; «переход» ≠ «перекрыт».
    """
    if a == b:
        return True
    n = min(len(a), len(b))
    p = next((i for i in range(n) if a[i] != b[i]), n)
    return p >= 5 or (p >= 4 and p >= n - 2)


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


def _digits(text: str) -> set[str]:
    return set(re.findall(r"\d+", text))


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


def _apply(
    out: dict[str, Any],
    scenario: dict[str, Any],
    exp: dict[str, Any],
    draft: dict[str, Any],
    complication: str,
) -> tuple[list[str], list[str]]:
    """Переносит текст модели в сценарий поле за полем: (что приняли, что отклонили).

    Повтор сверяется с черновиком `draft`, а не со сценарием: тот к второму запросу уже переписан.
    """
    applied: list[str] = []
    rejected: list[str] = []
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
        elif _spoils(text, complication):
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

    # Ответ руководителя должен сохранить организацию, куда передаётся информация, и её номер:
    # по этому номеру обучающийся звонит, выдуманный уведёт его в никуда. Поэтому цифры в
    # ответе модели разрешены только те, что уже есть в черновике и в адресе.
    chief = _text(out.get("chief_reply"), 10, 400)
    org = (exp.get("commentMustMention") or [[]])[0] if complication in {"zone", "refusal"} else []
    known = _digits(f"{draft.get('chiefReply', '')} {address}")
    if chief and _same(chief, draft.get("chiefReply")):
        log.info("compose: поле chiefReply не применено — совпадает с черновиком")
    elif chief and _digits(chief) - known:
        reject("chiefReply", "цифры, которых нет в черновике и адресе")
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
    # совпадение с черновиком — только при том же числе реплик, иначе это отказ по числу
    same = len(texts) == len(inputs) and all(
        t is not None and _same(t, i.get("text")) for t, i in zip(texts, inputs, strict=True)
    )
    if inputs and len(texts) == len(inputs) and all(texts) and not same:
        for item, text in zip(inputs, texts, strict=True):
            item["text"] = text
        applied.append("inputs")
    elif out.get("inputs") and not (inputs and same):
        reject("inputs", "число реплик не совпадает с черновиком или длина")
    return applied, rejected


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

    applied: list[str] = []
    rejected: list[str] = []
    started = time.monotonic()

    def left() -> float:
        return BUDGET_S - (time.monotonic() - started)

    def ask(prompt: str, schema: dict[str, Any], tokens: int, limit: float) -> None:
        nonlocal applied, rejected
        out = ask_json(llm, prompt, schema=schema, max_tokens=tokens, timeout_s=min(limit, left()))
        if out is None:
            return
        got, bad = _apply(out, scenario, exp, draft, complication)
        applied = list(dict.fromkeys(applied + got))
        rejected = list(dict.fromkeys(rejected + bad))

    if llm is not None:
        text_prompt = _text_prompt(draft, complication, difficulty)
        ask(text_prompt, TEXT_SCHEMA, TEXT_TOKENS, TEXT_TIMEOUT_S)
        # ради названия и описания генерацию и запускают: не вышло — просим ещё раз, короче
        if not {"title", "description"} & set(applied) and left() >= MIN_SLICE_S:
            ask(text_prompt + RETRY_HINT, TEXT_SCHEMA, RETRY_TOKENS, RETRY_TIMEOUT_S)
        if left() >= MIN_SLICE_S:
            ask(
                _rest_prompt(draft, complication, difficulty),
                REST_SCHEMA,
                REST_TOKENS,
                REST_TIMEOUT_S,
            )

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
