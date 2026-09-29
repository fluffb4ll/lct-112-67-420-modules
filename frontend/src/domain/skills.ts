import type { Attempt, Scenario, Skill } from './types';

export const SKILLS: Skill[] = ['timing', 'zone', 'profile', 'duplicate', 'refusal_comment', 'work_progress', 'report', 'literacy'];

export const SKILL_LABELS: Record<Skill, string> = {
  timing: 'Нормативы времени',
  zone: 'Зона ответственности',
  profile: 'Профильные происшествия',
  duplicate: 'Дубли карточек',
  refusal_comment: 'Комментарий к отказу',
  work_progress: 'Статусы хода работ',
  report: 'Доклад руководителю',
  literacy: 'Грамотность текста',
};

export const SKILL_ADVICE: Record<Skill, string> = {
  timing: 'Открывайте карточку сразу при поступлении: норматив — 30 секунд, на всю отработку — 3 минуты.',
  zone: 'Проверяйте, обслуживает ли служба объект. Если нет — «Не принята» с указанием, куда передана информация (Памятка, стр. 28–30).',
  profile: 'Не отказывайтесь от профильных происшествий только потому, что реагирует другая служба (Памятка, стр. 26, 29).',
  duplicate: 'Сверяйте адрес и тип с недавними карточками в журнале. Дубль — «Не принята: дубль / реагирование по КП №…» (Памятка, стр. 30).',
  refusal_comment: 'К «Не принята» и «Отказ от выполнения работ» комментарий обязателен: причина и куда передана информация (Памятка, стр. 30).',
  work_progress: 'Отражайте ход работ статусами «Начало реагирования», «Прибытие», «Проведение работ» с комментариями (Памятка, стр. 31).',
  report: 'В докладе руководителю называйте номер карточки, адрес, что случилось и что предпринято.',
  literacy: 'Пишите комментарий с заглавной буквы, без сокращений и опечаток — его читают другие службы.',
};

/** Рейтинги по навыкам + общий рейтинг (по зачёту/незачёту всех попыток — данных по нему больше всего) */
export type SkillRatings = Record<Skill, number> & { general: number };

const BASE = 1000;
const K = 40;
// Стартовые оценки сложности подобраны так, чтобы новичок имел ~75% / 60% / 40% шансов на сложностях 1 / 2 / 3
export const DIFFICULTY_RATING: Record<1 | 2 | 3, number> = { 1: 810, 2: 930, 3: 1070 };

const expectedScore = (rating: number, difficulty: 1 | 2 | 3) =>
  1 / (1 + Math.pow(10, (DIFFICULTY_RATING[difficulty] - rating) / 400));

/*
 * Модель подготовленности: рейтинг Эло по каждому навыку.
 * Сценарий имеет сложность и набор навыков; результат по навыку берётся из проверок оценки,
 * помеченных этим навыком. Прогноз успеха = средняя ожидаемая вероятность по навыкам сценария.
 * Модель интерпретируема и проверяема: прогноз сохраняется до попытки и сравнивается с фактом.
 */
export function computeRatings(attempts: Attempt[], scenarios: Map<string, Scenario>): SkillRatings {
  const r = { ...(Object.fromEntries(SKILLS.map((s) => [s, BASE])) as Record<Skill, number>), general: BASE };
  const done = attempts.filter((a) => a.evaluation).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  for (const a of done) {
    const sc = scenarios.get(a.scenarioId);
    if (!sc) continue;
    const ev = a.evaluation!;
    r.general += K * ((ev.passed ? 1 : 0) - expectedScore(r.general, sc.difficulty));
    const touched = new Set<Skill>([...sc.skills, 'timing', 'literacy']);
    for (const skill of touched) {
      const checks = ev.checks.filter((c) => c.skill === skill);
      const result = checks.length
        ? checks.reduce((s, c) => s + c.points, 0) / Math.max(1, checks.reduce((s, c) => s + c.max, 0))
        : ev.passed
          ? 1
          : 0;
      r[skill] += K * (result - expectedScore(r[skill], sc.difficulty));
    }
  }
  return r;
}

export function predictSuccess(ratings: SkillRatings, scenario: Pick<Scenario, 'skills' | 'difficulty'>): number {
  const skills = scenario.skills.length ? scenario.skills : (['timing'] as Skill[]);
  const bySkills = skills.reduce((s, sk) => s + expectedScore(ratings[sk], scenario.difficulty), 0) / skills.length;
  const general = expectedScore(ratings.general, scenario.difficulty);
  return Math.round(((bySkills + general) / 2) * 100) / 100;
}

export function weakestSkill(ratings: SkillRatings, among: Skill[] = SKILLS): Skill {
  return among.reduce((w, s) => (ratings[s] < ratings[w] ? s : w), among[0]);
}

export type Level = 'Начальный' | 'Базовый' | 'Уверенный' | 'Профессиональный';

export function readiness(ratings: SkillRatings): { level: Level; index: number } {
  const bySkills = SKILLS.reduce((s, k) => s + ratings[k], 0) / SKILLS.length;
  // навыки, которые ещё не встречались, стоят на стартовом значении — поэтому учитываем и общий рейтинг
  const avg = (bySkills + ratings.general) / 2;
  // 0..100: 880 → 0, 1200 → 100
  const index = Math.max(0, Math.min(100, Math.round(((avg - 880) / 320) * 100)));
  const level: Level = index < 30 ? 'Начальный' : index < 55 ? 'Базовый' : index < 80 ? 'Уверенный' : 'Профессиональный';
  return { level, index };
}

/** Какую сложность предлагать дальше: где прогноз успеха ближе к 0.6–0.7 («зона ближайшего развития») */
export function recommendDifficulty(ratings: SkillRatings, skill: Skill): 1 | 2 | 3 {
  const target = 0.65;
  let best: 1 | 2 | 3 = 1;
  for (const d of [1, 2, 3] as const) {
    if (Math.abs(expectedScore(ratings[skill], d) - target) < Math.abs(expectedScore(ratings[skill], best) - target)) best = d;
  }
  return best;
}
