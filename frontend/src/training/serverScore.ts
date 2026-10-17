import type { Evaluation as ServerEvaluation } from '../api/sessions';
import { DEFAULT_NORMS } from '../domain/evaluate';
import type { Attempt } from '../domain/types';

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

/** Подпись о судьбе карточки на сервере (под разбором) */
export function serverStatusLine(sendFailed: string | undefined, server: ServerScoreView | null): string {
  if (sendFailed) return `${sendFailed} — итоговой оценки по ней не будет.`;
  if (server?.kind === 'score') return 'Итоговая оценка — на сервере, она может отличаться от разбора.';
  if (server) return server.label[0].toUpperCase() + server.label.slice(1);
  return 'Карточка отправляется на сервер…';
}

/**
 * Цифра в плашке разбора. Пришла оценка сервера — показываем её, и цвет «зачёт/незачёт» тоже по ней
 * (порог занятия), иначе локальный разбор; для серверного занятия он помечен как предварительный.
 */
export function scoreBadge(
  local: { score: number; passed: boolean },
  server: ServerScoreView | null,
  fromServer: boolean,
  passScore: number,
): { score: number; passed: boolean; label: string } {
  if (server?.kind === 'score') return { score: server.score, passed: server.score >= passScore, label: server.label };
  return { score: local.score, passed: local.passed, label: fromServer ? PRELIMINARY_LABEL : local.passed ? 'зачёт' : 'незачёт' };
}

/**
 * Вердикт «Зачёт/Незачёт» в подробностях попытки — как плашка в ResultModal: при готовой серверной
 * оценке по ней и порогу занятия, иначе локальный разбор. null — попытка не оценена.
 */
export function attemptVerdict(attempt: Pick<Attempt, 'evaluation' | 'passScore' | 'serverCardId'>, server: ServerScoreView | null): boolean | null {
  const ev = attempt.evaluation;
  if (!ev) return null;
  return scoreBadge(ev, server, !!attempt.serverCardId, attempt.passScore ?? DEFAULT_NORMS.passScore).passed;
}
