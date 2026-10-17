import { useEffect, useState } from 'react';
import { getCard } from '../api/sessions';
import { evaluationOfCard, serverScoreView, type ServerScoreView } from './serverScore';

const POLL_MS = 4000;
// языковая модель думает до минуты, плюс очередь — ждём около трёх минут
const POLL_TRIES = 45;

/** Оценка сданной карточки с сервера. Пока ИИ оценивает — опрашивает GET /api/cards/{id}. Без id — null. */
export function useServerScore(cardId: string | undefined): ServerScoreView | null {
  const [view, setView] = useState<{ cardId: string; view: ServerScoreView } | null>(null);

  useEffect(() => {
    if (!cardId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const tick = async () => {
      tries++;
      let next: ServerScoreView | null = null;
      try {
        next = serverScoreView(evaluationOfCard(await getCard(cardId)));
      } catch {
        // сеть или бэкенд недоступны — пробуем ещё раз
      }
      if (stopped) return;
      if (next) setView({ cardId, view: next });
      if ((!next || next.kind === 'pending') && tries < POLL_TRIES) timer = setTimeout(() => void tick(), POLL_MS);
      else if (!next || next.kind === 'pending') setView({ cardId, view: { kind: 'unavailable', label: 'Оценка ИИ пока не готова — посмотрите позже в кабинете' } });
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [cardId]);

  if (!cardId) return null;
  return view?.cardId === cardId ? view.view : { kind: 'pending', label: 'оценка ИИ готовится…' };
}
