import { describeError } from '../../api/errors';
import { ApiError } from '../../api/http';

/*
 * Сценарий сняли с занятий (архив, возврат в черновики, удаление): обучающемуся бэкенд его больше
 * не отдаёт (GET /api/scenarios/{id} → 400), а серверный набор сценариев он покидает при обновлении.
 * Попытки по нему остаются в истории — вместо названия показываем эту подпись, а не голый id.
 */

export const WITHDRAWN_LABEL = 'сценарий снят с занятий';

/** Название сценария попытки или подпись «сценарий снят с занятий», если его больше нет. */
export function scenarioTitle(sc: { title: string } | undefined): string {
  return sc?.title ?? WITHDRAWN_LABEL;
}

/** Почему не открылась карточка занятия: 400 на сценарий — его сняли с занятий уже после выдачи. */
export function takeCardError(e: unknown): string {
  if (e instanceof ApiError && e.status === 400) return 'Сценарий снят с занятий — карточку открыть нельзя';
  return describeError(e, 'Не удалось открыть карточку');
}
