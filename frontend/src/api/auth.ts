import { BUILT_IN_ROLES } from '../domain/roles';
import type { Role, User } from '../domain/types';
import { describeError } from './errors';
import { apiFetch } from './http';

/*
 * Вход и выход через бэкенд.
 *   POST /api/auth/login {"username","password"} → UserInfoDto в теле + httpOnly-кука AUTH_TOKEN
 *   GET  /api/auth/logout → кука удаляется, токен отзывается
 * Типы повторяют DTO бэкенда (UUID приходят строками).
 */

export interface DepartmentDto {
  id: string;
  code: string;
  name: string;
}

export interface StudyGroupDto {
  id: string;
  name: string;
  teacherId: string;
}

export interface UserInfoDto {
  id: string;
  username: string;
  fullName: string;
  role: string;
  permissions: string[];
  department?: DepartmentDto | null;
  studyGroups?: StudyGroupDto[];
}

export async function loginRequest(username: string, password: string): Promise<UserInfoDto> {
  try {
    return await apiFetch<UserInfoDto>('/auth/login', { method: 'POST', body: { username, password }, skipAuthRedirect: true });
  } catch (e) {
    throw new Error(describeError(e, 'Ошибка входа'), { cause: e });
  }
}

/** Выход: сервер отзывает токен и удаляет куку. Ошибку не показываем — локальная сессия сбрасывается в любом случае. */
export async function logoutRequest(): Promise<void> {
  try {
    await apiFetch<void>('/auth/logout', { skipAuthRedirect: true });
  } catch {
    // токен уже недействителен или сервер недоступен
  }
}

/** Права администратора с бэкенда */
export const BACKEND_PERMISSIONS = {
  editUsers: 'ADMIN_CAN_EDIT_USERS',
  editAdmins: 'ADMIN_CAN_EDIT_ADMINS',
  readUsers: 'ADMIN_CAN_READ_USERINFO',
} as const;

/*
 * Роль с бэка → раздел интерфейса. У бэка роль называется, например, ROLE_ADMIN.
 * Точный список ролей (таблица iam.roles) нужно сверить с бэкендером.
 */
const ROLE_MAP: Record<string, string> = {
  SUPERADMIN: 'superadmin',
  SUPER_ADMIN: 'superadmin',
  ADMIN: 'superadmin',
  TEACHER: 'teacher',
  INSTRUCTOR: 'teacher',
  STUDENT: 'student',
  TRAINEE: 'student',
};

export function roleIdFor(backendRole: string): string {
  const code = backendRole.trim().toUpperCase().replace(/^ROLE_/, '');
  if (ROLE_MAP[code]) return ROLE_MAP[code];
  if (code.includes('ADMIN')) return 'superadmin';
  if (code.includes('TEACH')) return 'teacher';
  return 'student';
}

export function toUser(u: UserInfoDto): User {
  return {
    id: u.id,
    login: u.username,
    fullName: u.fullName,
    roleId: roleIdFor(u.role),
    blocked: false,
    createdAt: '',
    groupId: u.studyGroups?.[0]?.id,
    serviceId: u.department?.code,
  };
}

export function toRole(u: UserInfoDto): Role {
  const template = BUILT_IN_ROLES.find((r) => r.id === roleIdFor(u.role)) ?? BUILT_IN_ROLES[BUILT_IN_ROLES.length - 1];
  return { ...template };
}
