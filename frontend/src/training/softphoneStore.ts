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

interface SoftphoneState {
  open: boolean;
  phase: CallPhase;
  number: string;
  peer: CallPeer | null;
  connectedAt: number | null;
  lines: { who: 'peer' | 'me'; text: string }[];
  setOpen: (v: boolean) => void;
  patch: (p: Partial<Omit<SoftphoneState, 'setOpen' | 'patch' | 'reset'>>) => void;
  reset: () => void;
}

export const useSoftphone = create<SoftphoneState>((set) => ({
  open: false,
  phase: 'idle',
  number: '',
  peer: null,
  connectedAt: null,
  lines: [],
  setOpen: (open) => set({ open }),
  patch: (p) => set(p),
  reset: () => set({ phase: 'idle', number: '', peer: null, connectedAt: null, lines: [] }),
}));
