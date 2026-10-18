import { describe, expect, it } from 'vitest';
import { describeError } from './errors';
import { ApiError } from './http';

// Сообщения исключений бэкенда (backend/src/main: OperatorCardException, ScenarioException, SessionException…), которые доходят до интерфейса
const BACKEND_MESSAGES = [
  "Authentication token expired",
  "Bad full name formatting",
  "Bad password formatting",
  "Bad username formatting",
  "Bas full name formatting",
  "Caller profile cannot be empty",
  "Caller profile must contain 'emotional_state' field",
  "Caller profile must contain 'gender' field",
  "Cannot approve scenario without caller profile",
  "Cannot approve scenario without incident facts",
  "Cannot approve scenario without prompt",
  "Cannot approve scenario without reference card",
  "Cannot approve scenario without title",
  "Cannot submit card to an ended session",
  "Category ID cannot be null",
  "Category code cannot be empty",
  "Category name cannot be empty",
  "Category not found",
  "Complexity must not be null (expected: LOW, MEDIUM, HARD)",
  "Evaluation not found for this card",
  "Group name cannot be empty",
  "Group name is already taken",
  "Incident category not found",
  "Incident facts cannot be empty",
  "Invalid arguments",
  "Invalid authentication token",
  "Invalid department id",
  "Invalid nickname",
  "Invalid role id",
  "Invalid scenario title: must not be empty and at most 200 characters",
  "It's your password - simply change it!",
  "One or more scenarios not found",
  "Only administrators can view system incidents",
  "Only approved scenarios can be used in a session",
  "Operator card not found",
  "Prompt cannot be empty",
  "Reference card cannot be empty",
  "Scenario ID cannot be null",
  "Scenario ID must not be null",
  "Scenario IDs list must not be empty",
  "Scenario is not approved, card cannot be submitted",
  "Scenario is not part of this session",
  "Scenario not found",
  "Scenario prompt cannot be empty",
  "Scenario status can only be changed to ARCHIVED or DRAFT; use approve to approve it",
  "Scenario status must not be empty (expected: ARCHIVED, DRAFT)",
  "Session ID must not be null",
  "Session is already ended",
  "Session not found",
  "Student not found",
  "Study group ID must not be null",
  "Study group has no students",
  "Study group not found",
  "Submitted card payload must not be null",
  "Suicide is prohibited :)",
  "Teacher not found",
  "Teacher score must be between 0 and 100",
  "Time limit must be greater than 0",
  "Title must not be empty and at most 200 characters",
  "Unauthorized",
  "User already exists",
  "User is already a member of this study group",
  "User is deactivated",
  "User is not a member of the study group for this session",
  "User is not a member of this study group",
  "User not found",
  "Username already taken",
  "Wrong credentials",
  "You are not a member of this session's study group",
  "You do not have permission to manage sessions",
  "You do not have permission to submit to this session: not a member of its study group",
  "You do not have permission to view this card",
  "You do not have permission to view this session",
  "You do not have permission to view this session: not a member of its study group",
  "You do not have permission to view system incidents: administrators only",
  "You do not have required permissions",
  "Your account is deactivated. Contact admin for more information",
  "Your account is deactivated. Contact your admin",
];

describe('describeError — перевод ошибок бэкенда', () => {
  it.each(BACKEND_MESSAGES)('«%s» переведено на русский', (msg) => {
    const ru = describeError(new ApiError(400, msg));
    expect(ru).not.toBe(msg);
    expect(ru).not.toMatch(/[A-Za-z]{4,}/);
  });

  it('сценарий снят с занятий — в «Разборе карточки» по-русски', () => {
    expect(describeError(new ApiError(400, 'Scenario is not approved, card cannot be submitted'))).toBe('Сценарий снят с занятий — карточку сдать нельзя');
    expect(describeError(new ApiError(400, 'Scenario is not part of this session'))).toBe('Этого сценария нет в занятии — карточку сдать нельзя');
  });

  it('сообщения с подставленным значением', () => {
    expect(describeError(new ApiError(400, 'Category with code FIRE already exists'))).toBe('Категория с кодом FIRE уже есть');
    expect(describeError(new ApiError(400, 'Unknown scenario status: FOO'))).toBe('Неизвестный статус сценария: FOO');
  });

  it('503 с текстом бэкенда (ИИ занят) — показываем его, а не «сервер недоступен»', () => {
    const busy = 'Очередь оценки ИИ переполнена. Повторите позже или выставьте оценку вручную';
    expect(describeError(new ApiError(503, busy))).toBe(busy);
    expect(describeError(new ApiError(503, ''))).toBe('Сервер недоступен. Проверьте, что бэкенд запущен.');
    expect(describeError(new ApiError(502, ''))).toBe('Сервер недоступен. Проверьте, что бэкенд запущен.');
  });

  it('конфликт занятия показывает русское сообщение сервера', () => {
    const message = 'Для этой группы уже идёт занятие — сначала завершите его';
    expect(describeError(new ApiError(409, message))).toBe(message);
  });

  it('неизвестное сообщение показывается как есть', () => {
    expect(describeError(new ApiError(400, 'Something new'))).toBe('Something new');
  });
});
