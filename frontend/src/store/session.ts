import { useMemo } from 'react';
import { create } from 'zustand';
import { logoutRequest, meRequest, toRole, toUser, type UserInfoDto } from '../api/auth';
import { ApiError, setUnauthorizedHandler } from '../api/http';
import { shortName } from '../domain/format';
import type { Role, User } from '../domain/types';

/*
 * Сессия после входа через бэкенд. Сам токен живёт в httpOnly-куке и фронту недоступен;
 * здесь хранятся только данные пользователя из ответа /api/auth/login (sessionStorage — своя сессия у каждой вкладки).
 * Если бэкенд отвечает 401 (токен истёк или отозван), сессия сбрасывается и открывается страница входа.
 *
 * Кука одна на весь браузер: вход в другой вкладке подменяет пользователя и здесь, хотя вкладка
 * показывает прежнего. Поэтому вкладка сверяется с сервером (GET /api/auth/me) при запуске,
 * при возврате на вкладку и по сигналу входа/выхода из другой вкладки (localStorage).
 * Не совпало — вкладка перезагружается на страницу входа с пояснением.
 */

const KEY = 'dds-trainer-session';
/** Пояснение для страницы входа, переживающее перезагрузку вкладки */
const NOTICE_KEY = 'dds-trainer-session-notice';
/** Сигнал другим вкладкам: в браузере вошёл другой пользователь или вышел */
export const LOGIN_SIGNAL_KEY = 'dds-trainer-login';

interface SessionState {
  user: UserInfoDto | null;
  /** Сообщение для страницы входа, например «Сессия истекла» */
  notice: string;
  signIn: (user: UserInfoDto) => void;
  signOut: () => Promise<void>;
  expire: () => void;
}

function load(): UserInfoDto | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? ((JSON.parse(raw) as { user?: UserInfoDto }).user ?? null) : null;
  } catch {
    return null;
  }
}

function save(user: UserInfoDto) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ user }));
  } catch {
    // сессия будет жить только в памяти вкладки
  }
}

function clear() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // нет доступа к sessionStorage
  }
}

/** Пояснение, оставленное перед перезагрузкой; читается один раз */
function takeNotice(): string {
  try {
    const notice = sessionStorage.getItem(NOTICE_KEY) ?? '';
    sessionStorage.removeItem(NOTICE_KEY);
    return notice;
  } catch {
    return '';
  }
}

function announce(userId: string | null) {
  try {
    localStorage.setItem(LOGIN_SIGNAL_KEY, JSON.stringify({ userId, at: Date.now() }));
  } catch {
    // другие вкладки сверятся при возврате на них
  }
}

export const useSession = create<SessionState>((set) => ({
  user: load(),
  notice: takeNotice(),
  signIn: (user) => {
    save(user);
    set({ user, notice: '' });
    announce(user.id);
  },
  signOut: async () => {
    clear();
    set({ user: null, notice: '' });
    await logoutRequest();
    announce(null);
  },
  expire: () => {
    clear();
    set({ user: null, notice: 'Сессия истекла. Войдите снова.' });
  },
}));

setUnauthorizedHandler(() => {
  if (useSession.getState().user) useSession.getState().expire();
});

/** Перезагрузка на главную: сбросить состояние экранов прежнего пользователя (подменяется в тестах) */
let reloadToStart = () => window.location.assign('/');
export function setReloadForTests(fn: () => void) {
  reloadToStart = fn;
}

let checking: Promise<void> | null = null;
/** Пока шла сверка, пришёл новый повод (например, вход в другой вкладке) — сверить ещё раз */
let recheck = false;

/**
 * Сверить пользователя вкладки с владельцем куки. Не тот — перезагрузка на страницу входа,
 * куки нет или токен истёк — «Сессия истекла», сервер недоступен — ничего не меняем.
 */
export function verifySessionUser(): Promise<void> {
  if (!useSession.getState().user) return Promise.resolve();
  if (checking) {
    recheck = true;
    return checking;
  }
  checking = (async () => {
    try {
      const server = await meRequest();
      const local = useSession.getState().user;
      if (!local) return;
      if (server?.id !== local.id) {
        clear();
        try {
          sessionStorage.setItem(
            NOTICE_KEY,
            `В другой вкладке выполнен вход под пользователем ${shortName(server?.fullName) || 'другим'}. ` +
              'В одном браузере работает один пользователь — войдите снова.',
          );
        } catch {
          // без пояснения
        }
        recheck = false;
        reloadToStart();
        return;
      }
      if (JSON.stringify(server) !== JSON.stringify(local)) {
        save(server);
        useSession.setState({ user: server });
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && useSession.getState().user) useSession.getState().expire();
    } finally {
      checking = null;
    }
    if (recheck) {
      recheck = false;
      await verifySessionUser();
    }
  })();
  return checking;
}

/** Подписка на возврат во вкладку и сигналы других вкладок; вызывается один раз при запуске */
export function installSessionSync() {
  void verifySessionUser();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void verifySessionUser();
  });
  window.addEventListener('focus', () => void verifySessionUser());
  window.addEventListener('storage', (e) => {
    if (e.key === LOGIN_SIGNAL_KEY) void verifySessionUser();
  });
}

/** Текущий пользователь и его роль (из ответа бэкенда при входе) */
export function useMe(): { user: User | null; role: Role | null; info: UserInfoDto | null } {
  const info = useSession((s) => s.user);
  return useMemo(() => {
    if (!info) return { user: null, role: null, info: null };
    return { user: toUser(info), role: toRole(info), info };
  }, [info]);
}
