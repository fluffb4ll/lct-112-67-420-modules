"""Ответ абонента в учебном телефоне (`POST /v1/dialogue/reply`).

Обучающийся ДДС звонит руководителю смены, мастеру участка или в аварийную службу и докладывает
голосом. До сих пор отвечал шаблон на фронте — одна фраза на все случаи. Здесь реплику пишет
модель: ей дают роль абонента, краткую карточку, ход разговора и то, что сейчас сказал
обучающийся. Модель только формулирует ответ — она не ставит статусы, не меняет карточку и не
влияет на оценку.

Правила те же, что у остальных мостов: любая осечка — и возвращается присланный фронтом
шаблон (`fallback`), чтобы разговор не оборвался. Числа в ответе разрешены только те, что есть
во входных данных: модель не должна выдумывать адреса, номера нарядов и время.
"""

from __future__ import annotations

import re
from typing import Any

from ..ports import LLMProvider
from .llm import ask_json

REPLY_SCHEMA = {
    "type": "object",
    "properties": {"reply": {"type": "string"}},
    "required": ["reply"],
    "additionalProperties": False,
}

# Телефонный разговор не терпит пауз: ждём модель недолго, дальше отвечает шаблон.
REPLY_TIMEOUT_S = 9.0
MAX_REPLY_TOKENS = 96
MAX_REPLY_CHARS = 300
MAX_HISTORY_TURNS = 4
# Короткая или повторная реплика диспетчера — отвечаем шаблоном сразу, не тратя время модели
MIN_WORDS_FOR_LLM = 4

# Кем может быть собеседник: от роли зависит, что он вправе сказать
ROLE_HINTS = {
    "chief": "вы руководитель дежурной смены: выслушиваете доклад, при нехватке данных требуете их, затем даёте короткое указание",
    "master": "вы мастер участка ГБУ «Жилищник»: принимаете заявку и говорите, кого и когда направите",
    "emergency": "вы дежурный аварийной службы: принимаете заявку на выезд и называете, что сделает бригада",
    "other": "вы дежурный сторонней организации: принимаете сведения и говорите, что передадите их по назначению",
}

_DIGITS = re.compile(r"\d+")


def _digits(text: str) -> set[str]:
    return set(_DIGITS.findall(text))


def _line(who: str, text: str) -> str:
    return f"{'диспетчер' if who == 'me' else 'абонент'}: {text.strip()}"


def _prompt(role: str, role_key: str, card: dict[str, Any], history: list[dict[str, Any]], said: str) -> str:
    facts = [
        f"адрес: {card.get('address') or 'не указан'}",
        f"происшествие: {card.get('incident') or 'не указано'}",
        f"со слов заявителя: {card.get('description') or 'нет описания'}",
        f"пострадавшие: {'есть' if card.get('victims') else 'нет данных'}",
    ]
    talk = [_line(str(t.get("who")), str(t.get("text") or "")) for t in history[-MAX_HISTORY_TURNS:] if t.get("text")]
    return (
        "Вы участник учебного телефонного разговора дежурно-диспетчерской службы города Москвы.\n"
        f"Ваша роль: {role}. {ROLE_HINTS.get(role_key, ROLE_HINTS['other'])}.\n"
        "Вам звонит диспетчер ДДС и докладывает по карточке происшествия.\n\n"
        "Карточка:\n" + "\n".join(f"- {f}" for f in facts) + "\n\n"
        + ("Разговор до этого:\n" + "\n".join(talk) + "\n\n" if talk else "")
        + f"Диспетчер сейчас сказал: «{said.strip()}»\n\n"
        "Ответьте одной-двумя фразами живой русской речью, как по телефону. Не повторяйте доклад дословно. "
        "Если в докладе нет адреса или сути происшествия — потребуйте их назвать. "
        "Не выдумывайте номера, адреса, время и фамилии, которых нет выше. "
        "Не ставьте статусы в карточке и не оценивайте работу диспетчера.\n"
        'Ответ верните как JSON: {"reply": "текст реплики"}'
    )


def _clean(text: str) -> str:
    return " ".join(text.replace("\n", " ").split()).strip().strip('"«»')


def dialogue_reply(body: dict[str, Any], llm: LLMProvider | None) -> dict[str, Any]:
    """Реплика абонента на доклад обучающегося; при любой осечке — шаблон фронта."""
    role = str(body.get("role") or "руководитель дежурной смены")
    role_key = str(body.get("roleKey") or "other")
    said = str(body.get("said") or "").strip()
    fallback = _clean(str(body.get("fallback") or "Вас понял. Конец связи."))
    card = body.get("card") if isinstance(body.get("card"), dict) else {}
    history = body.get("history") if isinstance(body.get("history"), list) else []

    if not said:
        return {"reply": "Алло, вас не слышно. Перезвоните, пожалуйста.", "by": "template"}

    # на «алло» и оборванные фразы модель звать незачем — шаблон отвечает мгновенно
    if len(said.split()) < MIN_WORDS_FOR_LLM:
        return {"reply": fallback, "by": "template"}

    data = ask_json(
        llm,
        _prompt(role, role_key, card or {}, history or [], said),
        schema=REPLY_SCHEMA,
        max_tokens=MAX_REPLY_TOKENS,
        timeout_s=REPLY_TIMEOUT_S,
    )
    text = _clean(str(data.get("reply") or "")) if data else ""

    # проверки: не пустая, не длиннее реплики по телефону, без выдуманных чисел
    allowed = " ".join([said, str(card.get("address") or ""), str(card.get("incident") or ""), str(card.get("description") or "")])
    if not text or len(text) > MAX_REPLY_CHARS or _digits(text) - _digits(allowed):
        return {"reply": fallback, "by": "template"}
    return {"reply": text, "by": "llm"}
