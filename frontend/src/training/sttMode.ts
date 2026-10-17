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
