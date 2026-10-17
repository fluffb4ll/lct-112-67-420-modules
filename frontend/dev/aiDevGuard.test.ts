import { describe, expect, it, vi } from 'vitest'
import { checkAi } from './aiDevGuard.ts'

const BACKEND = 'http://backend.test'
const answer = (status: number) => vi.fn(async () => new Response(null, { status }))

describe('проверка /ai/ в vite dev', () => {
  it('204 от /api/auth/check — пропускаем, кука уходит на бэкенд', async () => {
    const f = answer(204)
    expect(await checkAi('/ai/v1/tts', 'AUTH_TOKEN=abc', BACKEND, f)).toBe('next')
    expect(f).toHaveBeenCalledWith(`${BACKEND}/api/auth/check`, expect.objectContaining({ headers: { cookie: 'AUTH_TOKEN=abc' } }))
  })

  it('все четыре ручки фронта открыты, query не мешает', async () => {
    for (const url of ['/ai/v1/voice', '/ai/v1/tts', '/ai/v1/stt?hints=пожар', '/ai/v1/scenarios/compose'])
      expect(await checkAi(url, 'AUTH_TOKEN=abc', BACKEND, answer(204))).toBe('next')
  })

  it('без входа или с протухшим токеном — 401', async () => {
    expect(await checkAi('/ai/v1/voice', undefined, BACKEND, answer(401))).toBe(401)
    expect(await checkAi('/ai/v1/voice', 'AUTH_TOKEN=old', BACKEND, answer(403))).toBe(401)
  })

  it('слеш на конце адреса бэкенда не ломает проверку', async () => {
    const f = answer(204)
    expect(await checkAi('/ai/v1/voice', 'AUTH_TOKEN=abc', `${BACKEND}/`, f)).toBe('next')
    expect(f).toHaveBeenCalledWith(`${BACKEND}/api/auth/check`, expect.anything())
  })

  it('бэкенд упал или не отвечает — 503, а не выход из сессии', async () => {
    expect(await checkAi('/ai/v1/voice', 'AUTH_TOKEN=abc', BACKEND, answer(500))).toBe(503)
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    expect(await checkAi('/ai/v1/voice', 'AUTH_TOKEN=abc', BACKEND, f)).toBe(503)
  })

  it('вне списка — 404 без обращения к бэкенду', async () => {
    const f = answer(204)
    for (const url of [
      '/ai/v1/evaluate',
      '/ai/v1/voice/',
      '/ai/v1/voice/../evaluate',
      '/ai/v1/%76oice',
      '/aiv1/voice',
      '/ai',
      '/ai/',
    ])
      expect(await checkAi(url, 'AUTH_TOKEN=abc', BACKEND, f)).toBe(404)
    expect(f).not.toHaveBeenCalled()
  })

  it('не /ai — не наше дело', async () => {
    const f = answer(204)
    expect(await checkAi('/api/auth/check', undefined, BACKEND, f)).toBeNull()
    expect(await checkAi('/src/main.tsx', undefined, BACKEND, f)).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})
