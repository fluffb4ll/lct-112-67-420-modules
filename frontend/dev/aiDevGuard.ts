/*
 * Проверка входа перед проксированием /ai/ в разработке (vite dev и vite preview).
 *
 * Повторяет nginx из сборки (docker/nginx.conf.template): наружу только ручки, которые зовёт фронт,
 * остальное — 404; перед проксированием — GET {бэкенд}/api/auth/check с кукой запроса
 * (204 — пускаем, иначе 401). Лимитов частоты здесь нет — их ставит только nginx.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

/** Ручки ИИ-контура, открытые фронту, — тот же список, что в nginx */
export const AI_PUBLIC_PATHS: ReadonlySet<string> = new Set([
  '/ai/v1/voice',
  '/ai/v1/tts',
  '/ai/v1/stt',
  '/ai/v1/scenarios/compose',
])

/** 'next' — пропустить к proxy, число — ответить этим статусом */
export type AiGuardResult = 'next' | 401 | 404 | 503

/** Решение по запросу; null — запрос не к ИИ-контуру, guard его не касается */
export async function checkAi(
  url: string,
  cookie: string | undefined,
  backend: string,
  fetchFn: typeof fetch = fetch,
): Promise<AiGuardResult | null> {
  // proxy '/ai' срабатывает на любой путь, начинающийся с /ai (в том числе /aifoo)
  if (!url.startsWith('/ai')) return null
  // сырой путь без нормализации: /ai/v1/voice/, …/../evaluate и %76oice не пройдут
  const path = url.split('?', 1)[0]
  if (!AI_PUBLIC_PATHS.has(path)) return 404
  try {
    const res = await fetchFn(`${backend}/api/auth/check`, {
      headers: cookie ? { cookie } : {},
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    })
    return res.status === 204 ? 'next' : 401
  } catch {
    // бэкенд не ответил — вход не проверить
    return 503
  }
}

type Next = (err?: unknown) => void

function middleware(backend: string) {
  return (req: IncomingMessage, res: ServerResponse, next: Next) => {
    checkAi(req.url ?? '', req.headers.cookie, backend).then(
      (r) => {
        if (r === null || r === 'next') return next()
        res.statusCode = r
        res.end()
      },
      next,
    )
  }
}

/** Плагин: middleware ставится до встроенного proxy (preview.proxy по умолчанию берёт server.proxy) */
export function aiDevGuard(backend: string): Plugin {
  return {
    name: 'ai-dev-guard',
    // без возврата функции — до встроенных middleware Vite, в том числе proxy
    configureServer(server) {
      server.middlewares.use(middleware(backend))
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(backend))
    },
  }
}
