"""Вызов LLM с JSON-ответом для моста: своя схема, свой срок, разбор и деградация.

У `LlamaCppProvider` есть `complete_json` (грамматика под схему). У других провайдеров (фейки в
тестах) — только `complete`; тогда JSON ищется в тексте ответа. Любой сбой — `None`, вызывающий
код работает на правилах или шаблоне, а не падает (инвариант 4). Исключение — `LLMBusy`
(модель занята другим запросом): его вызывающий код показывает пользователю отдельно.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from ..llm.errors import LLMBusy
from ..ports import LLMProvider

log = logging.getLogger(__name__)
_JSON = re.compile(r"\{.*\}", re.S)


def ask_json(
    llm: LLMProvider | None,
    prompt: str,
    *,
    schema: dict[str, Any],
    max_tokens: int,
    timeout_s: float,
) -> dict[str, Any] | None:
    if llm is None:
        return None
    try:
        complete_json = getattr(llm, "complete_json", None)
        if complete_json is not None:
            raw = complete_json(prompt, schema=schema, max_tokens=max_tokens, timeout_s=timeout_s)
        else:
            raw = llm.complete(prompt, max_tokens=max_tokens)
        m = _JSON.search(raw)
        if m is None:
            raise ValueError("no JSON object in model output")
        data = json.loads(m.group(0))
        if not isinstance(data, dict):
            raise ValueError("model output is not an object")
        return data
    except LLMBusy:
        raise
    except Exception as exc:  # модель недоступна, тайм-аут, мусор на выходе
        log.warning("LLM call failed: %s", exc)
        return None
