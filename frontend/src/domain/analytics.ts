import { computeRatings, readiness, SKILL_LABELS, SKILLS, type Level } from './skills';
import type { Attempt, Scenario, Skill, User } from './types';

/*
 * Расчёты для отчётов преподавателя и прогресса обучающегося.
 * Все цифры считаются из сохранённых попыток — отчёты воспроизводимы.
 */

export const finalScore = (a: Attempt) => a.review?.score ?? a.evaluation?.score ?? 0;

export const done = (attempts: Attempt[]) => attempts.filter((a) => a.evaluation);

export interface StudentRow {
  user: User;
  attempts: number;
  avgScore: number;
  passRate: number;
  errors: number;
  avgOpenSec: number;
  level: Level;
  readiness: number;
  weakest: Skill;
}

export function studentRows(users: User[], attempts: Attempt[], scenarios: Map<string, Scenario>): StudentRow[] {
  return users.map((user) => {
    const mine = done(attempts.filter((a) => a.studentId === user.id));
    const ratings = computeRatings(mine, scenarios);
    const r = readiness(ratings);
    const n = mine.length;
    const avg = (f: (a: Attempt) => number) => (n ? mine.reduce((s, a) => s + f(a), 0) / n : 0);
    return {
      user,
      attempts: n,
      avgScore: Math.round(avg(finalScore)),
      passRate: Math.round(avg((a) => (a.evaluation!.passed ? 100 : 0))),
      errors: mine.reduce((s, a) => s + a.evaluation!.checks.filter((c) => c.points < c.max).length, 0),
      avgOpenSec: Math.round(avg((a) => a.evaluation!.openSec ?? 60)),
      level: r.level,
      readiness: r.index,
      weakest: SKILLS.reduce((w, s) => (ratings[s] < ratings[w] ? s : w), SKILLS[0]),
    };
  });
}

export const CHECK_TITLES: Record<string, string> = {
  open_time: 'Открытие > 30 с',
  primary_status: 'Неверный статус',
  comment_required: 'Отказ без комментария',
  comment_content: 'Неполный комментарий',
  path: 'Ход работ',
  report_call: 'Доклад',
  total_time: 'Отработка > 3 мин',
  literacy: 'Грамотность',
};

/** Тепловая карта ошибок: доля попыток с ошибкой данного типа в данной категории происшествий */
export function errorMatrix(attempts: Attempt[], scenarios: Map<string, Scenario>) {
  const cats = new Map<string, Attempt[]>();
  for (const a of done(attempts)) {
    const cat = scenarios.get(a.scenarioId)?.category ?? 'Прочее';
    cats.set(cat, [...(cats.get(cat) ?? []), a]);
  }
  const rows = [...cats.keys()].sort((a, b) => (cats.get(b)!.length - cats.get(a)!.length) || a.localeCompare(b, 'ru'));
  const cols = Object.keys(CHECK_TITLES);
  const cell = (row: string, col: string) => {
    const list = cats.get(row) ?? [];
    const relevant = list.filter((a) => a.evaluation!.checks.some((c) => c.id === col));
    if (!relevant.length) return null;
    const bad = relevant.filter((a) => {
      const c = a.evaluation!.checks.find((x) => x.id === col)!;
      return c.points < c.max;
    });
    return { rate: (bad.length / relevant.length) * 100, bad: bad.length, n: relevant.length };
  };
  return { rows, cols, cell };
}

/** Средний балл по дням для каждой группы */
export function dailyScores(attempts: Attempt[], groups: { id: string; name: string; members: Set<string> }[], days = 14) {
  const labels: string[] = [];
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    keys.push(d.toISOString().slice(0, 10));
    labels.push(`${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const series = groups.map((g) => ({
    name: g.name,
    values: keys.map((k) => {
      const list = done(attempts).filter((a) => g.members.has(a.studentId) && toLocalDay(a.startedAt) === k);
      return list.length ? list.reduce((s, a) => s + finalScore(a), 0) / list.length : null;
    }),
  }));
  return { labels, series };
}

const toLocalDay = (iso: string) => {
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
};

/** Достоверность прогноза: калибровка по корзинам, точность классификации «зачёт/незачёт», оценка Брайера */
export function calibration(attempts: Attempt[]) {
  const list = done(attempts);
  const edges = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
  const bins = edges.slice(0, -1).map((from, i) => {
    const to = edges[i + 1];
    const inBin = list.filter((a) => a.evaluation!.predicted >= from && a.evaluation!.predicted < to);
    const n = inBin.length;
    return {
      from,
      to: Math.min(1, to),
      n,
      predicted: n ? inBin.reduce((s, a) => s + a.evaluation!.predicted, 0) / n : (from + to) / 2,
      actual: n ? inBin.filter((a) => a.evaluation!.passed).length / n : 0,
    };
  });
  const n = list.length;
  const accuracy = n ? list.filter((a) => a.evaluation!.predicted >= 0.5 === a.evaluation!.passed).length / n : 0;
  const brier = n ? list.reduce((s, a) => s + (a.evaluation!.predicted - (a.evaluation!.passed ? 1 : 0)) ** 2, 0) / n : 0;
  const baseRate = n ? list.filter((a) => a.evaluation!.passed).length / n : 0;
  // «наивный» прогноз — всем одну и ту же долю зачётов; модель должна быть лучше
  const brierBaseline = n ? list.reduce((s, a) => s + (baseRate - (a.evaluation!.passed ? 1 : 0)) ** 2, 0) / n : 0;
  return { bins, accuracy, brier, brierBaseline, n };
}

/** «Инсайты ИИ» по типичным ошибкам группы (мок: агрегаты + шаблоны; на сервере — LLM по тем же агрегатам) */
export function groupInsights(attempts: Attempt[], scenarios: Map<string, Scenario>): string[] {
  const list = done(attempts);
  if (!list.length) return ['Недостаточно данных: в группе ещё нет завершённых попыток.'];
  const bySkill = new Map<Skill, { lost: number; max: number }>();
  for (const a of list)
    for (const c of a.evaluation!.checks) {
      const cur = bySkill.get(c.skill) ?? { lost: 0, max: 0 };
      cur.lost += c.max - c.points;
      cur.max += c.max;
      bySkill.set(c.skill, cur);
    }
  const ranked = [...bySkill.entries()].filter(([, v]) => v.max > 0).sort((a, b) => b[1].lost / b[1].max - a[1].lost / a[1].max);
  const out: string[] = [];
  const [top, second] = ranked;
  if (top) out.push(`Больше всего баллов группа теряет по навыку «${SKILL_LABELS[top[0]]}» — ${Math.round((top[1].lost / top[1].max) * 100)}% возможных баллов.`);
  if (second) out.push(`На втором месте — «${SKILL_LABELS[second[0]]}» (${Math.round((second[1].lost / second[1].max) * 100)}%).`);
  const { rows, cell } = errorMatrix(list, scenarios);
  let worst: { row: string; rate: number; n: number } | null = null;
  for (const r of rows) {
    const c = cell(r, 'primary_status');
    if (c && c.n >= 3 && (!worst || c.rate > worst.rate)) worst = { row: r, rate: c.rate, n: c.n };
  }
  if (worst && worst.rate > 0) out.push(`Чаще всего неверный первичный статус — в категории «${worst.row}» (${Math.round(worst.rate)}% из ${worst.n} попыток). Рекомендуется разобрать эти карточки в режиме «делай как я».`);
  const slow = list.filter((a) => (a.evaluation!.openSec ?? 99) > 30).length / list.length;
  if (slow > 0.2) out.push(`${Math.round(slow * 100)}% карточек открываются позже норматива 30 секунд — стоит добавить в занятие несколько карточек подряд.`);
  return out;
}
