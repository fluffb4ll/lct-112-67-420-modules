import type { ComposeResult } from '../../api/ai';
import type { ScenarioOrigin } from '../../domain/types';

/** Пометка сгенерированного сценария: «Сгенерирован ИИ» — только если текст написала языковая модель */
export const composedOrigin = (r: ComposeResult | null): ScenarioOrigin => (r?.by === 'llm' ? 'generated' : 'template');

/**
 * Хвост сообщения после генерации: сколько сценариев остались с текстом шаблона и почему.
 * limited — из них отказано по лимиту частоты (429): такие стоит повторить через минуту.
 */
export function composeNote(byTemplate: number, limited: number): string {
  if (!byTemplate) return ', текст написан ИИ';
  if (!limited) return ` (для ${byTemplate} ИИ-контур не ответил — текст из шаблона классификатора)`;
  const rest = byTemplate - limited;
  return (
    ` (для ${byTemplate} текст из шаблона классификатора: ` +
    (rest ? `для ${limited} превышен лимит запросов к ИИ-контуру, для ${rest} контур не ответил` : 'превышен лимит запросов к ИИ-контуру') +
    ' — подождите минуту и сгенерируйте их заново)'
  );
}
