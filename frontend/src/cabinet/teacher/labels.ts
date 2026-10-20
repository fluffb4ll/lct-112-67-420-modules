import type { ScenarioOrigin, ScenarioStatus } from '../../domain/types';

export const STATUS_LABELS: Record<ScenarioStatus, string> = {
  draft: 'Черновик',
  approved: 'Утверждён',
  archived: 'Архив',
};

/*
 * Откуда взялся текст сценария. «Текст написала модель» ставится только тогда, когда
 * ИИ-контур вернул by: 'llm', то есть действительно переписал поля заготовки.
 */
export const ORIGIN_LABELS: Record<ScenarioOrigin, string> = {
  dataset: 'Методические материалы',
  generated: 'Текст написала модель ИИ',
  template: 'Текст из заготовки классификатора',
  teacher: 'Создан преподавателем',
  student: 'Карточка обучающегося',
};
