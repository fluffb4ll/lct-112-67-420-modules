import { composeFallbackReason, isAiRateLimited, type ComposeResult } from '../../api/ai';
import type { Scenario, ScenarioOrigin } from '../../domain/types';

/** Пометка сгенерированного сценария: «Сгенерирован ИИ» — только если текст написала языковая модель */
export const composedOrigin = (r: ComposeResult | null): ScenarioOrigin => (r?.by === 'llm' ? 'generated' : 'template');

export interface GenerateOutcome {
  saved: number;
  failed: number;
  /** сохранены с текстом шаблона: ИИ-контур не ответил */
  byTemplate: number;
  /** ИИ-контур отказал по лимиту частоты (429) — генерация остановлена, остальные не запрошены */
  stoppedByLimit: boolean;
  /** почему текст остался шаблонным — из ответа контура, по первой такой карточке */
  why?: string;
  /** модель, которая написала текст: её имя приходит в ответе контура */
  model?: string;
}

/**
 * Пишет текст черновиков в ИИ-контуре и сохраняет их по одному. Контур не ответил — сохраняем
 * с текстом шаблона. Лимит частоты (429) — останавливаемся: следующие запросы тоже получат отказ,
 * а сценарии с шаблонным текстом вместо ИИ преподавателю не нужны.
 */
export async function composeAndSave(
  drafts: Scenario[],
  step: {
    compose: (draft: Scenario, i: number) => Promise<ComposeResult>;
    save: (sc: Scenario) => Promise<void>;
    /** окно закрыли — оставшиеся не пишем и не сохраняем */
    closed: () => boolean;
    onProgress?: (i: number) => void;
    onSaveError?: (e: unknown) => void;
  },
): Promise<GenerateOutcome> {
  const out: GenerateOutcome = { saved: 0, failed: 0, byTemplate: 0, stoppedByLimit: false };
  for (const [i, draft] of drafts.entries()) {
    if (step.closed()) break;
    step.onProgress?.(i);
    let sc: Scenario;
    const started = Date.now();
    try {
      const r = await step.compose(draft, i);
      if (r.by !== 'llm') {
        out.byTemplate++;
        // причину берём из самого ответа: модели нет, не успела или текст не прошёл проверку
        out.why ??= composeFallbackReason(r, (Date.now() - started) / 1000);
      } else {
        out.model ??= r.model?.model_name || undefined;
      }
      sc = { ...r.scenario, origin: composedOrigin(r) };
    } catch (e) {
      if (isAiRateLimited(e)) {
        out.stoppedByLimit = true;
        break;
      }
      out.byTemplate++;
      out.why ??= e instanceof Error ? e.message : 'ИИ-контур недоступен';
      sc = { ...draft, origin: composedOrigin(null) };
    }
    if (step.closed()) break;
    try {
      await step.save(sc);
      out.saved++;
    } catch (e) {
      out.failed++;
      step.onSaveError?.(e);
    }
  }
  return out;
}

/** Сообщение в банке после генерации: сколько сохранено, где текст шаблона, почему остановились. */
export function generateMessage(o: GenerateOutcome, total: number): { tone: 'ok' | 'bad'; text: string } {
  const template = o.byTemplate ? ` (для ${o.byTemplate} ИИ-контур не ответил — текст из шаблона классификатора)` : '';
  const why = o.byTemplate && o.why ? ` Причина: ${o.why}.` : '';
  if (o.stoppedByLimit)
    return {
      tone: 'bad',
      text:
        `Превышен лимит запросов к ИИ-контуру — генерация остановлена. Сохранено черновиков: ${o.saved} из ${total}${template}` +
        (o.failed ? `, не удалось сохранить: ${o.failed}` : '') +
        `. Подождите минуту и сгенерируйте оставшиеся.` + why,
    };
  if (o.failed) return { tone: 'bad', text: `Сохранено черновиков: ${o.saved}. Не удалось сохранить: ${o.failed}.` };
  return {
    tone: 'ok',
    text:
      `Сгенерировано черновиков: ${o.saved}` +
      (template || (o.model ? `, текст написала модель ${o.model}` : ', текст написан ИИ')) +
      '. Проверьте эталон и утвердите — после этого сценарии попадут в общий банк.' +
      why,
  };
}

/**
 * Сообщения банка: ошибка загрузки списка и итог генерации — порознь. Перезагрузка списка после генерации
 * (onDone → reload) меняет только первое: итог генерации, в том числе «превышен лимит», остаётся,
 * пока преподаватель его не закроет или не начнёт новую генерацию.
 */
export interface BankNotices {
  load: string | null;
  generate: { tone: 'ok' | 'bad'; text: string } | null;
}

export const noticesAfterLoad = (n: BankNotices, error: string | undefined): BankNotices => ({ ...n, load: error ?? null });
