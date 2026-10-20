import type { Scenario } from '../domain/types';
import { apiFetch, apiFetchOptional } from './http';
import type { PageResponse } from './admin';

/*
 * Сценарии (ScenarioController, ветка mvp репозитория бэка — в main ещё не слита).
 *   POST   /api/scenarios/create   → 201 { scenarioId }
 *   POST   /api/scenarios/update
 *   POST   /api/scenarios/{id}/approve
 *   POST   /api/scenarios/{id}/status { status: 'ARCHIVED' | 'DRAFT' }  (утверждение — только approve)
 *   DELETE /api/scenarios/{id}
 *   GET    /api/scenarios/{id}
 *   GET    /api/scenarios?categoryId=&complexity=&status=&search=&page=&size=
 *   GET    /api/scenarios/categories
 * Право TEACHER_CAN_EDIT_SCENARIOS. Ошибки — {"errorMessage"} со статусом 400.
 *
 * Бэкенд хранит три поля свободной формы (JSON): callerProfile, incidentFacts и referenceCard.
 * Фронт кладёт в них свою модель сценария целиком, поэтому ничего не теряется:
 *   callerProfile  — заявитель и телефоны,
 *   incidentFacts  — карточка происшествия (шаблон),
 *   referenceCard  — эталон, ответ руководителя, вводные, навыки, демонстрация.
 */

export type BackendComplexity = 'LOW' | 'MEDIUM' | 'HARD';
export type BackendStatus = 'DRAFT' | 'APPROVED' | 'ARCHIVED';

export interface IncidentCategory {
  id: number;
  code: string;
  name: string;
}

export interface ScenarioRow {
  id: string;
  categoryId: number | null;
  categoryName: string | null;
  title: string;
  complexity: BackendComplexity;
  timeLimitSeconds: number | null;
  status: BackendStatus;
  createdByName: string | null;
  createdAt: string;
}

export interface ScenarioDetails extends ScenarioRow {
  category: IncidentCategory | null;
  prompt: string;
  callerProfile: Record<string, unknown> | null;
  incidentFacts: Record<string, unknown> | null;
  referenceCard: Record<string, unknown> | null;
  createdById: string | null;
  updatedAt: string | null;
}

export interface ScenarioBody {
  categoryId: number | null;
  title: string;
  complexity: BackendComplexity;
  timeLimitSeconds: number;
  prompt: string;
  callerProfile: Record<string, unknown>;
  incidentFacts: Record<string, unknown>;
  referenceCard: Record<string, unknown>;
}

export const SCENARIOS_PAGE_SIZE = 20;

export interface ScenarioQuery {
  status?: BackendStatus;
  categoryId?: number;
  complexity?: BackendComplexity;
  search?: string;
  page?: number;
  size?: number;
}

export function listScenarios(q: ScenarioQuery = {}) {
  const p = new URLSearchParams();
  if (q.status) p.set('status', q.status);
  if (q.categoryId != null) p.set('categoryId', String(q.categoryId));
  if (q.complexity) p.set('complexity', q.complexity);
  if (q.search) p.set('search', q.search);
  p.set('page', String(q.page ?? 0));
  p.set('size', String(q.size ?? SCENARIOS_PAGE_SIZE));
  return apiFetchOptional<PageResponse<ScenarioRow>>(`/scenarios?${p}`);
}

export const getScenario = (id: string) => apiFetch<ScenarioDetails>(`/scenarios/${id}`);
export const createScenarioOnServer = (body: ScenarioBody) => apiFetch<{ scenarioId: string }>('/scenarios/create', { method: 'POST', body });
export const updateScenarioOnServer = (scenarioId: string, body: ScenarioBody) => apiFetch<void>('/scenarios/update', { method: 'POST', body: { scenarioId, ...body } });
export const approveScenarioOnServer = (id: string) => apiFetch<void>(`/scenarios/${id}/approve`, { method: 'POST' });
export const setScenarioStatusOnServer = (id: string, status: Exclude<BackendStatus, 'APPROVED'>) =>
  apiFetch<void>(`/scenarios/${id}/status`, { method: 'POST', body: { status } });
export const deleteScenarioOnServer = (id: string) => apiFetch<void>(`/scenarios/${id}`, { method: 'DELETE' });
export const listCategories = () => apiFetchOptional<IncidentCategory[]>('/scenarios/categories');

/** Сценарий хранится на сервере (id — UUID); у локальных и встроенных id вида «sc-…» */
export const isServerScenarioId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/** Право преподавателя на работу с банком сценариев */
export const PERMISSION_EDIT_SCENARIOS = 'TEACHER_CAN_EDIT_SCENARIOS';

const COMPLEXITY: Record<1 | 2 | 3, BackendComplexity> = { 1: 'LOW', 2: 'MEDIUM', 3: 'HARD' };
const DIFFICULTY: Record<BackendComplexity, 1 | 2 | 3> = { LOW: 1, MEDIUM: 2, HARD: 3 };
const STATUS_TO_BACKEND: Record<Scenario['status'], BackendStatus> = { draft: 'DRAFT', approved: 'APPROVED', archived: 'ARCHIVED' };
const STATUS_FROM_BACKEND: Record<BackendStatus, Scenario['status']> = { DRAFT: 'draft', APPROVED: 'approved', ARCHIVED: 'archived' };

export const toBackendStatus = (s: Scenario['status']) => STATUS_TO_BACKEND[s];
export const fromBackendStatus = (s: BackendStatus) => STATUS_FROM_BACKEND[s];

/** Норматив на карточку по умолчанию (Памятка): преподаватель может задать свой */
export const DEFAULT_TIME_LIMIT = 180;

/** Пол заявителя по отчеству: бэкенд требует это поле в callerProfile */
function genderOf(name: string): 'female' | 'male' | 'unknown' {
  const clean = name.trim();
  if (!clean) return 'unknown';
  if (/(овна|евна|ична|инична)$/i.test(clean)) return 'female';
  if (/(ович|евич|ич)$/i.test(clean)) return 'male';
  // отчества нет — смотрим на фамилию и имя
  const [surname = '', first = ''] = clean.split(/\s+/);
  if (/(ова|ева|ина|ская|цкая)$/i.test(surname) || /[ая]$/i.test(first)) return 'female';
  if (/(ов|ев|ин|ский|цкий)$/i.test(surname) || first) return 'male';
  return 'unknown';
}

/** Состояние заявителя: пока выводим из сложности сценария */
const EMOTION: Record<1 | 2 | 3, string> = { 1: 'спокойный', 2: 'взволнованный', 3: 'паника' };

/** Сценарий фронта → тело запроса бэкенда */
export function toBody(sc: Scenario, categoryId: number | null): ScenarioBody {
  const { incident, expected, ...rest } = sc;
  return {
    categoryId,
    title: sc.title,
    complexity: COMPLEXITY[sc.difficulty],
    timeLimitSeconds: sc.timeLimitSec && sc.timeLimitSec > 0 ? Math.round(sc.timeLimitSec) : DEFAULT_TIME_LIMIT,
    // текст для ИИ-заявителя: первая запись описания, иначе название
    prompt: incident.descriptions[0]?.text?.trim() || sc.title,
    // gender и emotional_state обязательны — бэкенд проверяет их наличие
    callerProfile: {
      gender: genderOf(incident.applicant.name ?? ''),
      emotional_state: EMOTION[sc.difficulty],
      applicant: incident.applicant,
      phones: incident.phones,
      chiefReply: sc.chiefReply,
    },
    incidentFacts: { incident },
    // всё остальное — чтобы сценарий возвращался с сервера без потерь
    referenceCard: { expected, scenario: rest },
  };
}

/** Ответ бэкенда → сценарий фронта (то, что было положено в referenceCard) */
export function fromDetails(d: ScenarioDetails): Scenario {
  const ref = (d.referenceCard ?? {}) as { expected?: Scenario['expected']; scenario?: Partial<Scenario> };
  const facts = (d.incidentFacts ?? {}) as { incident?: Scenario['incident'] };
  const caller = (d.callerProfile ?? {}) as { chiefReply?: unknown };
  const base = (ref.scenario ?? {}) as Partial<Scenario>;
  return {
    ...(base as Scenario),
    // сценарий, созданный не фронтом (e2e, другие клиенты), может прийти без этих полей
    station: base.station ?? 'dds',
    serviceKind: base.serviceKind ?? 'uprava',
    skills: base.skills ?? [],
    inputs: base.inputs ?? [],
    origin: base.origin ?? 'teacher',
    chiefReply: base.chiefReply ?? (typeof caller.chiefReply === 'string' ? caller.chiefReply : ''),
    id: d.id,
    title: d.title,
    difficulty: DIFFICULTY[d.complexity] ?? 1,
    timeLimitSec: d.timeLimitSeconds ?? base.timeLimitSec ?? DEFAULT_TIME_LIMIT,
    status: fromBackendStatus(d.status),
    category: d.categoryName ?? base.category ?? '',
    createdAt: d.createdAt,
    authorId: d.createdById ?? base.authorId ?? '',
    incident: facts.incident ?? (base.incident as Scenario['incident']),
    expected: ref.expected ?? (base.expected as Scenario['expected']),
  };
}

/**
 * Сценарий с сервера, на котором можно тренироваться: утверждён и содержит карточку происшествия
 * и эталон в модели фронта. Иначе — null (эмулятор упадёт на неполной карточке).
 */
export function playableFromDetails(d: ScenarioDetails): Scenario | null {
  if (d.status !== 'APPROVED') return null;
  const sc = fromDetails(d);
  const inc = sc.incident as Partial<Scenario['incident']> | undefined;
  const exp = sc.expected as Partial<Scenario['expected']> | undefined;
  const ok =
    !!inc?.address &&
    !!inc.type &&
    Array.isArray(inc.descriptions) &&
    Array.isArray(inc.services) &&
    Array.isArray(exp?.path) &&
    exp.path.length > 0 &&
    Array.isArray(exp.commentMustMention) &&
    Array.isArray(exp.reportMustMention);
  return ok ? sc : null;
}
