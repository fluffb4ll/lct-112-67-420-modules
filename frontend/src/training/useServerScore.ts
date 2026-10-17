import { useEffect, useState } from 'react';
import { getCard } from '../api/sessions';
import { pollUntil } from './pollUntil';
import { evaluationOfCard, serverScoreView, type ServerScoreView } from './serverScore';

/** Оценка сданной карточки с сервера. Пока ИИ оценивает — опрашивает GET /api/cards/{id} с затуханием (pollUntil). Без id — null. */
export function useServerScore(cardId: string | undefined): ServerScoreView | null {
  const [view, setView] = useState<{ cardId: string; view: ServerScoreView } | null>(null);

  useEffect(() => {
    if (!cardId) return;
    return pollUntil({
      load: async () => serverScoreView(evaluationOfCard(await getCard(cardId))),
      isDone: (next) => next.kind !== 'pending',
      onValue: (next) => setView({ cardId, view: next }),
      onGiveUp: () => setView({ cardId, view: { kind: 'unavailable', label: 'Оценка ИИ пока не готова — посмотрите позже в кабинете' } }),
    });
  }, [cardId]);

  if (!cardId) return null;
  return view?.cardId === cardId ? view.view : { kind: 'pending', label: 'оценка ИИ готовится…' };
}
