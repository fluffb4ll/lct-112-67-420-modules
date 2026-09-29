/*
 * Звуки эмулятора, синтезированные через Web Audio — без аудиофайлов и внешних ресурсов.
 * Контроль посылки вызова — 425 Гц, 1 с тон / 4 с пауза (стандарт телефонной сети РФ).
 */

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, gain = 0.08) {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.value = freq;
  o.type = 'sine';
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + start + 0.02);
  g.gain.setValueAtTime(gain, c.currentTime + start + dur - 0.03);
  g.gain.linearRampToValueAtTime(0, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.05);
}

/** Поступление новой карточки */
export function chime() {
  tone(880, 0, 0.18, 0.07);
  tone(1175, 0.2, 0.28, 0.07);
}

/** Вводная / сообщение */
export function blip() {
  tone(988, 0, 0.12, 0.05);
}

/** Контроль посылки вызова (гудки): один гудок — 1 секунда */
export function ringback(times: number) {
  for (let i = 0; i < times; i++) tone(425, i * 2.2, 1, 0.06);
}

/** Сигнал «занято» / отбой */
export function busy() {
  for (let i = 0; i < 3; i++) tone(425, i * 0.7, 0.35, 0.06);
}

/** Разблокировка аудио после первого действия пользователя (политика автоплея браузеров) */
export function unlockAudio() {
  ac();
}
