import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollUntil, SCORE_POLL } from './pollUntil';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Моменты вызовов load (в секундах от старта) за указанное время */
async function callTimes(run: (load: () => Promise<string>) => () => void, totalMs: number) {
  const times: number[] = [];
  const start = Date.now();
  const stop = run(async () => {
    times.push((Date.now() - start) / 1000);
    return 'PENDING';
  });
  await vi.advanceTimersByTimeAsync(totalMs);
  stop();
  return times;
}

describe('pollUntil — опрос оценки ИИ с затуханием', () => {
  it('паузы 3 → 5 → 10 с, дальше каждые 10 с, потолок около двух минут', async () => {
    const onGiveUp = vi.fn();
    const times = await callTimes((load) => pollUntil({ load, isDone: () => false, onValue: () => undefined, onGiveUp }), 300_000);
    expect(times.slice(0, 5)).toEqual([0, 3, 8, 18, 28]);
    expect(times.at(-1)).toBe(118);
    expect(times.length).toBe(14);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it('потолок по умолчанию — не больше двух минут', () => {
    expect(SCORE_POLL.capMs).toBeLessThanOrEqual(120_000);
    expect(SCORE_POLL.delays[0]).toBe(3000);
  });

  it('останавливается на итоговом ответе (OK или UNAVAILABLE)', async () => {
    for (const final of ['OK', 'UNAVAILABLE']) {
      const answers = ['PENDING', 'PENDING', final];
      const load = vi.fn(async () => answers.shift() ?? 'PENDING');
      const seen: string[] = [];
      const onGiveUp = vi.fn();
      pollUntil({ load, isDone: (v) => v !== 'PENDING', onValue: (v) => seen.push(v), onGiveUp });
      await vi.advanceTimersByTimeAsync(300_000);
      expect(load).toHaveBeenCalledTimes(3);
      expect(seen).toEqual(['PENDING', 'PENDING', final]);
      expect(onGiveUp).not.toHaveBeenCalled();
    }
  });

  it('stop() прекращает опрос — при размонтировании', async () => {
    const load = vi.fn(async () => 'PENDING');
    const stop = pollUntil({ load, isDone: () => false, onValue: () => undefined });
    await vi.advanceTimersByTimeAsync(4000);
    expect(load).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('ответ, пришедший после stop(), не применяется', async () => {
    let resolve: (v: string) => void = () => undefined;
    const onValue = vi.fn();
    const stop = pollUntil({ load: () => new Promise<string>((r) => (resolve = r)), isDone: () => true, onValue });
    stop();
    resolve('OK');
    await vi.advanceTimersByTimeAsync(0);
    expect(onValue).not.toHaveBeenCalled();
  });

  it('ошибка сети не обрывает опрос', async () => {
    let n = 0;
    const load = vi.fn(async () => {
      if (++n < 3) throw new Error('сеть');
      return 'OK';
    });
    const onValue = vi.fn();
    pollUntil({ load, isDone: () => true, onValue });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(load).toHaveBeenCalledTimes(3);
    expect(onValue).toHaveBeenCalledExactlyOnceWith('OK');
  });
});
