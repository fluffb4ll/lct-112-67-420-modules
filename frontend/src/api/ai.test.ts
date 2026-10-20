import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiUnavailable, isAiRateLimited, synthesize } from './ai';

afterEach(() => vi.unstubAllGlobals());

describe('ошибки ИИ-контура', () => {
  it('429 от nginx — AiUnavailable со статусом, распознаётся как лимит', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));
    const e = await synthesize('тест').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AiUnavailable);
    expect((e as AiUnavailable).status).toBe(429);
    expect(isAiRateLimited(e)).toBe(true);
  });

  it('сеть недоступна — AiUnavailable без статуса, не лимит', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('failed to fetch'))));
    const e = await synthesize('тест').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AiUnavailable);
    expect(isAiRateLimited(e)).toBe(false);
  });

  it('503 — не лимит', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    expect(isAiRateLimited(await synthesize('тест').catch((x: unknown) => x))).toBe(false);
  });
});
