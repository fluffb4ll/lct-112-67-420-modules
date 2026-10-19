/*
 * Прямые вызовы ИИ-контура (сервис ai/, порт 8090) по относительному пути /ai/…:
 * в сборке его проксирует nginx фронта (docker/nginx.conf.template), в разработке — Vite
 * (vite.config.ts, переменная VITE_AI_TARGET). Оценку сданных карточек ИИ-контур получает
 * от бэкенда; сюда вынесено то, что нужно фронту напрямую: генерация текста сценария и голос.
 *
 * Контур может быть не запущен или работать без моделей — тогда каждая функция бросает
 * AiUnavailable, а вызывающий код откатывается на свой вариант (шаблон, Web Speech, ввод текстом).
 *
 * В сборке nginx пускает к /ai/ только после входа: проверяет ту же httpOnly-куку AUTH_TOKEN,
 * что и бэкенд (как в http.ts — браузер прикладывает её сам), и ограничивает частоту запросов.
 * 401 (сессия истекла) и 429 (лимит) здесь тоже AiUnavailable: сессию сбросит первый же запрос
 * к бэкенду, а голос и текст сценария откатятся на браузерные варианты.
 */

import type { Scenario } from '../domain/types';
import type { Complication } from './generator';

export class AiUnavailable extends Error {}

async function aiFetch(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 90_000);
  try {
    const res = await fetch(`/ai${path}`, { ...init, credentials: 'same-origin', signal: ctrl.signal });
    if (!res.ok) throw new AiUnavailable(`ИИ-контур ответил ${res.status}`);
    return res;
  } catch (e) {
    throw e instanceof AiUnavailable ? e : new AiUnavailable('ИИ-контур недоступен');
  } finally {
    clearTimeout(timer);
  }
}

const postJson = (path: string, body: unknown, timeoutMs?: number) =>
  aiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeoutMs });

export interface ComposeResult {
  scenario: Scenario;
  by: 'llm' | 'template';
}

/** Языковая модель переписывает текст заготовки; эталон и проверки остаются от правил */
export async function composeScenario(scenario: Scenario, complication: Complication, difficulty: number): Promise<ComposeResult> {
  const res = await postJson('/v1/scenarios/compose', { scenario, complication, difficulty });
  return (await res.json()) as ComposeResult;
}

export interface Transcript {
  text: string;
  confidence: number | null;
}

/** Распознавание речи на сервере (faster-whisper), без облачных сервисов. Тело — сама запись */
export async function transcribe(audio: Blob, hints: string[] = []): Promise<Transcript> {
  const q = hints.length ? `?hints=${encodeURIComponent(hints.join(','))}` : '';
  const res = await aiFetch(`/v1/stt${q}`, {
    method: 'POST',
    headers: { 'Content-Type': audio.type || 'application/octet-stream' },
    body: audio,
    timeoutMs: 60_000,
  });
  return (await res.json()) as Transcript;
}

/** Синтез речи на сервере (Piper); ответ — WAV */
export async function synthesize(text: string, voice: 'male' | 'female' = 'female'): Promise<Blob> {
  const res = await postJson('/v1/tts', { text, voice }, 30_000);
  return res.blob();
}

/** Что из голосового тракта есть на сервере: проверяется один раз за загрузку страницы */
let voiceCaps: Promise<{ stt: boolean; tts: boolean }> | null = null;
export function voiceCapabilities(): Promise<{ stt: boolean; tts: boolean }> {
  voiceCaps ??= aiFetch('/v1/voice', { timeoutMs: 4000 })
    .then((r) => r.json() as Promise<{ stt: boolean; tts: boolean }>)
    .catch(() => {
      voiceCaps = null; // контур мог ещё подниматься — спросим снова при следующем звонке
      return { stt: false, tts: false };
    });
  return voiceCaps;
}
