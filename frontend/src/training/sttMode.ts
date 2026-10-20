import type { Address, IncidentType } from '../domain/types';

/*
 * Чем распознаётся доклад по софтфону. Порядок: сервер (запись → faster-whisper), браузер (Web Speech),
 * ввод текстом. Чистая логика без React и window — её проверяют тесты.
 */

export type SttMode = 'server' | 'browser' | 'text';

export function initialSttMode(serverOk: boolean, browserOk: boolean): SttMode {
  return serverOk ? 'server' : browserOk ? 'browser' : 'text';
}

/**
 * Сервер не распознал доклад. `result` — ответ recognize(): null — сервер не ответил, '' — речь не распознана.
 * Сервер упал — следующий доклад распознаёт браузер, если умеет; иначе доклад вводится текстом.
 * Пустой ответ при живом сервере — это тишина или шум, а не сбой: доклад вводится текстом, сервер остаётся.
 */
export function sttFallback(result: string | null, browserOk: boolean): { mode: SttMode; note: string } {
  if (result === null) {
    return browserOk
      ? { mode: 'browser', note: 'Сервер распознавания не ответил — повторите доклад, его распознает браузер' }
      : { mode: 'text', note: 'Сервер распознавания не ответил — введите доклад текстом' };
  }
  return { mode: 'server', note: 'Речь не распознана — введите доклад текстом' };
}

/**
 * Режим распознавания в софтфоне. Откат после сбоя сервера действует до конца звонка: в следующем
 * звонке снова пробуем сервер — разовый сбой не лишает серверного распознавания на всё занятие.
 */
export class SttState {
  mode: SttMode;
  private serverOk = false;
  private readonly browserOk: () => boolean;

  constructor(browserOk: () => boolean) {
    this.browserOk = browserOk;
    this.mode = initialSttMode(false, browserOk());
  }

  /** Ответ проверки доступности сервера распознавания. */
  serverChecked(ok: boolean) {
    this.serverOk = ok;
    if (ok) this.mode = 'server';
  }

  /** Новый звонок — исходный режим, откат прошлого звонка забыт. */
  startCall(): SttMode {
    this.mode = initialSttMode(this.serverOk, this.browserOk());
    return this.mode;
  }

  /** Сервер не распознал доклад — откат до конца звонка (см. sttFallback). */
  fail(result: string | null): { mode: SttMode; note: string } {
    const next = sttFallback(result, this.browserOk());
    this.mode = next.mode;
    return next;
  }
}

/**
 * Текст доклада от серверного распознавания. Пустая запись (микрофон ничего не дал) — как нераспознанная
 * речь (''), без запроса к серверу; null — сервер не ответил.
 */
export async function serverTranscript(blob: Blob | null | undefined, recognize: (blob: Blob) => Promise<string | null>): Promise<string | null> {
  return blob ? recognize(blob) : '';
}

/**
 * Подсказки серверному распознаванию (POST /ai/v1/stt?hints=): улица, дом и тип происшествия
 * («Застревание в лифте») — так whisper верно слышит «застревание», «корпус». Общие слова
 * («улица», «дом») не добавляем: whisper вставляет их в расшифровку.
 */
export function sttHints(incident: { address?: Pick<Address, 'street' | 'house'>; type?: Pick<IncidentType, 'finalType'> } | undefined): string[] {
  return [incident?.address?.street, incident?.address?.house, incident?.type?.finalType].filter((x): x is string => !!x);
}
