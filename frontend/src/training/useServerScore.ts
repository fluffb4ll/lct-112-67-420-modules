import { useEffect, useState } from 'react';
import { getCard, type Evaluation as ServerEvaluation } from '../api/sessions';
import { pollUntil } from './pollUntil';
import { evaluationOfCard, serverScoreView, type ServerScoreView } from './serverScore';

type Loaded = { view: ServerScoreView; ev: ServerEvaluation | null };

/**
 * Оценка сданной карточки с сервера вместе с её отображением (балл, комментарий преподавателя).
 * Пока ИИ оценивает — опрашивает GET /api/cards/{id} с затуханием (pollUntil). Без id — null.
 */
export function useServerEvaluation(cardId: string | undefined): Loaded | null {
  const [state, setState] = useState<{ cardId: string } & Loaded>();

  useEffect(() => {
    if (!cardId) return;
    return pollUntil({
      load: async (): Promise<Loaded> => {
        const ev = evaluationOfCard(await getCard(cardId));
        return { view: serverScoreView(ev), ev };
      },
      isDone: (next) => next.view.kind !== 'pending',
      onValue: (next) => setState({ cardId, ...next }),
      onGiveUp: () => setState({ cardId, ev: null, view: { kind: 'unavailable', label: 'Оценка ИИ пока не готова — посмотрите позже в кабинете' } }),
    });
  }, [cardId]);

  if (!cardId) return null;
  return state?.cardId === cardId ? state : { view: { kind: 'pending', label: 'оценка ИИ готовится…' }, ev: null };
}

/** Только отображение оценки: цифра и подпись */
export function useServerScore(cardId: string | undefined): ServerScoreView | null {
  return useServerEvaluation(cardId)?.view ?? null;
}
