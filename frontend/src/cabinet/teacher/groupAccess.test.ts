import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserTableRow } from '../../api/admin';
import type { StudyGroupRow } from '../../api/teacher';

const apiFetchOptional = vi.fn();
const listUsers = vi.fn();
vi.mock('../../api/http', () => ({ apiFetchOptional: (...a: unknown[]) => apiFetchOptional(...a) }));
vi.mock('../../api/admin', () => ({ listUsers: (...a: unknown[]) => listUsers(...a) }));

const { canManageGroup, isOwnGroup, loadStudents, startableGroups } = await import('./groupAccess');

const teacher = { id: 't1', isAdmin: false };
const admin = { id: 'a1', isAdmin: true };
const own: StudyGroupRow = { id: 'g1', name: 'Своя', teacher: { id: 't1', fullName: 'Я' } };
const foreign: StudyGroupRow = { id: 'g2', name: 'Чужая', teacher: { id: 't2', fullName: 'Коллега' } };
const ownerless: StudyGroupRow = { id: 'g3', name: 'Ничья', teacher: null };

const row = (id: string, roleName: string, isActive = true) => ({ id, fullName: id, roleName, isActive }) as UserTableRow;

describe('canManageGroup', () => {
  it('преподаватель управляет своей группой', () => {
    expect(canManageGroup(own, teacher, true)).toBe(true);
  });

  it('чужая и ничья группа — не преподавателю', () => {
    expect(canManageGroup(foreign, teacher, true)).toBe(false);
    expect(canManageGroup(ownerless, teacher, true)).toBe(false);
  });

  it('администратор управляет любой группой', () => {
    expect([own, foreign, ownerless].every((g) => canManageGroup(g, admin, true))).toBe(true);
  });

  it('без права правки групп — ничем', () => {
    expect(canManageGroup(own, teacher, false)).toBe(false);
    expect(canManageGroup(foreign, admin, false)).toBe(false);
  });

  it('пока профиль не загружен, ничья группа не считается своей', () => {
    expect(isOwnGroup(ownerless, { isAdmin: false })).toBe(false);
  });
});

describe('startableGroups', () => {
  it('преподавателю — только свои, чужая не выбирается по умолчанию', () => {
    expect(startableGroups([foreign, own, ownerless], teacher)).toEqual([own]);
  });

  it('преподаватель без своих групп получает пустой список', () => {
    expect(startableGroups([foreign, ownerless], teacher)).toEqual([]);
  });

  it('администратору — все', () => {
    expect(startableGroups([foreign, own, ownerless], admin)).toHaveLength(3);
  });
});

describe('loadStudents', () => {
  beforeEach(() => {
    apiFetchOptional.mockReset();
    listUsers.mockReset();
  });

  it('берёт список из /users/students и не трогает общий список пользователей', async () => {
    const students = [row('s1', 'ROLE_STUDENT')];
    apiFetchOptional.mockResolvedValue(students);

    expect(await loadStudents()).toBe(students);
    expect(apiFetchOptional).toHaveBeenCalledWith('/users/students');
    expect(listUsers).not.toHaveBeenCalled();
  });

  it('старый сервер (404) — активные обучающиеся из общего списка', async () => {
    apiFetchOptional.mockResolvedValue(null);
    listUsers.mockResolvedValue({
      content: [row('s1', 'ROLE_STUDENT'), row('t1', 'ROLE_TEACHER'), row('s2', 'ROLE_STUDENT', false), row('a1', 'ROLE_ADMIN')],
    });

    expect((await loadStudents())?.map((u) => u.id)).toEqual(['s1']);
  });

  it('старый сервер и 403 на /users — ошибка уходит вызывающему (Groups покажет «недоступен»)', async () => {
    apiFetchOptional.mockResolvedValue(null);
    listUsers.mockRejectedValue(new Error('403'));

    await expect(loadStudents()).rejects.toThrow('403');
  });

  it('нет ни одного списка — null', async () => {
    apiFetchOptional.mockResolvedValue(null);
    listUsers.mockResolvedValue(null);

    expect(await loadStudents()).toBeNull();
  });
});
