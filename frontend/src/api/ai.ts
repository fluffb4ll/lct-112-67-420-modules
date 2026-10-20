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

/*
 * Ответ модели читаем под тем же ограничением времени, что и сам запрос: срок жизни
 * AbortController в aiFetch кончается на заголовках, а тело языковая модель может тянуть
 * сколько угодно — без этого окно генерации зависает насовсем.
 */
async function readJson<T>(res: Promise<Response>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AiUnavailable(`ИИ-контур молчит дольше ${Math.round(timeoutMs / 1000)} с`)), timeoutMs);
  });
  try {
    const body = await Promise.race([res.then((r) => r.json() as Promise<T>), limit]);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

const postJson = (path: string, body: unknown, timeoutMs?: number) =>
  aiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), timeoutMs });

/** Сколько ждём языковую модель на один сценарий (на слабом сервере она пишет долго) */
export const COMPOSE_TIMEOUT_MS = 120_000;

/** Модель, которой отвечал контур; null — на сервере модель не подключена */
export interface AiModelRef {
  component: string;
  model_name: string;
  model_version: string;
}

export interface ComposeResult {
  scenario: Scenario;
  by: 'llm' | 'template';
  /** поля, текст которых написала модель */
  applied?: string[];
  /** поля, которые модель написала, но контур их не пропустил */
  rejected?: string[];
  model?: AiModelRef | null;
}

const COMPOSE_FIELDS: Record<string, string> = {
  title: 'название',
  description: 'описание',
  chiefReply: 'ответ руководителя',
  sampleReport: 'эталонный доклад',
  inputs: 'реплики исполнителя',
};

/**
 * Почему текст остался от заготовки. Берётся из ответа контура, а не из догадок: model: null —
 * модели на сервере нет вовсе; непустой rejected — модель написала, но проверка не пропустила.
 */
export function composeFallbackReason(r: ComposeResult): string {
  if (r.model === null) return 'на сервере не подключена языковая модель — контур работает по правилам';
  const bad = (r.rejected ?? []).map((f) => COMPOSE_FIELDS[f] ?? f);
  if (bad.length) return `модель написала текст, но проверка контура его отклонила: ${bad.join(', ')}`;
  return 'модель не ответила за отведённое время или вернула ответ, который не разобрать';
}

/** Языковая модель переписывает текст заготовки; эталон и проверки остаются от правил */
export function composeScenario(scenario: Scenario, complication: Complication, difficulty: number): Promise<ComposeResult> {
  // на слабом сервере модель пишет долго: ждём ограниченное время, иначе остаётся текст шаблона
  return readJson<ComposeResult>(postJson('/v1/scenarios/compose', { scenario, complication, difficulty }, COMPOSE_TIMEOUT_MS), COMPOSE_TIMEOUT_MS);
}

/** Сколько ждём реплику абонента: дальше отвечает шаблон */
const REPLY_TIMEOUT_MS = 10_000;

export interface DialogueReply {
  reply: string;
  by: 'llm' | 'template';
}

/**
 * Реплика абонента в учебном телефоне: роль, краткая карточка, ход разговора и то,
 * что сказал обучающийся. Если контур молчит — остаётся шаблон, который фронт прислал сам.
 */
export function dialogueReply(req: {
  role: string;
  roleKey: 'chief' | 'master' | 'emergency' | 'other';
  said: string;
  fallback: string;
  card: { address: string; incident: string; description: string; victims: boolean };
  history: { who: 'me' | 'peer'; text: string }[];
}): Promise<DialogueReply> {
  // ждать реплику дольше десяти секунд нельзя — это телефонный разговор, а не переписка
  return readJson<DialogueReply>(postJson('/v1/dialogue/reply', req, REPLY_TIMEOUT_MS), REPLY_TIMEOUT_MS);
}

export interface Transcript {
  text: string;
  confidence: number | null;
}

/** Распознавание речи на сервере (faster-whisper), без облачных сервисов. Тело — сама запись */
export async function transcribe(audio: Blob, hints: string[] = []): Promise<Transcript> {
  const q = hints.length ? `?hints=${encodeURIComponent(hints.join(','))}` : '';
  const res = aiFetch(`/v1/stt${q}`, {
    method: 'POST',
    headers: { 'Content-Type': audio.type || 'application/octet-stream' },
    body: audio,
    timeoutMs: 60_000,
  });
  return readJson<Transcript>(res, 60_000);
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
