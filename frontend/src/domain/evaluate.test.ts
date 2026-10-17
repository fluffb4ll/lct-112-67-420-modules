import { describe, expect, it } from 'vitest';
import { SEED_SCENARIOS } from '../data/scenarios';
import { DEFAULT_NORMS, evaluateDds, pyRound } from './evaluate';
import type { Scenario, TrainingEvent } from './types';

const lift = SEED_SCENARIOS.find((s) => s.id === 'sc-lift-praktika')!;
const CHIEFS = ['chief'];
const COMMENT = 'Не обслуживаем: лифты обслуживает ООО «Практика». Информация передана в диспетчерскую «Практика».';

function run(report: string | null, over: Partial<{ openMs: number; status: string; comment: string; endMs: number }> = {}): TrainingEvent[] {
  const ev: TrainingEvent[] = [
    { t: 0, kind: 'arrived' },
    { t: over.openMs ?? 5000, kind: 'opened' },
    { t: 20000, kind: 'status_set', status: (over.status ?? 'Не принята') as TrainingEvent['status'], comment: over.comment ?? COMMENT },
  ];
  if (report !== null) ev.push({ t: 40000, kind: 'call_ended', contactId: 'chief', transcript: report });
  ev.push({ t: over.endMs ?? 60000, kind: 'finished' });
  return ev;
}

const evaluate = (events: TrainingEvent[], scenario: Scenario = lift, chiefs = CHIEFS) =>
  evaluateDds(events, scenario, DEFAULT_NORMS, 0, () => undefined, chiefs);
const check = (events: TrainingEvent[], id: string) => evaluate(events).checks.find((c) => c.id === id)!;

describe('evaluateDds', () => {
  it('эталонная отработка — полный балл и зачёт', () => {
    const ev = evaluate(run('Докладываю: Кировоградская, 22 — застревание в лифте'));
    expect(ev.score).toBe(100);
    expect(ev.passed).toBe(true);
  });

  it('неверный первичный статус — незачёт при любом балле', () => {
    const ev = evaluate(run('Кировоградская 22, лифт', { status: 'Принята' }));
    expect(ev.checks.find((c) => c.id === 'primary_status')!.points).toBe(0);
    expect(ev.passed).toBe(false);
  });

  it('открытие позже норматива снижает балл', () => {
    expect(check(run('Кировоградская 22 лифт', { openMs: 45000 }), 'open_time').points).toBe(5);
    expect(check(run('Кировоградская 22 лифт', { openMs: 70000 }), 'open_time').points).toBe(0);
  });

  it('без доклада руководителю — 0 за доклад', () => {
    expect(check(run(null), 'report_call').points).toBe(0);
  });

  it('звонок не руководителю докладом не считается', () => {
    const ev = evaluate(run('Кировоградская 22 лифт'), lift, ['deputy']);
    expect(ev.checks.find((c) => c.id === 'report_call')!.points).toBe(0);
  });

  it('доклад из STT с искажённым корнем засчитывается, как на сервере', () => {
    const scenario: Scenario = { ...lift, expected: { ...lift.expected, reportMustMention: [['кировоградск', '22'], ['застре']] } };
    const events = run('Докладываю, Кировоградская 22, состревание в листе');
    const report = evaluate(events, scenario).checks.find((c) => c.id === 'report_call')!;
    expect(report.points).toBe(10);
    expect(report.detail).toBe('Доклад содержит всё необходимое');
  });

  it('форма слова «застрял» засчитывается за корень «застре»', () => {
    const scenario: Scenario = { ...lift, expected: { ...lift.expected, reportMustMention: [['застре']] } };
    expect(evaluate(run('Застрял ребёнок'), scenario).checks.find((c) => c.id === 'report_call')!.points).toBe(10);
  });

  it('комментарий с тем же искажением сверяется строго', () => {
    const c = check(run('Кировоградская 22 лифт', { comment: 'Не обслуживаем, сообщено в Прахтику.' }), 'comment_content');
    expect(c.ok).toBe(false);
  });
});

describe('pyRound', () => {
  it('половина — к чётному, как round() в Python', () => {
    expect([0.5, 1.5, 2.5, 4.5, -2.5, -3.5].map(pyRound)).toEqual([0, 2, 2, 4, -2, -4]);
    expect([2.4, 2.6, 7].map(pyRound)).toEqual([2, 3, 7]);
  });

  it('доклад: 3 из 4 групп — 8 баллов, как на сервере (4 + round(4.5))', () => {
    const scenario: Scenario = {
      ...lift,
      expected: { ...lift.expected, reportMustMention: [['кировоградск'], ['22'], ['лифт'], ['практик']] },
    };
    expect(evaluate(run('Кировоградская 22, лифт'), scenario).checks.find((c) => c.id === 'report_call')!.points).toBe(8);
  });
});
