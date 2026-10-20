import { useMemo } from 'react';
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

/**
 * Загружен ли набор с сервера в этой вкладке. Сохранённый в localStorage набор может быть устаревшим,
 * поэтому статус не сохраняется: «сценарий снят с занятий» можно утверждать только после успешной загрузки.
 */
export type ServerScenariosStatus = 'idle' | 'loading' | 'ok' | 'failed';

interface ServerScenarios {
  groupId: string | null;
  scenarios: Scenario[];
  /** сценарий карточки серверного занятия, открытой последней (ServerLesson) */
  lesson?: Scenario | null;
  status?: ServerScenariosStatus;
}

function load(): ServerScenarios {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...(JSON.parse(raw) as ServerScenarios), status: 'idle' };
  } catch {
    // нет localStorage (тесты) или испорченные данные — начинаем с пустого
  }
  return { groupId: null, scenarios: [], status: 'idle' };
}

export const useServerScenarioStore = create<ServerScenarios>(load);

function save(next: ServerScenarios) {
  useServerScenarioStore.setState(next, true);
  try {
    // статус — только для этой вкладки
    localStorage.setItem(KEY, JSON.stringify({ ...next, status: undefined }));
  } catch {
    // без localStorage живём в памяти
  }
}

export function setServerScenarios(groupId: string, scenarios: Scenario[]) {
  save({ ...useServerScenarioStore.getState(), groupId, scenarios, status: 'ok' });
}

/** Начало загрузки или сбой: набор не трогаем — тренируемся на загруженном раньше. */
export function setServerScenariosStatus(status: 'loading' | 'failed') {
  useServerScenarioStore.setState({ status });
}

export const useServerScenariosStatus = () => useServerScenarioStore((s) => s.status ?? 'idle');

/** Карточка серверного занятия: её сценарий заменяет прошлый, набор группы не трогает. */
export function setLessonScenario(sc: Scenario) {
  save({ ...useServerScenarioStore.getState(), lesson: sc });
}

const serverList = (s: ServerScenarios) => (s.lesson ? [s.lesson, ...s.scenarios.filter((x) => x.id !== s.lesson!.id)] : s.scenarios);

/** Локальные сценарии плюс серверные; при совпадении id — серверная версия, она свежее. */
export function withServerScenarios(local: Scenario[], server: Scenario[]): Scenario[] {
  if (!server.length) return local;
  const ids = new Set(server.map((s) => s.id));
  return [...server, ...local.filter((s) => !ids.has(s.id))];
}

/** Все сценарии, доступные тренажёру, — вне React (стор тренировки). */
export const allScenarios = () => withServerScenarios(getDb().scenarios, serverList(useServerScenarioStore.getState()));

/** То же в компоненте: перерисовка при изменении любой из частей. */
export function useAllScenarios(): Scenario[] {
  const local = useDb((s) => s.db.scenarios);
  const server = useServerScenarioStore((s) => s.scenarios);
  const lesson = useServerScenarioStore((s) => s.lesson);
  return useMemo(() => withServerScenarios(local, serverList({ groupId: null, scenarios: server, lesson })), [local, server, lesson]);
}
