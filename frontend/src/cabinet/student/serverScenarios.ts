import { playableFromDetails, getScenario, type ScenarioDetails } from '../../api/scenarios';
import { getSession, listSessions } from '../../api/sessions';
import type { Scenario } from '../../domain/types';

/*
 * Сценарии с сервера для самостоятельной тренировки. Список банка (GET /api/scenarios) обучающемуся
 * закрыт — он только у преподавателя, поэтому берём утверждённые сценарии из занятий своей группы:
 * занятия группы → их сценарии → каждый сценарий (APPROVED читает любой вошедший).
 */

export interface GroupScenariosApi {
  listSessions: (q: { studyGroupId: string; page: number; size: number }) => Promise<{ content: { id: string }[]; totalPages: number } | null>;
  // из занятия нужны только id сценариев: карточки других обучающихся фронт не читает
  getSession: (id: string) => Promise<{ scenarioIds: string[] }>;
  getScenario: (id: string) => Promise<ScenarioDetails>;
}

const API: GroupScenariosApi = { listSessions, getSession, getScenario };

export const PAGE_SIZE = 50;
// предохранитель от бесконечного цикла при кривом totalPages
export const MAX_PAGES = 20;
// сценарии запрашиваются по одному — не больше стольких одновременно
export const BATCH = 10;

async function inBatches<T, R>(items: T[], fn: (x: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += BATCH) out.push(...(await Promise.allSettled(items.slice(i, i + BATCH).map(fn))));
  return out;
}

export async function fetchGroupScenarios(groupId: string, api: GroupScenariosApi = API): Promise<Scenario[]> {
  const sessionIds: string[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await api.listSessions({ studyGroupId: groupId, page, size: PAGE_SIZE });
    if (!res) break;
    sessionIds.push(...res.content.map((s) => s.id));
    if (page + 1 >= res.totalPages || !res.content.length) break;
  }
  const sessions = await inBatches(sessionIds, (id) => api.getSession(id));
  const ids = [...new Set(sessions.flatMap((r) => (r.status === 'fulfilled' ? r.value.scenarioIds : [])))];
  const details = await inBatches(ids, (id) => api.getScenario(id));
  return details.flatMap((r) => {
    const sc = r.status === 'fulfilled' ? playableFromDetails(r.value) : null;
    return sc ? [sc] : [];
  });
}
