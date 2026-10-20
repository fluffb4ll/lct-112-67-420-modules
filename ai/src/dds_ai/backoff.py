"""Повтор неудачной загрузки модели с экспоненциальной паузой.

Модели (LLM, whisper, голоса Piper) лежат в томе, который сервис models докачивает параллельно
с запуском ИИ-контура: файла может ещё не быть или он недокачан. Сервис не перезапускают —
он пробует снова: после первой неудачи через `first_s`, дальше пауза удваивается до `max_s`;
удачная загрузка сбрасывает счёт. Между попытками запросы сразу идут по запасному пути
(правила, голос браузера), а не ждут загрузку.
"""

from __future__ import annotations

import time
from collections.abc import Callable

LOAD_RETRY_FIRST_S = 60.0
LOAD_RETRY_MAX_S = 900.0


class Backoff:
    def __init__(
        self,
        clock: Callable[[], float] = time.monotonic,
        *,
        first_s: float = LOAD_RETRY_FIRST_S,
        max_s: float = LOAD_RETRY_MAX_S,
    ):
        self._clock = clock
        self.first_s = first_s
        self.max_s = max_s
        self.failures = 0
        self._failed_at = 0.0

    @property
    def delay_s(self) -> float:
        """Пауза после последней неудачи: first_s, 2·first_s, 4·first_s… не больше max_s."""
        if not self.failures:
            return 0.0
        return min(self.max_s, self.first_s * 2 ** min(self.failures - 1, 32))

    def waiting(self) -> bool:
        """Пауза после неудачи ещё идёт — новую попытку не начинать."""
        return self.failures > 0 and self._clock() - self._failed_at < self.delay_s

    def failed(self) -> None:
        self.failures += 1
        self._failed_at = self._clock()

    def succeeded(self) -> None:
        self.failures = 0
