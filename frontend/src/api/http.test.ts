import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeError } from './errors';
import { ApiError, apiFetch, isPermissionDenied, setUnauthorizedHandler } from './http';

const reply = (status: number, errorMessage?: string) =>
  vi.fn(async () => new Response(errorMessage === undefined ? '' : JSON.stringify({ errorMessage }), { status }));

let logout: ReturnType<typeof vi.fn<() => void>>;
beforeEach(() => {
  logout = vi.fn<() => void>();
  setUnauthorizedHandler(logout);
});
afterEach(() => vi.unstubAllGlobals());

async function failWith(status: number, errorMessage?: string): Promise<ApiError> {
  vi.stubGlobal('fetch', reply(status, errorMessage));
  try {
    await apiFetch('/users');
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('запрос должен был упасть');
}

describe('apiFetch — нехватка прав не разлогинивает', () => {
  it('403 (новый бэкенд) — сессия остаётся, «Недостаточно прав»', async () => {
    const e = await failWith(403, 'You do not have required permissions');
    expect(logout).not.toHaveBeenCalled();
    expect(isPermissionDenied(e)).toBe(true);
    expect(describeError(e)).toBe('Недостаточно прав для этого действия');
    // свой текст — «Вы не состоите в группе», без текста — общее
    expect(describeError(await failWith(403, "You are not a member of this session's study group"))).toBe('Вы не состоите в группе этого занятия');
    expect(describeError(await failWith(403))).toBe('Недостаточно прав');
    expect(logout).not.toHaveBeenCalled();
  });

  it('401 с «permission» (старый бэкенд) — тоже отказ в правах, без выхода', async () => {
    const e = await failWith(401, 'You do not have required permissions');
    expect(logout).not.toHaveBeenCalled();
    expect(isPermissionDenied(e)).toBe(true);
  });

  it('401 без «permission» — сессия истекла, возврат на вход', async () => {
    const e = await failWith(401, 'Authentication token expired');
    expect(logout).toHaveBeenCalledOnce();
    expect(isPermissionDenied(e)).toBe(false);
  });

  it('прочие ошибки — не отказ в правах', async () => {
    expect(isPermissionDenied(await failWith(400, 'Scenario not found'))).toBe(false);
    expect(isPermissionDenied(new Error('x'))).toBe(false);
  });
});
