import type { ResponseStatus, StatusEntry } from './types';

/*
 * Порядок проставления статусов реагирования на АРМ-112.
 * Источник: Памятка, стр. 25 + скриншоты учебного стенда (выпадающие списки после каждого статуса).
 * Статусы выбираются только последовательно.
 */
const NEXT: Record<ResponseStatus, ResponseStatus[]> = {
  Добавлена: ['Принята', 'Не принята'],
  'Получена службой': ['Принята', 'Не принята'],
  'Не принята': ['Принята'],
  Принята: ['Начало реагирования', 'Прибытие', 'Проведение работ', 'Работы завершены', 'Отказ от выполнения работ'],
  'Начало реагирования': ['Прибытие', 'Работы завершены', 'Отказ от выполнения работ'],
  Прибытие: ['Проведение работ', 'Работы завершены', 'Отказ от выполнения работ'],
  'Проведение работ': ['Работы завершены', 'Отказ от выполнения работ'],
  'Работы завершены': [],
  'Отказ от выполнения работ': [],
};

/** Технические статусы проставляет система, а не диспетчер */
export const TECHNICAL: ResponseStatus[] = ['Добавлена', 'Получена службой'];

export const PRIMARY: ResponseStatus[] = ['Принята', 'Не принята'];

/** После этих статусов карточка закрыта для редактирования службой */
export const TERMINAL: ResponseStatus[] = ['Работы завершены', 'Отказ от выполнения работ'];

/** Для этих статусов комментарий обязателен (Памятка, стр. 21–22, 26) */
export const COMMENT_REQUIRED: ResponseStatus[] = ['Не принята', 'Отказ от выполнения работ'];

export function currentStatus(history: StatusEntry[]): ResponseStatus {
  return history.length ? history[history.length - 1].status : 'Добавлена';
}

export function nextStatuses(history: StatusEntry[]): ResponseStatus[] {
  return NEXT[currentStatus(history)];
}

export function isClosed(history: StatusEntry[]): boolean {
  return TERMINAL.includes(currentStatus(history));
}

/** Статусы, проставленные диспетчером (без технических) */
export function dispatcherPath(history: StatusEntry[]): ResponseStatus[] {
  return history.map((h) => h.status).filter((s) => !TECHNICAL.includes(s));
}
