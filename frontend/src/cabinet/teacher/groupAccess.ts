import { listUsers, type UserTableRow } from '../../api/admin';
import { apiFetchOptional } from '../../api/http';
import type { StudyGroupRow } from '../../api/teacher';

/*
 * Кто чем управляет в учебных группах — то же правило, что на сервере:
 * администратор — всеми группами, преподаватель — только теми, где он назначен.
 */

export interface Viewer {
  id?: string;
  isAdmin: boolean;
}

/** Группа без преподавателя ничья — ей управляет только администратор */
export const isOwnGroup = (g: StudyGroupRow, viewer: Viewer) => !!viewer.id && g.teacher?.id === viewer.id;

export const canManageGroup = (g: StudyGroupRow, viewer: Viewer, canEdit: boolean) => canEdit && (viewer.isAdmin || isOwnGroup(g, viewer));

/** В каких группах можно начать занятие */
export const startableGroups = (groups: StudyGroupRow[], viewer: Viewer) => groups.filter((g) => viewer.isAdmin || isOwnGroup(g, viewer));

/** Кого можно зачислить. Старый сервер без /users/students — пробуем общий список пользователей */
export async function loadStudents(): Promise<UserTableRow[] | null> {
  const students = await apiFetchOptional<UserTableRow[]>('/users/students');
  if (students) return students;
  const all = await listUsers(0, 100);
  return all ? all.content.filter((u) => /STUDENT|ОБУЧ/i.test(u.roleName) && u.isActive) : null;
}
