import { useEffect, useState } from 'react';
import { getCard, type CardSummary, type Evaluation as ServerEvaluation } from '../api/sessions';
import { evaluationOfCard } from './serverScore';

/*
 * Оценки карточек для бейджей в списках. Список карточек (CardSummary) несёт только статус
 * SUBMITTED/EVALUATED, а «ИИ недоступен» видно лишь по оценке. Запрашиваем её только для
 * неоценённых карточек — их немного; оценённым хватает статуса.
 */

export type CardEvaluations = Record<string, ServerEvaluation>;

/** Оценки неоценённых карточек; карточка, по которой запрос не удался или оценки нет, в ответ не попадает */
export async function loadCardEvaluations(
  cards: Pick<CardSummary, 'id' | 'status'>[],
  load: (cardId: string) => Promise<ServerEvaluation | null> = async (id) => evaluationOfCard(await getCard(id)),
): Promise<CardEvaluations> {
  const ids = cards.filter((c) => c.status !== 'EVALUATED').map((c) => c.id);
  const res = await Promise.allSettled(ids.map((id) => load(id)));
  const out: CardEvaluations = {};
  res.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) out[ids[i]] = r.value;
  });
  return out;
}

/** То же как хук: перезапрашивает при смене набора карточек и их статусов */
export function useCardEvaluations(cards: Pick<CardSummary, 'id' | 'status'>[] | undefined): CardEvaluations {
  const [evals, setEvals] = useState<CardEvaluations>({});
  const key = (cards ?? []).map((c) => `${c.id}:${c.status}`).join(',');

  useEffect(() => {
    if (!key) return;
    let alive = true;
    const list = key.split(',').map((s) => {
      const [id, status] = s.split(':');
      return { id, status: status as CardSummary['status'] };
    });
    void loadCardEvaluations(list).then((e) => alive && setEvals(e));
    return () => {
      alive = false;
    };
  }, [key]);

  return evals;
}
