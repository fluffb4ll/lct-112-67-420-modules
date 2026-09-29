import type { PageResponse } from './admin';
import type { UserInfoDto } from './auth';
import { apiFetch, apiFetchOptional } from './http';

/*
 * Учебные группы (StudyGroupController, ветка mvp репозитория бэка — в main ещё не слита).
 *   POST   /api/studyGroups/create  { name, teacherId }             → 201 { studyGroupId }
 *   POST   /api/studyGroups/update  { groupId, name?, teacherId? }  → 200
 *   DELETE /api/studyGroups/{id}                                    → 204
 *   GET    /api/studyGroups/{id}                                    → { id, name, users: [] }
 *   GET    /api/studyGroups?page=0&size=20                          → страница групп
 *   POST   /api/studyGroups/{id}/members             { studentId }  → зачислить
 *   DELETE /api/studyGroups/{id}/members/{studentId}                → отчислить
 * Всё под правом ADMIN_CAN_EDIT_GROUPS (раньше называлось TEACHER_CAN_EDIT_GROUPS).
 */

export interface StudyGroupRow {
  id: string;
  name: string;
  teacher: { id: string; fullName: string } | null;
}

export interface StudyGroupInfo {
  id: string;
  name: string;
  users: UserInfoDto[];
}

export const GROUPS_PAGE_SIZE = 20;

export const createStudyGroup = (name: string, teacherId: string) =>
  apiFetch<{ studyGroupId: string }>('/studyGroups/create', { method: 'POST', body: { name, teacherId } });

export const updateStudyGroup = (req: { groupId: string; name?: string; teacherId?: string }) => apiFetch<void>('/studyGroups/update', { method: 'POST', body: req });

export const deleteStudyGroup = (groupId: string) => apiFetch<void>(`/studyGroups/${groupId}`, { method: 'DELETE' });

export const getStudyGroup = (groupId: string) => apiFetch<StudyGroupInfo>(`/studyGroups/${groupId}`);

export const listStudyGroups = (page = 0, size = GROUPS_PAGE_SIZE) => apiFetchOptional<PageResponse<StudyGroupRow>>(`/studyGroups?page=${page}&size=${size}`);

export const addGroupMember = (groupId: string, studentId: string) => apiFetch<void>(`/studyGroups/${groupId}/members`, { method: 'POST', body: { studentId } });

export const removeGroupMember = (groupId: string, studentId: string) => apiFetch<void>(`/studyGroups/${groupId}/members/${studentId}`, { method: 'DELETE' });

/** Право на создание, изменение групп и на зачисление в них */
export const PERMISSION_EDIT_GROUPS = 'ADMIN_CAN_EDIT_GROUPS';
