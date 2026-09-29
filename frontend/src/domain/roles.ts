import type { Permission, Role, RoleKind } from './types';

export const PERMISSION_LABELS: Record<Permission, string> = {
  'users.manage': 'Учётные записи обучающихся и преподавателей',
  'users.manage_admins': 'Учётные записи администраторов',
  'roles.manage': 'Шаблоны ролей и права доступа',
  'system.services': 'Запуск и остановка сервисов, пакетное обновление',
  'system.monitoring': 'Мониторинг состояния и нагрузки',
  'system.backup': 'Резервное копирование',
  'system.config': 'Конфигурация: IP-телефония, БД, журналирование',
  'security.manage': 'Политики безопасности, контроль целостности',
  'audit.view': 'Журнал аудита',
  'scenarios.manage': 'Создание и генерация сценариев',
  'scenarios.approve': 'Утверждение сценариев в общий банк',
  'sessions.manage': 'Занятия и мониторинг обучающихся',
  'reports.view': 'Отчёты по успеваемости',
  'grades.review': 'Экспертная оценка результатов',
  'training.participate': 'Выполнение заданий на эмуляторе АРМ',
};

export const PERMISSIONS_BY_KIND: Record<RoleKind, Permission[]> = {
  admin: [
    'users.manage',
    'users.manage_admins',
    'roles.manage',
    'system.services',
    'system.monitoring',
    'system.backup',
    'system.config',
    'security.manage',
    'audit.view',
  ],
  teacher: ['scenarios.manage', 'scenarios.approve', 'sessions.manage', 'reports.view', 'grades.review'],
  student: ['training.participate'],
};

/*
 * Встроенные шаблоны ролей. Администраторские роли — не чекбоксы у пользователя,
 * а отдельные роли с фиксированным набором прав (решение команды).
 * Ни у одной админской роли нет доступа к оценкам и сценариям — ограничение ТЗ.
 */
export const BUILT_IN_ROLES: Role[] = [
  {
    id: 'superadmin',
    name: 'Суперадминистратор',
    kind: 'admin',
    description: 'Полный доступ к администрированию, в том числе создание других администраторов и ролей',
    permissions: PERMISSIONS_BY_KIND.admin,
    builtIn: true,
  },
  {
    id: 'admin_accounts',
    name: 'Администратор учётных записей',
    kind: 'admin',
    description: 'Создание, блокировка и разблокировка обучающихся и преподавателей',
    permissions: ['users.manage', 'audit.view'],
    builtIn: true,
  },
  {
    id: 'admin_tech',
    name: 'Технический администратор',
    kind: 'admin',
    description: 'Сервисы, мониторинг, резервное копирование, IP-телефония',
    permissions: ['system.services', 'system.monitoring', 'system.backup', 'system.config', 'audit.view'],
    builtIn: true,
  },
  {
    id: 'admin_security',
    name: 'Администратор безопасности',
    kind: 'admin',
    description: 'Политики доступа, контроль целостности, аудит',
    permissions: ['security.manage', 'audit.view', 'system.monitoring'],
    builtIn: true,
  },
  {
    id: 'teacher',
    name: 'Преподаватель',
    kind: 'teacher',
    description: 'Сценарии, занятия, мониторинг, отчёты и экспертная оценка',
    permissions: PERMISSIONS_BY_KIND.teacher,
    builtIn: true,
  },
  {
    id: 'student',
    name: 'Обучающийся',
    kind: 'student',
    description: 'Выполнение назначенных заданий, собственные результаты',
    permissions: PERMISSIONS_BY_KIND.student,
    builtIn: true,
  },
];

export function can(role: Role | undefined, p: Permission): boolean {
  return !!role && role.permissions.includes(p);
}
