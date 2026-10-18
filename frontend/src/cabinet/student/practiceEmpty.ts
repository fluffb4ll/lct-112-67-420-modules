import type { ServerScenariosStatus } from '../../store/serverScenarios';

/**
 * Почему в самостоятельной тренировке нет карточек. «Назначит преподаватель» — только когда набор
 * именно этой группы загружен с сервера и пуст; пока грузится (или в сторе ещё набор прежней группы)
 * и когда загрузка сорвалась, утверждать это нельзя. Без серверной группы грузить нечего — пояснение сразу.
 */
export function emptyPracticeText(groupId: string | undefined, status: ServerScenariosStatus, loadedGroupId: string | null): string {
  if (groupId && status === 'failed') return 'Не удалось загрузить карточки, обновите страницу.';
  if (groupId && (status !== 'ok' || loadedGroupId !== groupId)) return 'Загружаем карточки…';
  return 'Карточек для тренировки пока нет: они появятся, когда преподаватель назначит занятия вашей группе.';
}
