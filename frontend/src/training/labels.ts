import type { TrainingMode } from '../domain/types';

export const MODE_LABELS: Record<TrainingMode, string> = {
  demo: '«Делай как я»',
  practice: 'Обучение',
  exam: 'Аттестация',
};

export const MODE_DESCRIPTIONS: Record<TrainingMode, string> = {
  demo: 'Повторение действий преподавателя по шагам с подсветкой элементов интерфейса',
  practice: 'Самостоятельная отработка с подсказками ИИ по ходу',
  exam: 'Без подсказок, оценка идёт в зачёт',
};
