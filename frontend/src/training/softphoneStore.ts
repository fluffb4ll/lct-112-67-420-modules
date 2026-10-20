import { create } from 'zustand';
import type { CallPeer } from '../api/tutor';
import { mmss } from '../domain/format';

/** Подпись телефонного блока карточки, как в АРМ: «Отключение», «Вызов…», «Разговор 00:12» */
export function phoneLabel(phase: CallPhase, connectedAt: number | null, now: number) {
  if (phase === 'ringing') return 'Вызов…';
  if ((phase === 'connected' || phase === 'reply') && connectedAt) return `Разговор ${mmss((now - connectedAt) / 1000)}`;
  if (phase === 'failed') return 'Абонент недоступен';
  return 'Отключение';
}

export type CallPhase = 'idle' | 'ringing' | 'connected' | 'reply' | 'ended' | 'failed';

/** Входящий вызов: доклад бригады или руководителя по ходу работ */
export interface IncomingCall {
  id: string;
  from: string;
  text: string;
  voice: 'male' | 'female';
  /** Когда телефон начал звонить — по нему считается время до пропуска */
  since: number;
}

interface SoftphoneState {
  open: boolean;
  phase: CallPhase;
  number: string;
  peer: CallPeer | null;
  connectedAt: number | null;
  lines: { who: 'peer' | 'me'; text: string }[];
  /** Вызов, который звонит прямо сейчас */
  incoming: IncomingCall | null;
  /** Вызовы, пришедшие пока диспетчер говорил по телефону */
  queue: IncomingCall[];
  /** Идёт разговор по принятому входящему: диспетчер слушает доклад, а не докладывает сам */
  listening: boolean;
  setOpen: (v: boolean) => void;
  patch: (p: Partial<Omit<SoftphoneState, 'setOpen' | 'patch' | 'reset' | 'enqueue' | 'dropIncoming'>>) => void;
  /** Поставить входящий: если линия занята или уже кто-то звонит — в очередь */
  enqueue: (call: Omit<IncomingCall, 'id' | 'since'>) => void;
  /** Снять текущий входящий и, если линия свободна, поднять следующий из очереди */
  dropIncoming: (takeNext: boolean) => void;
  reset: () => void;
}

let callSeq = 0;

export const useSoftphone = create<SoftphoneState>((set, get) => ({
  open: false,
  phase: 'idle',
  number: '',
  peer: null,
  connectedAt: null,
  lines: [],
  incoming: null,
  queue: [],
  listening: false,
  setOpen: (open) => set({ open }),
  patch: (p) => set(p),
  enqueue: (call) => {
    const next: IncomingCall = { ...call, id: `in-${++callSeq}`, since: Date.now() };
    const s = get();
    const lineBusy = s.phase !== 'idle' && s.phase !== 'failed' && s.phase !== 'ended';
    if (s.incoming || lineBusy) set({ queue: [...s.queue, next] });
    else set({ incoming: next, open: true });
  },
  dropIncoming: (takeNext) => {
    const s = get();
    const [head, ...rest] = s.queue;
    // отсчёт до пропуска начинается с момента, когда вызов действительно зазвонил
    if (takeNext && head) set({ incoming: { ...head, since: Date.now() }, queue: rest, open: true });
    else set({ incoming: null });
  },
  reset: () => set({ phase: 'idle', number: '', peer: null, connectedAt: null, lines: [], incoming: null, queue: [], listening: false }),
}));
