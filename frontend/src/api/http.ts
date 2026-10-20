/*
 * HTTP-клиент для бэкенда. Все запросы идут на относительный путь /api/…:
 * в разработке Vite проксирует его на сервер бэкенда (vite.config.ts, переменная VITE_API_TARGET),
 * в сборке — тот же адрес через веб-сервер учебного контура.
 *
 * Авторизация — httpOnly-кука AUTH_TOKEN, которую ставит бэкенд при входе. Браузер сам
 * прикладывает её к запросам; фронт токен не видит и не хранит.
 * Кука выставлена с флагом Secure: в разработке открывайте фронт по http://localhost:5173
 * (localhost браузеры считают безопасным), а не по IP-адресу — иначе кука не сохранится.
 */

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Что делать, когда бэкенд ответил 401 на обычный запрос (сессия истекла или токен отозван)
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

/**
 * Отказ из-за нехватки прав (сессия жива). Бэкенд отвечает на это 403; старый бэкенд отдавал 401
 * с «…permission…» в тексте («You do not have required permissions») — его тоже считаем отказом в правах,
 * а не истёкшей сессией.
 */
export function isRightsError(status: number, message: string): boolean {
  return status === 403 || (status === 401 && /permission/i.test(message));
}

export const isPermissionDenied = (e: unknown): boolean => e instanceof ApiError && isRightsError(e.status, e.message);

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { errorMessage?: string; message?: string };
    return body.errorMessage ?? body.message ?? '';
  } catch {
    return '';
  }
}

export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown; skipAuthRedirect?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers,
      credentials: 'same-origin',
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Сервер недоступен. Проверьте подключение к сети учебного центра.');
  }

  if (!res.ok) {
    const message = await errorMessage(res);
    if (res.status === 401 && !isRightsError(res.status, message) && !init.skipAuthRedirect) onUnauthorized?.();
    throw new ApiError(res.status, message);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Запрос к методу, которого на сервере может ещё не быть: null означает «метода нет» */
export async function apiFetchOptional<T>(path: string): Promise<T | null> {
  try {
    return await apiFetch<T>(path);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
    throw e;
  }
}
