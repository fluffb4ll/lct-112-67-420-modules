import { describe, expect, it } from 'vitest';
import { roleLabel } from './auth';

describe('roleLabel', () => {
  it('переводит технические коды ролей', () => {
    expect(roleLabel('ROLE_STUDENT')).toBe('Обучающийся');
    expect(roleLabel('ROLE_TEACHER')).toBe('Преподаватель');
    expect(roleLabel('ROLE_ADMIN')).toBe('Администратор');
  });

  it('не меняет уже человекочитаемую неизвестную роль', () => {
    expect(roleLabel('Методист')).toBe('Методист');
  });
});
