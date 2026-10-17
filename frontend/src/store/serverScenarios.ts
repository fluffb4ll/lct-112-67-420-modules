import { create } from 'zustand';
import { getDb, useDb } from '../api/db';
import type { Scenario } from '../domain/types';

/*
 * Сценарии с сервера для самостоятельной тренировки — отдельно от локальных данных: каждая загрузка
 * заменяет набор целиком, поэтому архивированный или снятый с занятий сценарий пропадает, а не
 * остаётся в общей БД навсегда. Свой ключ в localStorage — чтобы история попыток показывала названия
 * и после перезагрузки, пока сервер не ответил.
 */

const KEY = 'dds-trainer-server-scenarios-v1';

interface ServerScenarios {
  groupId: string | null;
  scenarios: Scenario[];
}

function load(): ServerScenarios {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as ServerScenarios;
  } catch {
    // нет localStorage (тесты) или испорченные данные — начинаем с пустого
  }
  return { groupId: null, scenarios: [] };
}

export const useServerScenarioStore = create<ServerScenarios>(load);

export function setServerScenarios(groupId: string, scenarios: Scenario[]) {
  const next = { groupId, scenarios };
  useServerScenarioStore.setState(next, true);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // без localStorage живём в памяти
  }
}

/** Локальные сценарии плюс серверные; при совпадении id — серверная версия, она свежее. */
export function withServerScenarios(local: Scenario[], server: Scenario[]): Scenario[] {
  if (!server.length) return local;
  const ids = new Set(server.map((s) => s.id));
  return [...server, ...local.filter((s) => !ids.has(s.id))];
}

/** Все сценарии, доступные тренажёру, — вне React (стор тренировки). */
export const allScenarios = () => withServerScenarios(getDb().scenarios, useServerScenarioStore.getState().scenarios);

/** То же в компоненте: перерисовка при изменении любой из частей. */
export function useAllScenarios(): Scenario[] {
  const local = useDb((s) => s.db.scenarios);
  const server = useServerScenarioStore((s) => s.scenarios);
  return withServerScenarios(local, server);
}
