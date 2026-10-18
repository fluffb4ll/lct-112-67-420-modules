import type { CardStatusBackend, Evaluation } from '../../api/sessions';
import { cardStatusBadge } from '../../training/serverScore';
import { Badge } from '../../ui';

/** Статус карточки в списке: оценена / ждёт оценки / оценка ИИ недоступна */
export function CardBadge({ status, ev }: { status: CardStatusBackend; ev?: Evaluation | null }) {
  const b = cardStatusBadge(status, ev);
  return <Badge tone={b.tone}>{b.text}</Badge>;
}
