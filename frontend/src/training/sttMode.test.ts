import { describe, expect, it, vi } from 'vitest';
import { initialSttMode, serverTranscript, sttFallback, sttHints } from './sttMode';

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

describe('serverTranscript', () => {
  it('пустая запись — нераспознанная речь, сервер не спрашиваем', async () => {
    const recognize = vi.fn(async () => 'текст');
    expect(await serverTranscript(null, recognize)).toBe('');
    expect(recognize).not.toHaveBeenCalled();
  });

  it('есть запись — ответ сервера как есть, включая null (не ответил)', async () => {
    const blob = new Blob(['x']);
    expect(await serverTranscript(blob, async () => 'Кировоградская 22')).toBe('Кировоградская 22');
    expect(await serverTranscript(blob, async () => null)).toBeNull();
  });
});

describe('sttHints', () => {
  it('улица, дом и тип происшествия — whisper верно слышит «застревание»', () => {
    expect(sttHints({ address: { street: 'Кировоградская', house: '22' }, type: { finalType: 'Застревание в лифте' } })).toEqual([
      'Кировоградская',
      '22',
      'Застревание в лифте',
    ]);
  });

  it('пустые поля пропускаются', () => {
    expect(sttHints({ address: { street: 'Кировоградская', house: '' } })).toEqual(['Кировоградская']);
    expect(sttHints(undefined)).toEqual([]);
  });
});
