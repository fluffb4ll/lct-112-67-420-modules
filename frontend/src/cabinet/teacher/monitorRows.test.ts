import { describe, expect, it } from 'vitest';
import type { CardSummary, Evaluation } from '../../api/sessions';
import { monitorRows } from './monitorRows';

const card = (id: string, studentId: string, submittedAt: string, studentName = 'Автор'): CardSummary => ({
  id,
  sessionId: 's1',
  studentId,
  studentName,
  scenarioId: 'sc',
  scenarioTitle: 'Лифт',
  status: 'SUBMITTED',
  startedAt: null,
  submittedAt,
  durationSeconds: 60,
  timeDeltaSeconds: 0,
});
const ev = (p: Partial<Evaluation>) => ({ aiStatus: 'OK', aiScore: null, teacherScore: null, finalScore: null, ...p }) as Evaluation;

describe('monitorRows', () => {
  it('сдано, последняя сдача и средний итоговый балл: преподаватель поверх ИИ', () => {
    const cards = [card('a', 'u1', '2026-10-18T10:00:00Z'), card('b', 'u1', '2026-10-18T10:05:00Z'), card('c', 'u1', '2026-10-18T10:07:00Z')];
    const evals = { a: ev({ aiScore: 68, teacherScore: 70, finalScore: 70 }), b: ev({ aiScore: 90, finalScore: 90 }), c: ev({ aiStatus: 'PENDING' }) };
    const [row] = monitorRows([{ id: 'u1', fullName: 'Иванов' }], cards, evals);
    expect(row).toEqual({ studentId: 'u1', name: 'Иванов', submitted: 3, lastSubmittedAt: '2026-10-18T10:07:00Z', avgScore: 80, awaiting: 1 });
  });

  it('не сдававший — в списке с нулём; автор карточки вне состава — тоже', () => {
    const rows = monitorRows([{ id: 'u1', fullName: 'Иванов' }], [card('a', 'u2', '2026-10-18T10:00:00Z', 'Петров')], {});
    expect(rows.map((r) => [r.name, r.submitted, r.avgScore])).toEqual([
      ['Иванов', 0, null],
      ['Петров', 1, null],
    ]);
  });
});
