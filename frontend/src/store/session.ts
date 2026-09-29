import { useMemo } from 'react';
import { create } from 'zustand';
import { logoutRequest, toRole, toUser, type UserInfoDto } from '../api/auth';
import { setUnauthorizedHandler } from '../api/http';
import type { Role, User } from '../domain/types';

/*
 * Сессия после входа через бэкенд. Сам токен живёт в httpOnly-куке и фронту недоступен;
 * здесь хранятся только данные пользователя из ответа /api/auth/login (sessionStorage — своя сессия у каждой вкладки).
 * Если бэкенд отвечает 401 (токен истёк или отозван), сессия сбрасывается и открывается страница входа.
 */

const KEY = 'dds-trainer-session';

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

function clear() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // нет доступа к sessionStorage
  }
}

export const useSession = create<SessionState>((set) => ({
  user: load(),
  notice: '',
  signIn: (user) => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ user }));
    } catch {
      // сессия будет жить только в памяти вкладки
    }
    set({ user, notice: '' });
  },
  signOut: async () => {
    clear();
    set({ user: null, notice: '' });
    await logoutRequest();
  },
  expire: () => {
    clear();
    set({ user: null, notice: 'Сессия истекла. Войдите снова.' });
  },
}));

setUnauthorizedHandler(() => {
  if (useSession.getState().user) useSession.getState().expire();
});

/** Текущий пользователь и его роль (из ответа бэкенда при входе) */
export function useMe(): { user: User | null; role: Role | null; info: UserInfoDto | null } {
  const info = useSession((s) => s.user);
  return useMemo(() => {
    if (!info) return { user: null, role: null, info: null };
    return { user: toUser(info), role: toRole(info), info };
  }, [info]);
}
