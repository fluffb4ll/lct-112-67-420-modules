"""Оценка сданной карточки по запросу бэкенда (`POST /api/v1/ai/evaluate`).

Вход — `AiEvaluationRequestDto` бэкенда: сданная карточка (с журналом действий фронта в
`submittedCard.trainingLog`), эталон сценария (`referenceCard = {expected, scenario}`), заметки
оператора и метрики времени. Выход — `AiEvaluationResponseDto`.

Порядок: правила регламента (`rules.py`) дают нижнюю границу; затем LLM-судья читает комментарии
и доклад обучающегося рядом с эталоном. Судья может засчитать сведения, высказанные другими
словами (правила ищут корни слов), но не может снять баллы, начисленные правилами. Он же пишет
разбор для обучающегося. Модель недоступна — итог по правилам с пометкой об этом.
"""

from __future__ import annotations

from typing import Any

from ..ports import LLMProvider
from .llm import ask_json
from .rules import SKILL_ADVICE, SKILL_LABELS, Norms, RuleResult, evaluate_rules, extract_facts

JUDGE_SCHEMA = {
    "type": "object",
    "properties": {
        "comment_score": {"type": "integer", "minimum": 0, "maximum": 10},
        "report_score": {"type": "integer", "minimum": 0, "maximum": 10},
        "remarks": {"type": "array", "items": {"type": "string"}, "maxItems": 3},
        "summary": {"type": "string"},
    },
    "required": ["comment_score", "report_score", "remarks", "summary"],
    "additionalProperties": False,
}

JUDGE_TIMEOUT_S = 40.0


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _norms(log: dict[str, Any], metrics: dict[str, Any]) -> Norms:
    n = _as_dict(log.get("norms"))
    return Norms(
        open_sec=float(n.get("openSec") or 30),
        total_sec=float(n.get("totalSec") or 180),
        pass_score=int(n.get("passScore") or 70),
    )


def _judge_prompt(
    scenario: dict[str, Any], expected: dict[str, Any], card: dict[str, Any], rr: RuleResult
) -> str:
    incident = _as_dict(card.get("incident"))
    sample = _as_dict(expected.get("sample"))
    lines = [
        "Ты — инструктор, проверяющий работу диспетчера ДДС (дежурно-диспетчерской службы) "
        "в учебной системе 112. Сравни действия обучающегося с эталоном.",
        "",
        f"Сценарий: {scenario.get('title') or ''}",
        f"Описание происшествия: {(incident.get('description') or '').strip()[:600]}",
        "",
        "ЭТАЛОН",
        "Статусы: " + " → ".join(expected.get("path") or []),
        "Комментарии: " + "; ".join(f"{k}: {v}" for k, v in sample.items()),
        "Обязательные сведения в комментарии: "
        + "; ".join("/".join(g) for g in expected.get("commentMustMention") or []),
        f"Нужен доклад руководителю: {'да' if expected.get('callRequired') else 'нет'}",
        f"Эталонный доклад: {expected.get('sampleReport') or '—'}",
        "",
        "ОБУЧАЮЩИЙСЯ",
        "Статусы: " + (" → ".join(rr.facts.path) or "не проставлены"),
        "Комментарии: " + ("; ".join(rr.facts.comments) or "нет"),
        f"Доклад руководителю: {rr.facts.report or 'не было'}",
        "",
        "Оцени по шкале 0–10:",
        "comment_score — насколько комментарии передают те же сведения, что эталон "
        "(смысл важнее точных слов; 0, если комментариев нет);",
        "report_score — насколько доклад содержит адрес, суть происшествия и принятые меры "
        "(0, если доклада не было);",
        "remarks — до трёх конкретных замечаний по существу, по-русски;",
        "summary — одно-два предложения итогового разбора для обучающегося, по-русски.",
        "Ответь только JSON.",
    ]
    return "\n".join(lines)


def _clamp(value: Any, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(value)))
    except (TypeError, ValueError):
        return lo


def _apply_judge(rr: RuleResult, verdict: dict[str, Any], *, call_required: bool) -> None:
    comment = rr.check("comment_content")
    if rr.facts.comments and comment.points < comment.max:
        llm_points = round(_clamp(verdict.get("comment_score"), 0, 10) / 10 * comment.max)
        if llm_points > comment.points:
            comment.points = llm_points
            comment.by = "llm"
            comment.detail += " ИИ засчитал сведения, переданные другими словами."
    report = rr.check("report_call")
    if call_required and rr.facts.called_chief and report.points < report.max:
        llm_points = 4 + round(_clamp(verdict.get("report_score"), 0, 10) / 10 * 6)
        if llm_points > report.points:
            report.points = llm_points
            report.by = "llm"
            report.detail += " ИИ засчитал сведения, названные другими словами."


def evaluate_card(request: dict[str, Any], llm: LLMProvider | None) -> dict[str, Any]:
    card = _as_dict(request.get("submittedCard"))
    reference = _as_dict(request.get("referenceCard"))
    expected = _as_dict(reference.get("expected"))
    scenario = _as_dict(reference.get("scenario"))
    metrics = _as_dict(request.get("metrics"))
    log = _as_dict(card.get("trainingLog"))
    events = [e for e in log.get("events") or [] if isinstance(e, dict)]
    notes = (request.get("operatorNotes") or "").strip()

    facts = extract_facts(
        events,
        list(log.get("chiefContactIds") or []),
        fallback_report=notes or _as_dict(card.get("dispatch")).get("dispatchNotes") or "",
        total_sec_hint=metrics.get("durationSeconds"),
    )
    no_log = not events
    if no_log:
        # старый клиент без журнала: восстанавливаем, что можем, из самой карточки
        decision = _as_dict(card.get("decision"))
        action = decision.get("action")
        if action and action != "не задан":
            facts.path = [action]
            reason = (decision.get("reason") or "").strip()
            facts.comments = [reason] if reason else []
            facts.status_events = [{"status": action, "comment": reason}]
        facts.open_sec = 0.0

    norms = _norms(log, metrics)
    rr = evaluate_rules(scenario, expected, facts, norms)

    verdict = ask_json(
        llm,
        _judge_prompt(scenario, expected, card, rr),
        schema=JUDGE_SCHEMA,
        max_tokens=320,
        timeout_s=JUDGE_TIMEOUT_S,
    )
    if verdict is not None:
        _apply_judge(rr, verdict, call_required=bool(expected.get("callRequired")))

    score = rr.score
    primary_ok = rr.check("primary_status").points > 0
    passed = score >= norms.pass_score and primary_ok
    failed = [c for c in rr.checks if not c.ok]
    worst = max(rr.checks, key=lambda c: c.max - c.points)
    weak = worst.skill if worst.points < worst.max else (rr.skills[0] if rr.skills else "timing")

    text: list[str] = [
        f"Итог: {score} из 100 — {'зачёт' if passed else 'незачёт'}.",
    ]
    if verdict is not None:
        summary = str(verdict.get("summary") or "").strip()
        if summary:
            text.append(f"Разбор ИИ: {summary}")
        for remark in verdict.get("remarks") or []:
            if str(remark).strip():
                text.append(f"— {str(remark).strip()}")
    elif llm is None:
        text.append("Языковая модель не подключена — оценка по правилам регламента.")
    else:
        text.append("Языковая модель не ответила вовремя — оценка по правилам регламента.")
    if failed:
        text.append("Замечания по регламенту:")
        text.extend(f"— {c.title} ({c.points}/{c.max}): {c.detail}" for c in failed)
    text.append(
        f"Рекомендация: подтяните навык «{SKILL_LABELS.get(weak, weak)}». "
        f"{SKILL_ADVICE.get(weak, '')}"
    )
    if no_log:
        text.append("Журнал действий не передан клиентом — время открытия не проверялось.")

    literacy = rr.check("literacy")
    model = None if llm is None else llm.model_ref.model_dump(mode="json")
    return {
        "aiScore": score,
        "finalScore": score,
        "aiGrammarScore": {
            "score": literacy.points,
            "max": literacy.max,
            "status": "passed" if literacy.ok else "failed",
            "explanation": literacy.detail,
        },
        "aiComplianceErrors": {c.title: f"{c.detail} ({c.points}/{c.max})" for c in failed},
        "aiRecommendations": "\n".join(text),
        # для отладки и будущих клиентов; бэкенд эти поля не читает
        "passed": passed,
        "checks": [c.to_dict() for c in rr.checks],
        "evaluatedBy": "rules+llm" if verdict is not None else "rules",
        "model": model,
    }
