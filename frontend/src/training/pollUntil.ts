/*
 * Опрос с затуханием: первый запрос сразу, дальше паузы растут (3 → 5 → 10 с, потом каждые 10 с)
 * и обрываются по потолку. Нужен для оценки ИИ: модель думает до минуты, а долбить сервер
 * раз в пару секунд всё это время незачем.
 */

export interface PollOptions {
  /** паузы перед вторым, третьим… запросами; дальше повторяется repeatMs */
  delays: number[];
  repeatMs: number;
  /** после стольких миллисекунд от первого запроса новых не делаем */
  capMs: number;
}

// языковая модель думает до минуты, плюс очередь — ждём около двух минут
export const SCORE_POLL: PollOptions = { delays: [3000, 5000], repeatMs: 10_000, capMs: 120_000 };

export interface PollHandlers<T> {
  load: () => Promise<T>;
  /** итоговый ответ — опрос заканчивается */
  isDone: (value: T) => boolean;
  onValue: (value: T) => void;
  /** потолок вышел, итогового ответа так и не было */
  onGiveUp?: () => void;
}

/** Запустить опрос. Возвращает stop(): после него ни запросов, ни onValue — даже от ответа, который уже в пути. */
export function pollUntil<T>(h: PollHandlers<T>, opts: PollOptions = SCORE_POLL): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let elapsed = 0;
  let step = 0;

  const tick = async () => {
    let value: T | undefined;
    let ok = false;
    try {
      value = await h.load();
      ok = true;
    } catch {
      // сеть или бэкенд недоступны — пробуем ещё раз по расписанию
    }
    if (stopped) return;
    if (ok) {
      h.onValue(value as T);
      if (h.isDone(value as T)) return;
    }
    const pause = opts.delays[step] ?? opts.repeatMs;
    step++;
    if (elapsed + pause > opts.capMs) {
      h.onGiveUp?.();
      return;
    }
    elapsed += pause;
    timer = setTimeout(() => void tick(), pause);
  };

  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
