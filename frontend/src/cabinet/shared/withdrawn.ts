import { describeError } from '../../api/errors';
import { ApiError } from '../../api/http';
import type { ServerScenariosStatus } from '../../store/serverScenarios';

/*
 * Сценарий сняли с занятий (архив, возврат в черновики, удаление): обучающемуся бэкенд его больше
 * не отдаёт (GET /api/scenarios/{id} → 400), а серверный набор сценариев он покидает при обновлении.
 * Попытки по нему остаются в истории — вместо названия показываем эту подпись, а не голый id.
 */

export const WITHDRAWN_LABEL = 'сценарий снят с занятий';

/**
 * Сценария попытки нет в наборе. «Снят с занятий» — только если набор с сервера загружен в этой вкладке;
 * пока грузится или загрузка сорвалась (а у преподавателя её нет вовсе) — утверждать это нельзя.
 */
export function isWithdrawn(sc: unknown, status: ServerScenariosStatus): boolean {
  return !sc && status === 'ok';
}

/** Название сценария попытки или подпись вместо него, если сценария в наборе нет. */
export function scenarioTitle(sc: { title: string } | undefined, status: ServerScenariosStatus): string {
  if (sc) return sc.title;
  if (status === 'ok') return WITHDRAWN_LABEL;
  return status === 'loading' ? 'загрузка…' : 'сценарий недоступен';
}

/** Почему не открылась карточка занятия: 400 на сценарий — его сняли с занятий уже после выдачи. */
export function takeCardError(e: unknown): string {
  if (e instanceof ApiError && e.status === 400) return 'Сценарий снят с занятий — карточку открыть нельзя';
  return describeError(e, 'Не удалось открыть карточку');
}
