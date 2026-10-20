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
  it('пустой эталонный путь — балл числом, как в ai', () => {
    const noPath = { ...lift, expected: { ...lift.expected, path: [] } };
    const ev = evaluate(run('Кировоградская 22, застревание в лифте', { status: 'Принята' }), noPath);
    const path = ev.checks.find((c) => c.id === 'path')!;
    expect(path.points).toBe(10); // полный балл минус 5 за статусы вне эталона
    expect(ev.checks.find((c) => c.id === 'primary_status')!.points).toBe(30);
    expect(Number.isNaN(ev.score)).toBe(false);
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

describe('рекомендация', () => {
  it('полный балл — без «Подтяните» и без первого навыка сценария', () => {
    const ev = evaluate(run('Докладываю: Кировоградская, 22 — застревание в лифте'));
    expect(ev.score).toBe(100);
    expect(ev.recommendation.text).toBe('Замечаний нет — переходите к сценариям сложнее.');
  });

  it('почти полный балл при зачёте — совет для закрепления, без упрёка', () => {
    const ev = evaluate(run('Докладываю: Кировоградская, 22 — застревание в лифте', { openMs: 45000 }));
    expect(ev.score).toBe(95);
    expect(ev.recommendation.skill).toBe('timing');
    expect(ev.recommendation.text).toMatch(/^Результат почти полный; для закрепления — навык «/);
    expect(ev.recommendation.text).not.toMatch(/Подтяните/);
  });

  it('незачёт — по-прежнему «Подтяните» по самому слабому навыку', () => {
    const ev = evaluate(run('Кировоградская 22, лифт', { status: 'Принята' }));
    expect(ev.passed).toBe(false);
    expect(ev.recommendation.text).toMatch(/^Подтяните навык «/);
  });

  it('неполный комментарий к верной «Принята» — не «Профильные происшествия»', () => {
    const scenario: Scenario = {
      ...lift,
      skills: ['profile'],
      expected: { ...lift.expected, path: ['Принята'], commentMustMention: [['практик'], ['передан', 'сообщ']] },
    };
    const ev = evaluate(run('Докладываю: Кировоградская, 22 — застревание в лифте', { status: 'Принята', comment: 'Принято' }), scenario);
    expect(ev.checks.find((c) => c.id === 'comment_content')!.skill).toBe('work_progress');
    expect(ev.recommendation.skill).toBe('work_progress');
    expect(ev.recommendation.text).not.toMatch(/Профильные/);
  });

  it('неполный комментарий к ожидаемому отказу — навык «Комментарий к отказу»', () => {
    const scenario: Scenario = { ...lift, skills: ['zone'] };
    const ev = evaluate(run('Докладываю: Кировоградская, 22 — застревание в лифте', { comment: 'Не наш адрес' }), scenario);
    expect(ev.checks.find((c) => c.id === 'comment_content')!.skill).toBe('refusal_comment');
  });
});

describe('статусы хода реагирования — как в ai (bridge/rules.py)', () => {
  const withFinal = (expectedPath: Scenario['expected']['path']) => {
    const events = run('Докладываю: Кировоградская, 22 — застревание в лифте');
    events.splice(3, 0, { t: 30000, kind: 'status_set', status: 'Работы завершены' as TrainingEvent['status'] });
    const scenario: Scenario = { ...lift, expected: { ...lift.expected, path: expectedPath } };
    return evaluate(events, scenario).checks.find((c) => c.id === 'path')!;
  };

  it('итоговый статус вне эталона — лишний, минус 5 (тест-зеркало в ai: test_terminal_status_outside_expected_path_is_extra)', () => {
    const path = withFinal(['Не принята']);
    expect(path.points).toBe(10);
    expect(path.detail).toContain('Лишние статусы: «Работы завершены»');
  });

  it('итоговый статус в эталоне — полный балл', () => {
    const path = withFinal(['Не принята', 'Работы завершены']);
    expect(path.points).toBe(15);
    expect(path.detail).not.toContain('Лишние');
  });
});
