import { ApiError } from '../../api/http';
import { playableFromDetails, getScenario, type ScenarioDetails } from '../../api/scenarios';
import { getSession, listSessions } from '../../api/sessions';
import type { Scenario } from '../../domain/types';

/*
 * Сценарии с сервера для самостоятельной тренировки. Список банка (GET /api/scenarios) обучающемуся
 * закрыт — он только у преподавателя, поэтому берём утверждённые сценарии из занятий своей группы:
 * занятия группы → их сценарии → каждый сценарий (APPROVED читает любой вошедший).
 *
 * Сценарий старого занятия могли снять с занятий (архив, черновик, удаление) — тогда бэкенд отвечает 400,
 * а браузер пишет отказ в консоль, и перехватом это не убрать. Поэтому такие id запоминаем (WithdrawnMarks)
 * и сутки не запрашиваем. Раньше — только если сценарий попал в занятие, начатое после отказа:
 * занятие стартует лишь с утверждёнными сценариями, значит его вернули.
 */

export interface GroupScenariosApi {
  listSessions: (q: { studyGroupId: string; page: number; size: number }) => Promise<{ content: { id: string; startedAt?: string }[]; totalPages: number } | null>;
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

/** id сценария → когда (мс) бэкенд отказал его выдать */
export type WithdrawnMarks = Record<string, number>;

export interface WithdrawnStore {
  load: () => WithdrawnMarks;
  save: (marks: WithdrawnMarks) => void;
}

// сценарий могут вернуть в банк — через сутки спросим снова
export const WITHDRAWN_TTL_MS = 24 * 60 * 60 * 1000;

const KEY = 'dds-trainer-withdrawn-scenarios-v1';

const localWithdrawn: WithdrawnStore = {
  load: () => {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as WithdrawnMarks) : {};
    } catch {
      return {};
    }
  },
  save: (marks) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(marks));
    } catch {
      // хранилище недоступно — в следующий раз просто спросим снова
    }
  },
};

/** Снят ли сценарий с занятий: отказ был меньше суток назад и после него сценарий не попадал в новое занятие. */
export function knownWithdrawn(marks: WithdrawnMarks, id: string, lastSessionStart: number, now: number): boolean {
  const at = marks[id];
  return at !== undefined && now - at < WITHDRAWN_TTL_MS && lastSessionStart <= at;
}

export async function fetchGroupScenarios(groupId: string, api: GroupScenariosApi = API, withdrawn: WithdrawnStore = localWithdrawn, now = Date.now()): Promise<Scenario[]> {
  const sessions: { id: string; startedAt?: string }[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await api.listSessions({ studyGroupId: groupId, page, size: PAGE_SIZE });
    if (!res) break;
    sessions.push(...res.content);
    if (page + 1 >= res.totalPages || !res.content.length) break;
  }
  // из занятия берём только scenarioIds: в ответе getSession есть свой startedAt (ISO-строка), он не нужен
  const details = await inBatches(sessions, async (s) => {
    const { scenarioIds } = await api.getSession(s.id);
    return { startedAt: Date.parse(s.startedAt ?? '') || 0, scenarioIds };
  });
  // для каждого сценария — когда началось самое свежее занятие с ним
  const lastStart = new Map<string, number>();
  for (const r of details) {
    if (r.status !== 'fulfilled') continue;
    for (const id of r.value.scenarioIds ?? []) lastStart.set(id, Math.max(lastStart.get(id) ?? 0, r.value.startedAt));
  }

  const marks = withdrawn.load();
  const ids = [...lastStart.keys()].filter((id) => !knownWithdrawn(marks, id, lastStart.get(id)!, now));
  const results = await inBatches(ids, (id) => api.getScenario(id));

  // 400 — сценарий снят с занятий; сеть, 5xx и прочее не запоминаем, иначе временный сбой спрячет сценарий
  const next: WithdrawnMarks = Object.fromEntries(Object.entries(marks).filter(([, at]) => now - at < WITHDRAWN_TTL_MS));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') delete next[ids[i]];
    else if (r.reason instanceof ApiError && r.reason.status === 400) next[ids[i]] = now;
  });
  withdrawn.save(next);

  return results.flatMap((r) => {
    const sc = r.status === 'fulfilled' ? playableFromDetails(r.value) : null;
    return sc ? [sc] : [];
  });
}
