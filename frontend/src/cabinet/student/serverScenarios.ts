import { playableFromDetails, getScenario, type ScenarioDetails } from '../../api/scenarios';
import { getSession, listSessions } from '../../api/sessions';
import type { Scenario } from '../../domain/types';

/*
 * Сценарии с сервера для самостоятельной тренировки. Список банка (GET /api/scenarios) обучающемуся
 * закрыт — он только у преподавателя, поэтому берём утверждённые сценарии из занятий своей группы:
 * занятия группы → их сценарии → каждый сценарий (APPROVED читает любой вошедший).
 */

export interface GroupScenariosApi {
  listSessions: (q: { studyGroupId: string; size: number }) => Promise<{ content: { id: string }[] } | null>;
  getSession: (id: string) => Promise<{ scenarioIds: string[] }>;
  getScenario: (id: string) => Promise<ScenarioDetails>;
}

const API: GroupScenariosApi = { listSessions, getSession, getScenario };

// сценарии запрашиваются по одному — ограничиваем объём
export const MAX_SESSIONS = 10;
export const MAX_SCENARIOS = 30;

export async function fetchGroupScenarios(groupId: string, api: GroupScenariosApi = API): Promise<Scenario[]> {
  const page = await api.listSessions({ studyGroupId: groupId, size: MAX_SESSIONS });
  if (!page) return [];
  const sessions = await Promise.allSettled(page.content.map((s) => api.getSession(s.id)));
  const ids = [...new Set(sessions.flatMap((r) => (r.status === 'fulfilled' ? r.value.scenarioIds : [])))].slice(0, MAX_SCENARIOS);
  const details = await Promise.allSettled(ids.map((id) => api.getScenario(id)));
  return details.flatMap((r) => {
    const sc = r.status === 'fulfilled' ? playableFromDetails(r.value) : null;
    return sc ? [sc] : [];
  });
}
