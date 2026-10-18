import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserInfoDto } from '../api/auth';

// Вкладка помнит своего пользователя, а кука одна на браузер: сверка с GET /api/auth/me

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const teacher: UserInfoDto = { id: 't1', username: 'i.ivanov', fullName: 'Иванов Иван Иванович', role: 'ROLE_TEACHER', permissions: [] };
const student: UserInfoDto = { id: 's1', username: 'v.pupkin', fullName: 'Пупкин Василий Тестович', role: 'ROLE_STUDENT', permissions: [] };

const respond = (status: number, body?: unknown) =>
  vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

let session: Storage;

async function loadSession(user: UserInfoDto | null) {
  vi.resetModules();
  session = memoryStorage();
  if (user) session.setItem('dds-trainer-session', JSON.stringify({ user }));
  vi.stubGlobal('sessionStorage', session);
  vi.stubGlobal('localStorage', memoryStorage());
  const mod = await import('./session');
  const reload = vi.fn();
  mod.setReloadForTests(reload);
  return { ...mod, reload };
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('verifySessionUser', () => {
  it('в другой вкладке вошёл другой пользователь — сессия вкладки сброшена, перезагрузка с пояснением', async () => {
    const s = await loadSession(teacher);
    vi.stubGlobal('fetch', respond(200, student));

    await s.verifySessionUser();

    expect(s.reload).toHaveBeenCalledOnce();
    expect(session.getItem('dds-trainer-session')).toBeNull();
    expect(session.getItem('dds-trainer-session-notice')).toContain('Пупкин В Т');
  });

  it('пояснение показывается на странице входа после перезагрузки один раз', async () => {
    vi.resetModules();
    const storage = memoryStorage();
    storage.setItem('dds-trainer-session-notice', 'вошёл другой');
    vi.stubGlobal('sessionStorage', storage);
    const { useSession } = await import('./session');
    expect(useSession.getState().notice).toBe('вошёл другой');
    expect(storage.getItem('dds-trainer-session-notice')).toBeNull();
  });

  it('тот же пользователь — ничего не сбрасывается, данные обновляются', async () => {
    const s = await loadSession(teacher);
    vi.stubGlobal('fetch', respond(200, { ...teacher, fullName: 'Иванов Иван Петрович' }));

    await s.verifySessionUser();

    expect(s.reload).not.toHaveBeenCalled();
    expect(s.useSession.getState().user?.fullName).toBe('Иванов Иван Петрович');
  });

  it('кука удалена или истекла (401) — «Сессия истекла»', async () => {
    const s = await loadSession(teacher);
    vi.stubGlobal('fetch', respond(401));

    await s.verifySessionUser();

    expect(s.useSession.getState().user).toBeNull();
    expect(s.useSession.getState().notice).toMatch(/истекла/);
    expect(s.reload).not.toHaveBeenCalled();
  });

  it('сервер недоступен — вкладка остаётся как была', async () => {
    const s = await loadSession(teacher);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network'))));

    await s.verifySessionUser();

    expect(s.useSession.getState().user?.id).toBe('t1');
    expect(s.reload).not.toHaveBeenCalled();
  });

  it('без входа во вкладке сервер не спрашиваем', async () => {
    const s = await loadSession(null);
    const fetch = respond(200, student);
    vi.stubGlobal('fetch', fetch);

    await s.verifySessionUser();

    expect(fetch).not.toHaveBeenCalled();
  });

  it('вход во время сверки — сверка повторяется и ловит нового пользователя', async () => {
    const s = await loadSession(teacher);
    let first = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const body = first ? teacher : student;
        first = false;
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );

    const running = s.verifySessionUser();
    void s.verifySessionUser();
    await running;

    expect(s.reload).toHaveBeenCalledOnce();
  });

  it('вход сообщает другим вкладкам через localStorage', async () => {
    const s = await loadSession(null);
    s.useSession.getState().signIn(teacher);
    expect(JSON.parse(localStorage.getItem(s.LOGIN_SIGNAL_KEY) ?? '{}').userId).toBe('t1');
  });
});
