import type { ScenarioOrigin, ScenarioStatus } from '../../domain/types';

export const STATUS_LABELS: Record<ScenarioStatus, string> = {
  draft: 'Черновик',
  approved: 'Утверждён',
  archived: 'Архив',
};

export const ORIGIN_LABELS: Record<ScenarioOrigin, string> = {
  dataset: 'Методические материалы',
  generated: 'Сгенерирован ИИ',
  teacher: 'Создан преподавателем',
  student: 'Карточка обучающегося',
};
