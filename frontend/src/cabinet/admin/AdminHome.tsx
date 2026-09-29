import { can } from '../../domain/roles';
import type { Permission } from '../../domain/types';
import { useMe } from '../../store/session';
import { Empty, Notice } from '../../ui';
import { IcAudit, IcClipboard, IcGear, IcShield, IcUsers } from '../../arm/icons';
import { CabinetLayout, type NavItem } from '../CabinetLayout';
import { Audit } from './Audit';
import { Roles } from './Roles';
import { Security } from './Security';
import { System } from './System';
import { Users } from './Users';

/*
 * Кабинет администратора. Разделы видны в зависимости от прав роли-шаблона:
 * суперадминистратор видит всё, остальные администраторы — только свою зону.
 * К учебному процессу (сценарии, оценки) у администраторов доступа нет — ограничение ТЗ.
 */

const SECTIONS: { id: string; label: string; tab: string; icon: NavItem['icon']; perms: Permission[] }[] = [
  { id: 'users', label: 'Пользователи', tab: 'пользователи', icon: IcUsers, perms: ['users.manage', 'users.manage_admins'] },
  { id: 'roles', label: 'Роли и права', tab: 'роли', icon: IcClipboard, perms: ['roles.manage', 'users.manage_admins'] },
  { id: 'system', label: 'Система', tab: 'система', icon: IcGear, perms: ['system.services', 'system.monitoring', 'system.backup', 'system.config'] },
  { id: 'security', label: 'Безопасность', tab: 'безопасность', icon: IcShield, perms: ['security.manage'] },
  { id: 'audit', label: 'Журнал аудита', tab: 'аудит', icon: IcAudit, perms: ['audit.view'] },
];

export function AdminHome({ section }: { section?: string }) {
  const { role } = useMe();
  const available = SECTIONS.filter((s) => s.perms.some((p) => can(role ?? undefined, p)));
  const active = available.find((s) => s.id === section) ?? available[0];
  const nav: NavItem[] = available.map((s) => ({ id: s.id, label: s.tab, icon: s.icon, path: `/admin/${s.id}` }));

  return (
    <CabinetLayout nav={nav} active={active?.id ?? ''} title={active?.label ?? 'Администрирование'}>
      {active && active.id !== 'users' && (
        <div className="mb-4">
          <Notice tone="warn">Раздел пока работает на демонстрационных данных: на сервере для него ещё нет методов (см. docs/backend-api.md).</Notice>
        </div>
      )}
      {!active && <Empty>У вашей роли нет доступных разделов администрирования.</Empty>}
      {active?.id === 'users' && <Users />}
      {active?.id === 'roles' && <Roles />}
      {active?.id === 'system' && <System />}
      {active?.id === 'security' && <Security />}
      {active?.id === 'audit' && <Audit />}
    </CabinetLayout>
  );
}
