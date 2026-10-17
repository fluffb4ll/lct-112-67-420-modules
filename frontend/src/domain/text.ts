/*
 * Проверки ручного ввода текста. Работают локально и мгновенно, поэтому ими пользуется и фронт
 * (подсказки по ходу), и мок-оценка. На сервере поверх этого — LanguageTool и сравнение с эталоном через LLM.
 */

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'“”„()[\].,;:!?–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Звуки, которые распознавание речи путает: звонкие и глухие, безударные гласные.
// Алгоритм один в один с ai/src/dds_ai/bridge/rules.py — оценки фронта и сервера совпадают.
const FOLD: Record<string, string> = { з: 'с', д: 'т', б: 'п', г: 'к', в: 'ф', ж: 'ш', о: 'а', е: 'и', я: 'и' };
const FUZZY_MIN_STEM = 5;

const fold = (s: string) => s.replace(/[здбгвжоея]/g, (c) => FOLD[c]);

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Корень узнан в слове с ошибкой распознавания. Префикс слова (длиной корня ±1 буква) после свёртки
 * похожих звуков сравнивается с корнем: корни из 5–6 букв должны совпасть точно, длинные — с одной правкой.
 * Короткие корни и числа («19», «лифт») так не сравниваются: «лист» — не «лифт».
 */
function fuzzyHit(words: string[], stem: string): boolean {
  const n = stem.length;
  if (n < FUZZY_MIN_STEM || !/^\p{L}+$/u.test(stem)) return false;
  const budget = n <= 6 ? 0 : 1;
  const target = fold(stem);
  for (const w of words) {
    if (w.length < n - 1) continue;
    for (const k of [n - 1, n, n + 1]) if (k <= w.length && levenshtein(fold(w.slice(0, k)), target) <= budget) return true;
  }
  return false;
}

/**
 * Группы синонимов записаны корнями: [['передан', 'сообщ'], ['пик']].
 * Группа считается упомянутой, если в тексте есть хотя бы один её корень.
 * `fuzzy` — для текста из распознавания речи (доклад руководителю): корень засчитывается
 * и с типичной ошибкой STT («состревание» — «застре»). Набранный текст сверяется строго.
 */
export function matchGroups(text: string, groups: string[][], opts: { fuzzy?: boolean } = {}): { hit: number; missing: string[][] } {
  const t = normalize(text);
  const words = opts.fuzzy ? t.split(' ') : [];
  const hit = (stem: string) => {
    const s = normalize(stem);
    return t.includes(s) || (!!opts.fuzzy && fuzzyHit(words, s));
  };
  const missing = groups.filter((g) => !g.some(hit));
  return { hit: groups.length - missing.length, missing };
}

export interface LiteracyIssue {
  code: string;
  message: string;
}

const COMMON_TYPOS: Record<string, string> = {
  сдесь: 'здесь',
  щас: 'сейчас',
  ихний: 'их',
  ложить: 'класть',
  обсолютно: 'абсолютно',
  бригадда: 'бригада',
  расспил: 'распил',
  подьезд: 'подъезд',
  обьект: 'объект',
  рабочии: 'рабочие',
  сантехнник: 'сантехник',
  аварийнная: 'аварийная',
  перидана: 'передана',
  передона: 'передана',
  предана: 'передана',
  проинформированно: 'проинформировано',
};

export function literacyIssues(text: string): LiteracyIssue[] {
  const issues: LiteracyIssue[] = [];
  const t = text.trim();
  if (!t) return issues;

  if (/^[а-яё]/.test(t)) issues.push({ code: 'lowercase_start', message: 'Комментарий начинается со строчной буквы' });
  if (/ {2,}/.test(text)) issues.push({ code: 'double_space', message: 'Двойные пробелы' });
  if (/\s[,.;:!?]/.test(t)) issues.push({ code: 'space_before_punct', message: 'Пробел перед знаком препинания' });
  if (/[,;:][^\s\d»")]/.test(t)) issues.push({ code: 'no_space_after_punct', message: 'Нет пробела после знака препинания' });
  if (/[А-ЯЁ]{5,}/.test(t) && !/^(ЦОДД|МВД|МЧС|ГБУ|ОАТИ|МОЭК|ЦЭМП)$/.test(t)) {
    const caps = t.match(/[А-ЯЁ]{5,}/g) ?? [];
    if (caps.some((w) => !['ГОРМОСТ', 'МОСЛИФТ', 'ЖИЛИЩНИК'].includes(w)))
      issues.push({ code: 'caps', message: 'Текст набран прописными буквами' });
  }
  if (/[а-яё][a-z]|[a-z][а-яё]/i.test(t)) issues.push({ code: 'mixed_layout', message: 'Латинские буквы внутри русского слова (раскладка)' });

  const words = normalize(t).split(' ');
  for (let i = 1; i < words.length; i++) {
    if (words[i].length > 2 && words[i] === words[i - 1]) {
      issues.push({ code: 'repeat', message: `Повтор слова «${words[i]}»` });
      break;
    }
  }
  for (const w of words) {
    const fix = COMMON_TYPOS[w];
    if (fix) {
      issues.push({ code: 'typo', message: `Орфография: «${w}» → «${fix}»` });
    }
  }
  if (words.length < 3) issues.push({ code: 'too_short', message: 'Слишком короткий комментарий — информации недостаточно' });
  return issues;
}

/** Символов в минуту по «активному» времени набора (паузы > 2 с не считаются) */
export function cpm(chars: number, activeMs: number): number | null {
  if (chars < 10 || activeMs < 1500) return null;
  return Math.round((chars / activeMs) * 60000);
}

/** Трекер активного времени набора для поля ввода */
export class TypingTracker {
  chars = 0;
  activeMs = 0;
  private last = 0;

  keystroke(now = performance.now()) {
    this.added(1, now);
  }

  /** Изменение значения поля: прирост 1–3 символа — набор; большой скачок — вставка, в скорость не идёт */
  added(n: number, now = performance.now()) {
    if (n < 1 || n > 3) return;
    if (this.last && now - this.last < 2000) this.activeMs += now - this.last;
    this.last = now;
    this.chars += n;
  }

  reset() {
    this.chars = 0;
    this.activeMs = 0;
    this.last = 0;
  }
}
