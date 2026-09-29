import { create } from 'zustand';
import type {
  Attempt,
  AuditRecord,
  Group,
  LiveProgress,
  Role,
  Scenario,
  TeacherMessage,
  TrainingSession,
  User,
} from '../domain/types';
import { buildSeed } from '../data/seed';

/*
 * Мок-хранилище вместо бэкенда. Данные лежат в localStorage и синхронизируются между вкладками
 * (событие storage): можно открыть преподавателя и обучающегося в двух вкладках одного браузера,
 * и мониторинг занятия будет обновляться вживую.
 *
 * Для подключения реального бэкенда заменяется только слой src/api — компоненты работают
 * через функции из src/api/index.ts и селекторы useDb.
 */

export interface SystemService {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'degraded';
  version: string;
  uptimeSec: number;
}

export interface Backup {
  id: string;
  at: string;
  sizeMb: number;
  kind: 'auto' | 'manual';
}

export interface SystemConfig {
  backupTime: string;
  backupKeepDays: number;
  voipCodec: 'Opus' | 'G.711a' | 'G.722';
  voipJitterMs: number;
  voipMaxLatencyMs: number;
  logLevel: 'debug' | 'info' | 'warning' | 'error';
  auditRetentionMonths: number;
  passwordMinLength: number;
  sessionTimeoutMin: number;
  lockAfterFailed: number;
  tlsEnabled: boolean;
}

export interface SystemState {
  services: SystemService[];
  backups: Backup[];
  config: SystemConfig;
}

export interface DbShape {
  version: number;
  roles: Role[];
  /** В моке пароль хранится открыто. На сервере — только хэш (argon2). */
  users: (User & { password: string })[];
  groups: Group[];
  scenarios: Scenario[];
  sessions: TrainingSession[];
  attempts: Attempt[];
  live: LiveProgress[];
  audit: AuditRecord[];
  messages: TeacherMessage[];
  system: SystemState;
  nextIncidentId: number;
  failedLogins: Record<string, number>;
}

const KEY = 'dds-trainer-db-v1';

function load(): DbShape {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DbShape;
      if (parsed.version === 1) return parsed;
    }
  } catch {
    // хранилище недоступно или повреждено — начинаем с демо-данных
  }
  return buildSeed();
}

function save(db: DbShape) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    // в приватном режиме запись может быть запрещена — работаем в памяти
  }
}

interface DbStore {
  db: DbShape;
}

export const useDb = create<DbStore>(() => ({ db: load() }));

/** Изменение данных: функция получает копию и мутирует её */
export function mutate(fn: (d: DbShape) => void) {
  const next = structuredClone(useDb.getState().db);
  fn(next);
  useDb.setState({ db: next });
  save(next);
}

export const getDb = () => useDb.getState().db;

export function resetDb() {
  const fresh = buildSeed();
  useDb.setState({ db: fresh });
  save(fresh);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue) return;
    try {
      useDb.setState({ db: JSON.parse(e.newValue) as DbShape });
    } catch {
      // игнорируем битые данные из другой вкладки
    }
  });
}

export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
