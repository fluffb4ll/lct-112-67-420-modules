import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitCard, type SubmitCardRequest } from './sessions';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 201, headers: { 'Content-Type': 'application/json' } });

describe('submitCard', () => {
  it('бэкенд отвечает {id} — номер карточки берётся из id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ id: 'a2987f60-9be1-49cb-9014-187f6fbca225' })));
    expect(await submitCard({} as SubmitCardRequest)).toEqual({ cardId: 'a2987f60-9be1-49cb-9014-187f6fbca225' });
  });

  it('ответ {cardId} тоже принимается', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ cardId: 'c1' })));
    expect(await submitCard({} as SubmitCardRequest)).toEqual({ cardId: 'c1' });
  });

  it('без номера карточки — ошибка, а не вечное «отправляется»', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({})));
    await expect(submitCard({} as SubmitCardRequest)).rejects.toThrow();
  });
});
