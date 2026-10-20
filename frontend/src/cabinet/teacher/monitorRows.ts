import type { CardSummary } from '../../api/sessions';
import type { CardEvaluations } from '../../training/cardEvaluations';
import { serverScoreView } from '../../training/serverScore';

/*
 * Строки мониторинга занятия по данным сервера: состав группы и сданные карточки.
 * Средний балл — по итоговым оценкам сервера (преподаватель поверх ИИ), как у обучающегося.
 */

export interface MonitorRow {
  studentId: string;
  name: string;
  submitted: number;
  lastSubmittedAt: string | null;
  /** null — оценённых карточек ещё нет */
  avgScore: number | null;
  /** сданных карточек без итоговой оценки */
  awaiting: number;
}

export function monitorRows(members: { id: string; fullName: string }[], cards: CardSummary[], evals: CardEvaluations): MonitorRow[] {
  // в составе нет автора карточки (исключён из группы после сдачи) — показываем по карточке
  const people = new Map(members.map((m) => [m.id, m.fullName]));
  for (const c of cards) if (!people.has(c.studentId)) people.set(c.studentId, c.studentName ?? c.studentId);

  return [...people].map(([studentId, name]) => {
    const mine = cards.filter((c) => c.studentId === studentId);
    const scores = mine.flatMap((c) => {
      const view = serverScoreView(evals[c.id]);
      return view.kind === 'score' ? [view.score] : [];
    });
    const last = mine.map((c) => c.submittedAt).filter((t): t is string => !!t).sort().at(-1) ?? null;
    return {
      studentId,
      name,
      submitted: mine.length,
      lastSubmittedAt: last,
      avgScore: scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : null,
      awaiting: mine.length - scores.length,
    };
  });
}
