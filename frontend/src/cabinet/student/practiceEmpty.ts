import type { ServerScenariosStatus } from '../../store/serverScenarios';

/**
 * Почему в самостоятельной тренировке нет карточек. «Назначит преподаватель» — только когда набор
 * группы с сервера загружен и пуст; пока грузится или загрузка сорвалась, утверждать это нельзя.
 * Без серверного пользователя или без группы грузить нечего — пояснение сразу.
 */
export function emptyPracticeText(loadsFromServer: boolean, status: ServerScenariosStatus): string {
  if (loadsFromServer && (status === 'idle' || status === 'loading')) return 'Загружаем карточки…';
  if (loadsFromServer && status === 'failed') return 'Не удалось загрузить карточки, обновите страницу.';
  return 'Карточек для тренировки пока нет: они появятся, когда преподаватель назначит занятия вашей группе.';
}
