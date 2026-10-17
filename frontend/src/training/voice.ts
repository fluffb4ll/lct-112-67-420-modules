/*
 * Голосовой канал эмулятора VoIP.
 *
 * Основной путь — ИИ-контур (ai/, офлайн): синтез — Piper (`POST /ai/v1/tts`, мужской и женский голос),
 * распознавание записи доклада — faster-whisper (`POST /ai/v1/stt`). Речь не уходит в облако.
 * Если контур не запущен или без моделей — то, что есть в браузере:
 *  - синтез речи: speechSynthesis (голоса Windows/Linux работают офлайн; выбираем мужской/женский);
 *  - распознавание: Web Speech API, если доступно; иначе — ввод доклада текстом (режим «текстовые сообщения» из ТЗ).
 * Запись с микрофона (MediaRecorder) идёт всегда — её распознаёт сервер.
 */

import { synthesize, transcribe, voiceCapabilities } from '../api/ai';

const MALE = /(pavel|dmitr|maxim|yuri|male|муж|павел|дмитрий)/i;
const FEMALE = /(irina|svetlana|ekaterina|elena|anna|milena|female|жен|ирина|светлана|алёна|алена)/i;

function ruVoices(): SpeechSynthesisVoice[] {
  if (!('speechSynthesis' in window)) return [];
  return window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('ru'));
}

export function ttsAvailable(): boolean {
  return 'speechSynthesis' in window;
}

let playing: { audio: HTMLAudioElement; done: () => void } | null = null;

/** Синтез на сервере; false — сервер не смог, нужен откат на браузер */
async function speakServer(text: string, gender: 'male' | 'female'): Promise<boolean> {
  if (!(await voiceCapabilities()).tts) return false;
  let url = '';
  try {
    url = URL.createObjectURL(await synthesize(text, gender));
    const audio = new Audio(url);
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        if (playing?.audio === audio) playing = null;
        resolve();
      };
      stopSpeaking();
      playing = { audio, done };
      audio.onended = done;
      audio.onerror = () => reject(new Error('audio'));
      audio.play().catch(reject);
    });
    return true;
  } catch {
    playing = null;
    return false;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

export async function speak(text: string, gender: 'male' | 'female'): Promise<void> {
  if (await speakServer(text, gender)) return;
  return speakBrowser(text, gender);
}

function speakBrowser(text: string, gender: 'male' | 'female'): Promise<void> {
  return new Promise((resolve) => {
    if (!ttsAvailable()) {
      setTimeout(resolve, Math.min(6000, 600 + text.length * 45));
      return;
    }
    const voices = ruVoices();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ru-RU';
    const byGender = voices.find((v) => (gender === 'male' ? MALE : FEMALE).test(v.name));
    u.voice = byGender ?? voices[0] ?? null;
    // если нужного голоса нет — отличаем собеседников хотя бы высотой тона
    if (!byGender) u.pitch = gender === 'male' ? 0.8 : 1.25;
    u.rate = 1.05;
    let done = false;
    let started = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    u.onstart = () => {
      started = true;
      // страховка: некоторые браузеры не присылают onend
      setTimeout(finish, 1500 + text.length * 90);
    };
    u.onend = finish;
    u.onerror = finish;
    // синтез так и не начался (нет голосов, заблокирован звук) — ждём только время на чтение текста
    setTimeout(() => {
      if (!started) setTimeout(finish, Math.max(1200, text.length * 30));
    }, 1200);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if (playing) {
    const { audio, done } = playing;
    playing = null;
    audio.pause();
    done();
  }
  if (ttsAvailable()) window.speechSynthesis.cancel();
}

// ───────────────────────────── Распознавание ─────────────────────────────

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => RecognitionLike;

export function sttAvailable(): boolean {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

/** Распознаёт ли сервер записи (faster-whisper). Тогда Web Speech не нужен */
export async function serverSttAvailable(): Promise<boolean> {
  return (await voiceCapabilities()).stt;
}

/** Распознать запись доклада на сервере; null — не удалось (откат на Web Speech или текст) */
export async function recognize(audio: Blob, hints: string[] = []): Promise<string | null> {
  try {
    return (await transcribe(audio, hints)).text.trim();
  } catch {
    return null;
  }
}

export interface Listener {
  stop(): void;
}

/** Потоковое распознавание: onText получает весь распознанный текст на текущий момент */
export function listen(onText: (text: string) => void, onFail: () => void): Listener {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) {
    onFail();
    return { stop() {} };
  }
  const rec = new Ctor();
  rec.lang = 'ru-RU';
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = '';
  let stopped = false;
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript + ' ';
      else interim += r[0].transcript;
    }
    onText((finalText + interim).trim());
  };
  rec.onerror = () => {
    if (!stopped) onFail();
  };
  rec.onend = () => {
    // Chrome сам останавливает распознавание на паузах — перезапускаем, пока идёт доклад
    if (!stopped) {
      try {
        rec.start();
      } catch {
        onFail();
      }
    }
  };
  try {
    rec.start();
  } catch {
    onFail();
  }
  return {
    stop() {
      stopped = true;
      try {
        rec.stop();
      } catch {
        // уже остановлено
      }
    },
  };
}

// ───────────────────────────── Запись микрофона ─────────────────────────────

export interface Recording {
  stop(): Promise<{ durationMs: number; blob: Blob | null }>;
}

export async function recordMic(): Promise<Recording | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream);
    const started = performance.now();
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.start();
    return {
      stop: () =>
        new Promise((resolve) => {
          rec.onstop = () => {
            stream.getTracks().forEach((t) => t.stop());
            resolve({ durationMs: performance.now() - started, blob: chunks.length ? new Blob(chunks, { type: rec.mimeType }) : null });
          };
          rec.stop();
        }),
    };
  } catch {
    return null;
  }
}
