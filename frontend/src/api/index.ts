import { can } from '../domain/roles';
import type {
  Attempt,
  LiveProgress,
  Permission,
  Role,
  Scenario,
  TeacherReview,
  TrainingSession,
  User,
} from '../domain/types';
import { getDb, mutate, newId, type SystemConfig, type SystemService } from './db';

/*
 * Операции над данными (мок бэкенда). Сигнатуры повторяют будущий REST API:
 *   POST /auth/login, GET/POST /users, PATCH /users/:id, GET/POST /roles,
 *   GET/POST/PATCH /scenarios, POST /scenarios/:id/approve, POST /scenarios/generate,
 *   GET/POST /sessions, POST /sessions/:id/start|finish,
 *   POST /attempts, POST /attempts/:id/events, POST /attempts/:id/finish, POST /attempts/:id/review,
 *   WS /live — прогресс обучающихся и трансляция «делай как я».
 * Каждое изменение пишется в журнал аудита (требование ТЗ).
 */

export type Actor = Pick<User, 'id' | 'login' | 'roleId'>;

export const roleOf = (roleId: string): Role | undefined => getDb().roles.find((r) => r.id === roleId);

export function allowed(actor: Actor | null | undefined, p: Permission): boolean {
  return !!actor && can(roleOf(actor.roleId), p);
}

export function audit(actor: Actor | { id: string; login: string }, action: string, target?: string, details?: string) {
  mutate((d) => {
    d.audit.unshift({ id: newId('au'), at: new Date().toISOString(), userId: actor.id, userLogin: actor.login, action, target, details });
    if (d.audit.length > 2000) d.audit.length = 2000;
  });
}

// Вход — через бэкенд, см. src/api/auth.ts

// ───────────────────────────── Пользователи и роли ─────────────────────────────

export interface NewUser {
  login: string;
  fullName: string;
  password: string;
  roleId: string;
  groupId?: string;
  serviceId?: string;
}

export function createUser(actor: Actor, data: NewUser): string | null {
  const db = getDb();
  const role = roleOf(data.roleId);
  if (!role) return 'Роль не найдена';
  if (role.kind === 'admin' ? !allowed(actor, 'users.manage_admins') : !allowed(actor, 'users.manage'))
    return 'Недостаточно прав для создания пользователя с этой ролью';
  if (!/^[a-z0-9._-]{3,32}$/i.test(data.login)) return 'Логин: 3–32 символа, латиница, цифры, точка, дефис';
  if (db.users.some((x) => x.login.toLowerCase() === data.login.toLowerCase())) return 'Такой логин уже есть';
  if (data.password.length < db.system.config.passwordMinLength) return `Пароль не короче ${db.system.config.passwordMinLength} символов`;
  if (data.fullName.trim().split(/\s+/).length < 2) return 'Укажите фамилию и имя';
  const id = newId('u');
  mutate((d) => {
    d.users.push({
      id,
      login: data.login,
      password: data.password,
      fullName: data.fullName.trim(),
      roleId: data.roleId,
      blocked: false,
      createdAt: new Date().toISOString(),
      groupId: role.kind === 'student' ? data.groupId : undefined,
      serviceId: role.kind === 'student' ? data.serviceId : undefined,
      operatorNum: role.kind === 'student' ? String(300 + d.users.length) : undefined,
    });
  });
  audit(actor, 'Создание учётной записи', data.login, `Роль: ${role.name}`);
  return null;
}

export function setBlocked(actor: Actor, userId: string, blocked: boolean, reason = '') {
  const target = getDb().users.find((x) => x.id === userId);
  if (!target) return;
  mutate((d) => {
    d.users.find((x) => x.id === userId)!.blocked = blocked;
    if (!blocked) d.failedLogins[userId] = 0;
  });
  audit(actor, blocked ? 'Блокировка учётной записи' : 'Разблокировка учётной записи', target.login, reason || undefined);
}

export function resetPassword(actor: Actor, userId: string, password: string): string | null {
  const db = getDb();
  if (password.length < db.system.config.passwordMinLength) return `Пароль не короче ${db.system.config.passwordMinLength} символов`;
  const target = db.users.find((x) => x.id === userId);
  if (!target) return 'Пользователь не найден';
  mutate((d) => {
    d.users.find((x) => x.id === userId)!.password = password;
  });
  audit(actor, 'Сброс пароля', target.login);
  return null;
}

export function updateUser(actor: Actor, userId: string, patch: Partial<Pick<User, 'fullName' | 'groupId' | 'serviceId' | 'roleId'>>) {
  const target = getDb().users.find((x) => x.id === userId);
  if (!target) return;
  mutate((d) => {
    Object.assign(d.users.find((x) => x.id === userId)!, patch);
  });
  audit(actor, 'Изменение учётной записи', target.login, Object.keys(patch).join(', '));
}

/** Удаление учётной записи. Результаты обучения остаются в отчётах — они привязаны к id попыток. */
export function deleteUser(actor: Actor, userId: string): string | null {
  const db = getDb();
  const target = db.users.find((x) => x.id === userId);
  if (!target) return 'Пользователь не найден';
  if (target.id === actor.id) return 'Нельзя удалить собственную учётную запись';
  const role = roleOf(target.roleId);
  if (role?.kind === 'admin' ? !allowed(actor, 'users.manage_admins') : !allowed(actor, 'users.manage')) return 'Недостаточно прав';
  if (db.sessions.some((s) => s.status === 'running') && db.live.some((l) => l.studentId === userId)) return 'Обучающийся сейчас на занятии';
  mutate((d) => {
    d.users = d.users.filter((x) => x.id !== userId);
    d.live = d.live.filter((l) => l.studentId !== userId);
    delete d.failedLogins[userId];
  });
  audit(actor, 'Удаление учётной записи', target.login, `Роль: ${role?.name ?? target.roleId}`);
  return null;
}

export function createRole(actor: Actor, role: Omit<Role, 'id' | 'builtIn'>): string | null {
  if (!allowed(actor, 'roles.manage')) return 'Недостаточно прав';
  if (!role.name.trim()) return 'Укажите название роли';
  if (!role.permissions.length) return 'Выберите хотя бы одно право';
  mutate((d) => {
    d.roles.push({ ...role, id: newId('role'), builtIn: false });
  });
  audit(actor, 'Создание роли', role.name, role.permissions.join(', '));
  return null;
}

export function deleteRole(actor: Actor, roleId: string): string | null {
  const db = getDb();
  const role = db.roles.find((r) => r.id === roleId);
  if (!role || role.builtIn) return 'Встроенную роль удалить нельзя';
  if (db.users.some((x) => x.roleId === roleId)) return 'Роль назначена пользователям';
  mutate((d) => {
    d.roles = d.roles.filter((r) => r.id !== roleId);
  });
  audit(actor, 'Удаление роли', role.name);
  return null;
}

// ───────────────────────────── Сценарии ─────────────────────────────

export function saveScenario(actor: Actor, sc: Scenario, opts: { keepStatus?: boolean } = {}) {
  const exists = getDb().scenarios.some((s) => s.id === sc.id);
  const next: Scenario = { ...sc };
  // изменённый утверждённый сценарий снова требует утверждения
  if (exists && !opts.keepStatus && sc.status === 'approved') {
    next.status = 'draft';
    next.approvedAt = undefined;
    next.approvedBy = undefined;
  }
  mutate((d) => {
    const i = d.scenarios.findIndex((s) => s.id === sc.id);
    if (i >= 0) d.scenarios[i] = next;
    else d.scenarios.unshift(next);
  });
  audit(actor, exists ? 'Изменение сценария' : 'Создание сценария', sc.id, sc.title);
}

export function setScenarioStatus(actor: Actor, id: string, status: Scenario['status']) {
  const sc = getDb().scenarios.find((s) => s.id === id);
  if (!sc) return;
  mutate((d) => {
    const s = d.scenarios.find((x) => x.id === id)!;
    s.status = status;
    if (status === 'approved') {
      s.approvedBy = actor.id;
      s.approvedAt = new Date().toISOString();
    }
  });
  const label = status === 'approved' ? 'Утверждение сценария' : status === 'archived' ? 'Перенос сценария в архив' : 'Возврат сценария в черновики';
  audit(actor, label, id, sc.title);
}

export function deleteScenario(actor: Actor, id: string) {
  const sc = getDb().scenarios.find((s) => s.id === id);
  if (!sc || sc.status === 'approved') return;
  mutate((d) => {
    d.scenarios = d.scenarios.filter((s) => s.id !== id);
  });
  audit(actor, 'Удаление черновика сценария', id, sc.title);
}

// ───────────────────────────── Занятия ─────────────────────────────

export function saveSession(actor: Actor, s: TrainingSession) {
  const exists = getDb().sessions.some((x) => x.id === s.id);
  mutate((d) => {
    const i = d.sessions.findIndex((x) => x.id === s.id);
    if (i >= 0) d.sessions[i] = s;
    else d.sessions.unshift(s);
  });
  audit(actor, exists ? 'Изменение занятия' : 'Создание занятия', s.id, s.title);
}

export function setSessionStatus(actor: Actor, id: string, status: TrainingSession['status']) {
  const now = new Date().toISOString();
  mutate((d) => {
    const s = d.sessions.find((x) => x.id === id);
    if (!s) return;
    s.status = status;
    if (status === 'running') s.startedAt = now;
    if (status === 'finished') {
      s.finishedAt = now;
      d.live = d.live.filter((l) => l.sessionId !== id);
    }
  });
  audit(actor, status === 'running' ? 'Старт занятия' : 'Завершение занятия', id);
}

// ───────────────────────────── Попытки ─────────────────────────────

export function allocIncidentId(): string {
  let id = 0;
  mutate((d) => {
    id = d.nextIncidentId;
    d.nextIncidentId += 1 + Math.floor(Math.random() * 3);
  });
  return String(id);
}

export function saveAttempt(a: Attempt) {
  mutate((d) => {
    const i = d.attempts.findIndex((x) => x.id === a.id);
    if (i >= 0) d.attempts[i] = a;
    else d.attempts.push(a);
  });
}

export function reviewAttempt(actor: Actor, attemptId: string, review: Omit<TeacherReview, 'by' | 'at'>) {
  const a = getDb().attempts.find((x) => x.id === attemptId);
  if (!a) return;
  const before = a.review?.score ?? a.evaluation?.score;
  mutate((d) => {
    d.attempts.find((x) => x.id === attemptId)!.review = { ...review, by: actor.id, at: new Date().toISOString() };
  });
  audit(
    actor,
    review.score !== undefined && review.score !== before ? 'Изменение оценки (экспертная оценка)' : 'Комментарий к результату',
    attemptId,
    review.score !== undefined ? `Балл: ${before} → ${review.score}. ${review.comment}` : review.comment,
  );
}

export function setLive(p: LiveProgress) {
  mutate((d) => {
    d.live = d.live.filter((l) => l.studentId !== p.studentId);
    d.live.push(p);
  });
}

export function clearLive(studentId: string) {
  mutate((d) => {
    d.live = d.live.filter((l) => l.studentId !== studentId);
  });
}

// ───────────────────────────── Сообщения преподавателя ─────────────────────────────

export function sendMessage(actor: Actor, to: string, text: string) {
  mutate((d) => {
    d.messages.push({ id: newId('msg'), at: new Date().toISOString(), from: actor.id, to, text, read: false });
  });
  audit(actor, 'Обратная связь обучающемуся', to, text.slice(0, 120));
}

export function markRead(ids: string[]) {
  if (!ids.length) return;
  mutate((d) => {
    d.messages.forEach((m) => {
      if (ids.includes(m.id)) m.read = true;
    });
  });
}

// ───────────────────────────── Система ─────────────────────────────

export function setServiceStatus(actor: Actor, id: string, status: SystemService['status']) {
  const svc = getDb().system.services.find((s) => s.id === id);
  if (!svc) return;
  mutate((d) => {
    const s = d.system.services.find((x) => x.id === id)!;
    s.status = status;
    if (status === 'running') s.uptimeSec = 0;
  });
  audit(actor, status === 'stopped' ? 'Остановка сервиса' : 'Запуск сервиса', svc.name);
}

export function createBackup(actor: Actor) {
  mutate((d) => {
    d.system.backups.unshift({ id: newId('b'), at: new Date().toISOString(), sizeMb: 215 + Math.round(Math.random() * 10), kind: 'manual' });
  });
  audit(actor, 'Резервное копирование', 'backup', 'Вручную');
}

export function updateConfig(actor: Actor, patch: Partial<SystemConfig>) {
  mutate((d) => {
    Object.assign(d.system.config, patch);
  });
  audit(actor, 'Изменение конфигурации', 'system', Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(', '));
}

/** Идёт ли сейчас хоть одно занятие — во время занятия администратор не вмешивается в учебный процесс */
export const anySessionRunning = () => getDb().sessions.some((s) => s.status === 'running');
