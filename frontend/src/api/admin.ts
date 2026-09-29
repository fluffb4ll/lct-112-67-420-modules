import type { DepartmentDto, UserInfoDto } from './auth';
import { apiFetch, apiFetchOptional } from './http';

/*
 * Управление пользователями на бэкенде (UserController, ветка mvp — в main ещё не слита).
 *   POST   /api/users/create   CreateUserRequestDto → 201 {userId}
 *   POST   /api/users/update   UpdateUserRequestDto → 200
 *   DELETE /api/users/{id}                          → 200
 *   GET    /api/users/{id}                          → UserInfoDto
 *   GET    /api/users?page=0&size=20                → страница UserTableRowDto
 * Ожидаются (см. docs/backend-api.md): списки ролей и подразделений.
 * Ошибки — {"errorMessage": "..."} со статусом 401 (доступ) или 409 (данные).
 */

export interface CreateUserRequest {
  username: string;
  password: string;
  fullName: string;
  roleId: number;
  departmentId: string | null;
  mustChangePassword: boolean;
}

export interface UpdateUserRequest {
  userId: string;
  username?: string;
  password?: string;
  fullName?: string;
  roleId?: number;
  departmentId?: string;
  isActive?: boolean;
  mustChangePassword?: boolean;
}

/** Строка таблицы пользователей. Логина и последнего входа здесь нет — они в GET /admin/users/{id} */
export interface UserTableRow {
  id: string;
  fullName: string;
  roleName: string;
  departmentName: string | null;
  isActive: boolean;
}

export interface PageResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface RoleDto {
  id: number;
  name: string;
  permissions?: string[];
}

/** Id административной роли на бэкенде (ROLE_ADMIN) — на ней проверяется право ADMIN_CAN_EDIT_ADMINS */
export const ADMIN_ROLE_ID = 0;

export const TEACHER_ROLE_ID = 1;
export const STUDENT_ROLE_ID = 2;

/** Роли из таблицы iam.roles (id назвал бэкендер). Используются, пока нет GET /api/admin/roles */
export const KNOWN_ROLES: RoleDto[] = [
  { id: ADMIN_ROLE_ID, name: 'Администратор' },
  { id: TEACHER_ROLE_ID, name: 'Преподаватель' },
  { id: STUDENT_ROLE_ID, name: 'Обучающийся' },
];

export const createUser = (req: CreateUserRequest) => apiFetch<{ userId: string }>('/users/create', { method: 'POST', body: req });

// removeDepartment передаём всегда: без него бэкенд не применит departmentId
export const updateUser = (req: UpdateUserRequest, removeDepartment = false) =>
  apiFetch<void>('/users/update', { method: 'POST', body: { ...req, removeDepartment } });

export const deleteUser = (userId: string) => apiFetch<void>(`/users/${userId}`, { method: 'DELETE' });

export const getUser = (userId: string) => apiFetch<UserInfoDto>(`/users/${userId}`);

export const USERS_PAGE_SIZE = 20;

export const listUsers = (page = 0, size = USERS_PAGE_SIZE) => apiFetchOptional<PageResponse<UserTableRow>>(`/users?page=${page}&size=${size}`);
export const listRoles = () => apiFetchOptional<RoleDto[]>('/roles');
export const listDepartments = () => apiFetchOptional<DepartmentDto[]>('/departments');

/** Правила бэкенда (RegexSecurityUtil) — проверяем заранее, чтобы не гонять заведомо неверный запрос */
export const RULES = {
  username: /^[A-Za-z_.\d-]{1,16}$/,
  password: /^(?=.*[A-Za-z])(?=.*\d).{8,}$/,
  fullName: /^[A-Za-zА-Яа-я ']{1,150}$/,
};
