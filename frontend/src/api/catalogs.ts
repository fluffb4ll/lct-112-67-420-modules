import type { PageResponse } from './admin';
import { apiFetch, apiFetchOptional } from './http';

/*
 * Справочники и служебные журналы (репозиторий lct-112-67-420-modules, папка backend).
 *   GET    /api/incidentCategories          — типы (категории) происшествий
 *   POST   /api/incidentCategories          { code, name }      — добавить
 *   POST   /api/incidentCategories/update   { id, code, name }  — изменить
 *   DELETE /api/incidentCategories/{id}                         — удалить
 *   GET    /api/admin/incidents?severity=&component=&page=&size= — журнал системных сбоев
 * Правка справочника требует права ADMIN_CAN_EDIT_USERS.
 */

export interface IncidentCategory {
  id: number;
  code: string;
  name: string;
}

export const listIncidentCategories = () => apiFetchOptional<IncidentCategory[]>('/incidentCategories');
export const createIncidentCategory = (code: string, name: string) => apiFetch<IncidentCategory>('/incidentCategories', { method: 'POST', body: { code, name } });
export const updateIncidentCategory = (id: number, code: string, name: string) => apiFetch<IncidentCategory>('/incidentCategories/update', { method: 'POST', body: { id, code, name } });
export const deleteIncidentCategory = (id: number) => apiFetch<void>(`/incidentCategories/${id}`, { method: 'DELETE' });

export type IncidentSeverity = 'WARN' | 'ERROR' | 'FATAL';
export type IncidentComponent = 'ASTERISK' | 'AI' | 'DB' | 'HTTP';

export interface SystemIncident {
  id: number;
  severity: IncidentSeverity;
  component: IncidentComponent;
  message: string;
  stackTrace: string | null;
  createdAt: string;
}

export const SEVERITY_LABELS: Record<IncidentSeverity, string> = { WARN: 'предупреждение', ERROR: 'ошибка', FATAL: 'сбой' };
export const COMPONENT_LABELS: Record<IncidentComponent, string> = { ASTERISK: 'телефония', AI: 'ИИ-сервис', DB: 'база данных', HTTP: 'веб-сервер' };

export function listSystemIncidents(q: { severity?: IncidentSeverity; component?: IncidentComponent; page?: number; size?: number } = {}) {
  const p = new URLSearchParams();
  if (q.severity) p.set('severity', q.severity);
  if (q.component) p.set('component', q.component);
  p.set('page', String(q.page ?? 0));
  p.set('size', String(q.size ?? 20));
  return apiFetchOptional<PageResponse<SystemIncident>>(`/admin/incidents?${p}`);
}
