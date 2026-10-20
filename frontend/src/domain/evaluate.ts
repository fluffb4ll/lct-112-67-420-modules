import { COMMENT_REQUIRED, PRIMARY, TERMINAL } from './statusMachine';
import { SKILL_ADVICE, SKILL_LABELS } from './skills';
import { cpm, literacyIssues, matchGroups } from './text';
import type { Evaluation, EvaluationCheck, ResponseStatus, Scenario, Skill, TrainingEvent } from './types';

/*
 * Первичная (автоматическая) оценка отработки карточки на станции ДДС.
 * Правила выведены из регламента (Памятка АРМ-112 для ДДС) и ответов заказчика:
 *   30 с — открыть карточку, 3 мин — отработать; корректный первичный статус;
 *   обязательный комментарий к отказу; полнота комментария; статусы хода работ; доклад руководителю.
 * Это детерминированная часть. На сервере к ней добавляется LLM-сравнение текста с эталоном.
 */

export interface Norms {
  openSec: number;
  totalSec: number;
  passScore: number;
}

export const DEFAULT_NORMS: Norms = { openSec: 30, totalSec: 180, passScore: 70 };
/** От этого балла при зачёте рекомендация без упрёка — только для закрепления (как NEAR_FULL_SCORE в ai) */
const NEAR_FULL_SCORE = 90;

function lcs(a: string[], b: string[]): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length];
}

/**
 * round() как в Python (половина — к чётному): ИИ-контур считает баллы так же (bridge/rules.py),
 * и при Math.round 4 + 4,5 давало бы 9 вместо 8.
 */
export function pyRound(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export function evaluateDds(
  events: TrainingEvent[],
  scenario: Scenario,
  norms: Norms,
  predicted: number,
  pickNext: (skill: Skill) => string | undefined,
  chiefContactIds: string[],
  /** Время, пока карточка стояла на паузе (распознавание речи): в норматив не идёт */
  pausedMs = 0,
): Evaluation {
  const exp = scenario.expected;
  const opened = events.find((e) => e.kind === 'opened');
  const sets = events.filter((e) => e.kind === 'status_set' && e.status);
  const path = sets.map((e) => e.status!) as ResponseStatus[];
  const firstPrimary = sets.find((e) => PRIMARY.includes(e.status!));
  const finished = events.find((e) => e.kind === 'finished');
  const lastT = finished?.t ?? events[events.length - 1]?.t ?? 0;
  const openSec = opened ? opened.t / 1000 : null;
  const primarySec = firstPrimary ? firstPrimary.t / 1000 : null;
  const totalSec = Math.max(0, lastT - pausedMs) / 1000;
  const comments = sets.map((e) => e.comment ?? '').filter(Boolean);
  const allComments = comments.join(' ');

  const checks: EvaluationCheck[] = [];

  // 1. Открытие карточки — 30 секунд (Q&A заказчика, п. 13)
  {
    const max = 10;
    let points = 0;
    let detail = 'Карточка не была открыта';
    if (openSec !== null) {
      points = openSec <= norms.openSec ? max : openSec <= norms.openSec * 2 ? 5 : 0;
      detail = `Открыта через ${pyRound(openSec)} с при нормативе ${norms.openSec} с`;
    }
    checks.push({ id: 'open_time', title: 'Своевременное открытие карточки', ok: points === max, points, max, detail, ref: 'Памятка, стр. 5, 21', skill: 'timing' });
  }

  // 2. Первичный статус
  {
    const max = 30;
    // пустой эталонный путь — как в ai (bridge/rules.py): ждём «Принята»
    const want: ResponseStatus = exp.path[0] ?? 'Принята';
    const skill: Skill = scenario.skills.includes('duplicate') ? 'duplicate' : want === 'Не принята' ? 'zone' : 'profile';
    let points = 0;
    let detail: string;
    if (!firstPrimary) detail = `Первичный статус не проставлен. Ожидался «${want}»`;
    else if (firstPrimary.status === want) {
      points = max;
      detail = `Проставлен «${want}» — верно`;
    } else if (path.includes(want)) {
      points = 10;
      detail = `Сначала проставлен «${firstPrimary.status}», затем исправлено на «${want}»`;
    } else detail = `Проставлен «${firstPrimary.status}», а следовало «${want}»`;
    checks.push({ id: 'primary_status', title: 'Правильный первичный статус', ok: points === max, points, max, detail, ref: 'Памятка, стр. 26, 28–29', skill });
  }

  // 3. Обязательный комментарий к отказу
  {
    const max = 10;
    const needing = sets.filter((e) => COMMENT_REQUIRED.includes(e.status!));
    const empty = needing.filter((e) => !(e.comment ?? '').trim());
    const points = needing.length === 0 ? max : empty.length === 0 ? max : 0;
    const detail =
      needing.length === 0
        ? 'Статусы, требующие комментария, не проставлялись'
        : empty.length
          ? `Без комментария: ${empty.map((e) => `«${e.status}»`).join(', ')}`
          : 'Комментарии к отказу внесены';
    checks.push({ id: 'comment_required', title: 'Комментарий к «Не принята» / «Отказ»', ok: points === max, points, max, detail, ref: 'Памятка, стр. 21–22, 30', skill: 'refusal_comment' });
  }

  // 4. Содержание комментариев (сравнение с эталоном по ключевым элементам)
  {
    const max = 15;
    const { hit, missing } = matchGroups(allComments, exp.commentMustMention);
    const total = exp.commentMustMention.length;
    const points = total === 0 ? max : pyRound((hit / total) * max);
    // неполный комментарий — не «Профильные происшествия»: при верном «Принята» это ход работ (как в ai)
    const want: ResponseStatus = exp.path[0] ?? 'Принята';
    const skill: Skill = scenario.skills.includes('refusal_comment')
      ? 'refusal_comment'
      : scenario.skills.includes('work_progress')
        ? 'work_progress'
        : COMMENT_REQUIRED.includes(want)
          ? 'refusal_comment'
          : 'work_progress';
    // в группе перечислены равноправные варианты, достаточно любого — показываем все:
    // «36814851…» в одиночку читается как непонятные цифры, а не как номер карточки
    const need = (g: string[]) => (g.length === 1 ? `«${g[0]}»` : `одного из: ${g.map((s) => `«${s}»`).join(', ')}`);
    const detail =
      total === 0
        ? 'Особых требований к тексту нет'
        : missing.length === 0
          ? 'Все ключевые сведения указаны'
          : `В комментарии не хватает ${missing.map(need).join('; ')}. Эталон: «${Object.values(exp.sample)[0] ?? ''}»`;
    checks.push({ id: 'comment_content', title: 'Полнота комментария', ok: points === max, points, max, detail, ref: 'Памятка, стр. 26, 30', skill });
  }

  // 5. Последовательность статусов (жизненный цикл карточки)
  {
    const max = 15;
    const common = lcs(path, exp.path);
    // карточку нельзя закрыть без завершающего статуса, поэтому он не считается лишним,
    // даже если короткий эталон до него не доходит
    const extra = path.filter((s) => !exp.path.includes(s) && !TERMINAL.includes(s));
    // пустой эталон давал NaN во всём балле; в ai за пустой эталон — полный балл
    let points = exp.path.length ? pyRound((common / exp.path.length) * max) : max;
    if (extra.length) points = Math.max(0, points - 5);
    const detail =
      `Проставлено: ${path.length ? path.map((s) => `«${s}»`).join(' → ') : '—'}. Эталон: ${exp.path.map((s) => `«${s}»`).join(' → ')}` +
      (extra.length ? `. Лишние статусы: ${extra.map((s) => `«${s}»`).join(', ')}` : '');
    checks.push({ id: 'path', title: 'Статусы хода реагирования', ok: points === max, points, max, detail, ref: 'Памятка, стр. 21–25, 31', skill: 'work_progress' });
  }

  // 6. Доклад руководителю по телефону
  {
    const max = 10;
    const calls = events.filter((e) => e.kind === 'call_ended' && e.contactId && chiefContactIds.includes(e.contactId));
    const transcript = calls.map((c) => c.transcript ?? '').join(' ');
    let points: number;
    let detail: string;
    if (!exp.callRequired) {
      points = max;
      detail = calls.length ? 'Доклад выполнен (по сценарию не обязателен)' : 'Доклад по сценарию не требовался';
    } else if (!calls.length) {
      points = 0;
      detail = 'Не было доклада руководителю смены';
    } else {
      // доклад звучит по телефону и приходит из распознавания речи — корни нечётко, как на сервере
      const { hit, missing } = matchGroups(transcript, exp.reportMustMention, { fuzzy: true });
      const total = exp.reportMustMention.length || 1;
      points = 4 + pyRound((hit / total) * 6);
      detail = missing.length ? `В докладе не прозвучало: ${missing.map((g) => `«${g[0]}…»`).join(', ')}` : 'Доклад содержит всё необходимое';
    }
    checks.push({ id: 'report_call', title: 'Доклад руководителю', ok: points === max, points, max, detail, ref: 'Q&A заказчика, п. 6', skill: 'report' });
  }

  // 7. Общее время отработки — 3 минуты
  {
    const max = 5;
    const points = totalSec <= norms.totalSec ? max : totalSec <= norms.totalSec * 1.5 ? 2 : 0;
    checks.push({
      id: 'total_time',
      title: 'Время отработки',
      ok: points === max,
      points,
      max,
      detail: `${pyRound(totalSec)} с при нормативе ${norms.totalSec} с`,
      ref: 'Q&A заказчика, п. 13',
      skill: 'timing',
    });
  }

  // 8. Грамотность
  {
    const max = 5;
    // одинаковые замечания по разным комментариям не повторяем
    const issues = [...new Map(comments.flatMap((c) => literacyIssues(c)).map((i) => [i.message, i])).values()];
    const points = !comments.length ? max : issues.length === 0 ? max : issues.length === 1 ? 3 : 1;
    const detail = !comments.length ? 'Комментариев нет' : issues.length ? issues.map((i) => i.message).join('; ') : 'Замечаний нет';
    checks.push({ id: 'literacy', title: 'Грамотность комментариев', ok: points === max, points, max, detail, skill: 'literacy' });
  }

  const score = checks.reduce((s, c) => s + c.points, 0);
  const passed = score >= norms.passScore && checks.find((c) => c.id === 'primary_status')!.points > 0;

  // Главная ошибка — проверка с наибольшей потерей баллов
  const worst = [...checks].sort((a, b) => b.max - b.points - (a.max - a.points))[0];
  // при полном балле слабого навыка нет — не советуем «подтянуть» первый навык сценария (как в ai)
  const hasWeak = !!worst && worst.points < worst.max;
  const weak: Skill = hasWeak ? worst.skill : scenario.skills[0] ?? 'timing';

  const summary =
    score >= 90
      ? 'Карточка отработана в соответствии с регламентом.'
      : worst && worst.points < worst.max
        ? `Основное замечание — «${worst.title.toLowerCase()}»: ${worst.detail}.`
        : 'Есть замечания, см. разбор.';

  return {
    score,
    passed,
    openSec,
    primarySec,
    totalSec,
    cpm: (() => {
      const chars = sets.reduce((s, e) => s + (e.typedChars ?? 0), 0);
      const ms = sets.reduce((s, e) => s + (e.typingMs ?? 0), 0);
      return cpm(chars, ms);
    })(),
    checks,
    summary,
    recommendation: {
      skill: weak,
      text: !hasWeak
        ? 'Замечаний нет — переходите к сценариям сложнее.'
        : passed && score >= NEAR_FULL_SCORE
          ? `Результат почти полный; для закрепления — навык «${SKILL_LABELS[weak]}». ${SKILL_ADVICE[weak]}`
          : `Подтяните навык «${SKILL_LABELS[weak]}». ${SKILL_ADVICE[weak]}`,
      nextScenarioId: pickNext(weak),
    },
    predicted,
    evaluatedBy: 'rules',
  };
}
