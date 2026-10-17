import { describe, expect, it } from 'vitest';
import { initialSttMode, sttFallback } from './sttMode';

describe('initialSttMode', () => {
  it('сервер в приоритете, затем браузер, затем текст', () => {
    expect(initialSttMode(true, true)).toBe('server');
    expect(initialSttMode(true, false)).toBe('server');
    expect(initialSttMode(false, true)).toBe('browser');
    expect(initialSttMode(false, false)).toBe('text');
  });
});

describe('sttFallback', () => {
  it('сервер не ответил — следующий доклад распознаёт браузер', () => {
    const r = sttFallback(null, true);
    expect(r.mode).toBe('browser');
    expect(r.note).toMatch(/браузер/);
  });

  it('сервер не ответил, браузер не умеет — ввод текстом', () => {
    expect(sttFallback(null, false)).toEqual({ mode: 'text', note: 'Сервер распознавания не ответил — введите доклад текстом' });
  });

  it('речь не распознана — доклад текстом, сервер остаётся', () => {
    expect(sttFallback('', true)).toEqual({ mode: 'server', note: 'Речь не распознана — введите доклад текстом' });
  });
});
