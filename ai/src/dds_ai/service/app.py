"""HTTP-сервис ИИ-контура: контракты и учебная попытка на синтетических сценариях.

Транспорт — черновик до ответа B03 (gRPC или HTTP + WebSocket); схемы сообщений — те же
контракты, что в `/contracts`. Попытки хранятся в памяти процесса: журнал, оценки и профили
хранит бэкенд (docs/ai/agent-prompt.md, 4.3), здесь — только то, что нужно для интеграции и демо.

Модель LLM подключается переменной `DDS_LLM_MODEL_PATH` (локальный GGUF, extra
`ai[llm-llamacpp]`). Без неё руководитель работает на проверенном шаблоне (fallback, C-04), а
семантические критерии получают «не проверено» — итог предварительный. Файла ещё нет (сервис
models докачивает том) или загрузка упала — сервис пробует снова с растущей паузой
(`dds_ai.backoff`), без перезапуска.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import UUID

from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field, TypeAdapter
from starlette.concurrency import run_in_threadpool

from dds_ai import __version__
from dds_ai.backoff import Backoff
from dds_ai.bridge.compose import compose_scenario
from dds_ai.bridge.dialogue import dialogue_reply
from dds_ai.bridge.evaluate import evaluate_card
from dds_ai.bridge.voice import AudioTooLarge, VoiceService, VoiceUnavailable
from dds_ai.contracts import CONTRACTS_VERSION, SCHEMA_MODELS
from dds_ai.contracts.events import DispatcherDecision, attempt_event_adapter
from dds_ai.contracts.rubric import Rubric
from dds_ai.cycle import Channel, TrainingSession, load_synthetic
from dds_ai.llm.errors import LLMBusy
from dds_ai.ports import LLMProvider, SemanticJudge

log = logging.getLogger(__name__)

CONFIG = Path(__file__).resolve().parents[3] / "config"


class WallClock:
    """Реальное время для сервиса; `advance` есть у тестовых часов, здесь он ничего не делает."""

    def __call__(self) -> datetime:
        return datetime.now(UTC)

    def advance(self, seconds: float) -> datetime:
        return self()


class CreateAttempt(BaseModel):
    scenario_id: str
    card_seed: int | None = None


class EditCard(BaseModel):
    values: dict[str, Any] = Field(min_length=1)


class Decide(BaseModel):
    decision: DispatcherDecision


class Say(BaseModel):
    text: str = Field(min_length=1)


class Speak(BaseModel):
    text: str
    voice: str = "female"
    intonation: str = "neutral"


class Submit(BaseModel):
    incomplete: bool = False


Models = tuple[LLMProvider | None, SemanticJudge | None]


def _llm_threads() -> int:
    """Потоки llama.cpp: DDS_LLM_N_THREADS или все доступные процессу ядра.

    Без явного числа llama-cpp-python берёт половину ядер: на стенде с 2 vCPU это один поток.
    """
    raw = os.environ.get("DDS_LLM_N_THREADS", "").strip()
    if raw:
        return max(1, int(raw))
    affinity = getattr(os, "sched_getaffinity", None)
    return max(1, len(affinity(0)) if affinity else os.cpu_count() or 1)


def _load_models() -> Models:
    """LLM из DDS_LLM_MODEL_PATH; не задана — (None, None). Нет файла, пакета, сбой — исключение."""
    path = os.environ.get("DDS_LLM_MODEL_PATH")
    if not path:
        return None, None
    if not Path(path).is_file():
        raise FileNotFoundError(f"нет файла {path}")
    from dds_ai.judging import LLMSemanticJudge
    from dds_ai.llm.llamacpp_provider import LlamaCppProvider

    llm = LlamaCppProvider(
        path,
        model_name=os.environ.get("DDS_LLM_MODEL_NAME") or None,
        n_ctx=int(os.environ.get("DDS_LLM_N_CTX", "4096")),
        n_threads=_llm_threads(),
    )
    return llm, LLMSemanticJudge(llm)


class LazyModels:
    """LLM и судья: загрузка при создании и, если не вышло, повтор с растущей паузой.

    Повтор делает запрос, пришедший после паузы (без фоновых потоков); пока одна загрузка идёт,
    остальные запросы её не ждут и считают по правилам. Модель задана явно — без загрузчика.
    """

    def __init__(
        self,
        loader: Callable[[], Models] | None,
        clock: Callable[[], float] = time.monotonic,
        models: Models = (None, None),
    ):
        self._loader = loader
        self._retry = Backoff(clock)
        self._loading = threading.Lock()
        self.llm, self.judge = models
        self.get()

    def get(self) -> Models:
        if (
            self.llm is None
            and self._loader is not None
            and not self._retry.waiting()
            and self._loading.acquire(blocking=False)
        ):
            try:
                self._load(self._loader)
            finally:
                self._loading.release()
        return self.llm, self.judge

    def _load(self, loader: Callable[[], Models]) -> None:
        try:
            llm, judge = loader()
        except Exception as exc:
            self._retry.failed()
            log.warning(
                "LLM не загружена (%s) — оценка и сценарии по правилам, повтор через %g с",
                exc,
                self._retry.delay_s,
            )
            return
        if llm is None:
            self._loader = None  # модель не задана — пробовать нечего
            return
        self._retry.succeeded()
        self.llm, self.judge = llm, judge


def _dump(obj: Any) -> Any:
    if isinstance(obj, BaseModel):
        return obj.model_dump(mode="json")
    return obj


def create_app(
    *,
    llm: LLMProvider | None = None,
    judge: SemanticJudge | None = None,
    voice: VoiceService | None = None,
    load_models: Callable[[], Models] = _load_models,
    clock: Callable[[], float] = time.monotonic,
) -> FastAPI:
    explicit = llm is not None or judge is not None
    models = LazyModels(None if explicit else load_models, clock, (llm, judge))
    voice = voice or VoiceService()
    rubric = Rubric.model_validate(json.loads((CONFIG / "rubric.w01.json").read_text("utf-8")))
    scenarios = load_synthetic()
    attempts: dict[UUID, TrainingSession] = {}
    lock = threading.Lock()

    app = FastAPI(
        title="dds-ai",
        version=__version__,
        description="ИИ-контур тренажёра диспетчера ДДС. Контракты — черновик "
        f"{CONTRACTS_VERSION}; сценарии — синтетические.",
    )

    def get(attempt_id: UUID) -> TrainingSession:
        s = attempts.get(attempt_id)
        if s is None:
            raise HTTPException(404, "attempt not found")
        return s

    def events(s: TrainingSession) -> list[Any]:
        return [attempt_event_adapter.dump_python(e, mode="json") for e in s.events]

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "version": __version__,
            "contracts_version": CONTRACTS_VERSION,
            "llm": None if models.llm is None else _dump(models.llm.model_ref),
        }

    # --- мост к бэкенду (backend/.../client/AiEvaluationClient.java) ---

    @app.get("/api/v1/ai/preflight")
    def preflight() -> dict[str, Any]:
        def component(name: str, version: str | None) -> dict[str, Any]:
            return {
                "component": name,
                "health": "ok" if version is not None else "fallback",
                "modelVersion": version,
                "queueLength": 0,
                "lane": "local",
                "running": 0,
            }

        llm, _ = models.get()
        return {
            "profile": "offline",
            "components": [
                component("rules", __version__),
                component("llm", None if llm is None else llm.model_ref.model_version),
            ],
            "voicePathOk": True,
        }

    @app.post("/api/v1/ai/evaluate")
    def evaluate_submitted_card(body: dict[str, Any]) -> dict[str, Any]:
        # sync-обработчик: FastAPI выполняет его в пуле потоков, LLM не блокирует цикл событий
        llm, _ = models.get()
        try:
            return evaluate_card(body, llm)
        except Exception:
            if llm is None:
                raise
            # сбой судьи не должен оставлять карточку без оценки — считаем по правилам
            log.exception("LLM evaluation failed, falling back to rules")
            return evaluate_card(body, None)

    # --- мост к фронту (frontend/src/api/ai.ts, через nginx /ai/) ---

    @app.post("/v1/scenarios/compose")
    def compose(body: dict[str, Any]) -> dict[str, Any]:
        llm, _ = models.get()
        try:
            return compose_scenario(body, llm)
        except LLMBusy as exc:
            # фронт на любой ошибке оставляет текст шаблона; 503 — честнее, чем «by: template»
            raise HTTPException(
                503, "языковая модель занята другим запросом — повторите позже"
            ) from exc
        except (ValueError, KeyError, TypeError, AttributeError, IndexError) as exc:
            raise HTTPException(422, f"bad scenario draft: {exc}") from exc

    @app.post("/v1/dialogue/reply")
    def dialogue(body: dict[str, Any]) -> dict[str, Any]:
        # реплика абонента в учебном телефоне: модель формулирует, правила проверяют
        llm, _ = models.get()
        try:
            return dialogue_reply(body, llm)
        except LLMBusy:
            # занятую модель ждать нельзя — это телефонный разговор; фронт подставит шаблон
            raise HTTPException(503, "языковая модель занята другим запросом") from None
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            raise HTTPException(422, f"bad dialogue request: {exc}") from exc

    @app.get("/v1/voice")
    def voice_caps() -> dict[str, Any]:
        return voice.capabilities()

    @app.post("/v1/stt")
    async def stt(request: Request, hints: str = "") -> dict[str, Any]:
        # тело — сама запись (audio/webm, ogg, wav): без multipart, чтобы не тянуть зависимость
        limit = voice.max_audio_bytes
        try:
            declared = int(request.headers.get("content-length") or 0)
        except ValueError:
            declared = 0
        if declared > limit:
            raise HTTPException(413, str(AudioTooLarge(limit)))
        chunks: list[bytes] = []
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > limit:
                raise HTTPException(413, str(AudioTooLarge(limit)))
            chunks.append(chunk)
        audio = b"".join(chunks)
        try:
            return await run_in_threadpool(voice.transcribe, audio, hints.split(","))
        except AudioTooLarge as exc:
            raise HTTPException(413, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except VoiceUnavailable as exc:
            raise HTTPException(503, str(exc)) from exc

    @app.post("/v1/tts")
    def tts(body: Speak) -> Response:
        try:
            wav = voice.synthesize(body.text, voice=body.voice, intonation=body.intonation)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except VoiceUnavailable as exc:
            raise HTTPException(503, str(exc)) from exc
        return Response(wav, media_type="audio/wav")

    @app.get("/v1/contracts")
    def contracts() -> dict[str, Any]:
        return {"version": CONTRACTS_VERSION, "schemas": sorted(SCHEMA_MODELS)}

    @app.get("/v1/contracts/{name}")
    def contract(name: str) -> dict[str, Any]:
        model = SCHEMA_MODELS.get(name)
        if model is None:
            raise HTTPException(404, "unknown contract")
        return model.json_schema() if isinstance(model, TypeAdapter) else model.model_json_schema()

    @app.get("/v1/scenarios")
    def list_scenarios() -> list[dict[str, Any]]:
        return [
            {"scenario_id": sid, "dds_profile": s.dds_profile, "synthetic": True}
            for sid, s in sorted(scenarios.items())
        ]

    @app.post("/v1/attempts", status_code=201)
    def create_attempt(body: CreateAttempt) -> dict[str, Any]:
        scenario = scenarios.get(body.scenario_id)
        if scenario is None:
            raise HTTPException(404, "unknown scenario")
        llm, judge = models.get()
        s = TrainingSession(
            scenario,
            channel=Channel.TEXT,
            clock=WallClock(),  # type: ignore[arg-type]
            llm=llm,
            judge=judge,
            card_seed=body.card_seed,
        )
        with lock:
            attempts[s.attempt_id] = s
        s.notify()
        return {"attempt_id": str(s.attempt_id), "events": events(s)}

    @app.post("/v1/attempts/{attempt_id}/open")
    def open_card(attempt_id: UUID) -> dict[str, Any]:
        s = get(attempt_id)
        visible = s.open_card()
        return {"card": {k: _dump(v) for k, v in visible.items()}, "events": events(s)}

    @app.post("/v1/attempts/{attempt_id}/card")
    def edit_card(attempt_id: UUID, body: EditCard) -> dict[str, Any]:
        s = get(attempt_id)
        s.edit_card(**body.values)
        return {"events": events(s)}

    @app.post("/v1/attempts/{attempt_id}/decision")
    def decide(attempt_id: UUID, body: Decide) -> dict[str, Any]:
        s = get(attempt_id)
        s.decide(body.decision)
        return {"events": events(s)}

    @app.post("/v1/attempts/{attempt_id}/dial")
    def dial(attempt_id: UUID) -> dict[str, Any]:
        s = get(attempt_id)
        try:
            result = s.dial()
        except RuntimeError as exc:
            raise HTTPException(409, str(exc)) from exc
        return {
            "connected": result.outcome is None,
            "outcome": None if result.outcome is None else str(result.outcome),
            "events": events(s),
        }

    @app.post("/v1/attempts/{attempt_id}/say")
    def say(attempt_id: UUID, body: Say) -> dict[str, Any]:
        s = get(attempt_id)
        try:
            turn = s.say(body.text)
        except RuntimeError as exc:
            raise HTTPException(409, str(exc)) from exc
        return {
            "reply": _dump(turn.reply),
            "ack_id": None if turn.ack_id is None else str(turn.ack_id),
            "events": events(s),
        }

    @app.post("/v1/attempts/{attempt_id}/submit")
    def submit(attempt_id: UUID, body: Submit) -> dict[str, Any]:
        s = get(attempt_id)
        try:
            s.submit(incomplete=body.incomplete)
        except Exception as exc:  # IncompleteSubmission: не хватает шагов
            raise HTTPException(409, str(exc)) from exc
        return {"events": events(s)}

    @app.get("/v1/attempts/{attempt_id}/evaluation")
    def evaluation(attempt_id: UUID) -> dict[str, Any]:
        s = get(attempt_id)
        try:
            ev = s.evaluate(rubric)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        return {
            "summary": _dump(ev.summary),
            "results": [_dump(r) for r in ev.results],
            "version_snapshot": _dump(s.version_snapshot(rubric)),
        }

    @app.get("/v1/attempts/{attempt_id}/events")
    def attempt_events(attempt_id: UUID) -> list[Any]:
        return events(get(attempt_id))

    return app
