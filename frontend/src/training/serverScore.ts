import type { Evaluation as ServerEvaluation } from '../api/sessions';

/*
 * Какую цифру оценки показать обучающемуся за карточку серверного занятия. Итог ставит сервер
 * (оценка ИИ, поверх — преподаватель); локальный разбор по правилам — предварительный.
 */

export type ServerScoreView =
  | { kind: 'score'; score: number; label: string }
  | { kind: 'pending'; label: string }
  | { kind: 'unavailable'; label: string };

export const PRELIMINARY_LABEL = 'предварительно по правилам';

export function serverScoreView(ev: ServerEvaluation | null | undefined): ServerScoreView {
  if (ev?.teacherScore != null) return { kind: 'score', score: ev.finalScore ?? ev.teacherScore, label: 'оценка преподавателя' };
  if (ev?.aiScore != null && ev.aiStatus !== 'PENDING') return { kind: 'score', score: ev.finalScore ?? ev.aiScore, label: 'оценка ИИ' };
  if (ev?.aiStatus === 'UNAVAILABLE' || (ev?.aiStatus === 'OK' && ev.aiScore == null))
    return { kind: 'unavailable', label: 'ИИ-контур не ответил — итог выставит преподаватель' };
  return { kind: 'pending', label: 'оценка ИИ готовится…' };
}

/** Оценка из ответа GET /api/cards/{id} (OperatorCardDetailsDto.evaluation) */
export function evaluationOfCard(card: Record<string, unknown> | null | undefined): ServerEvaluation | null {
  const ev = card?.evaluation;
  return ev && typeof ev === 'object' ? (ev as ServerEvaluation) : null;
}
