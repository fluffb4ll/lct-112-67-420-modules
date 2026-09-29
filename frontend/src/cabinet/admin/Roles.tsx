import { useState } from 'react';
import { allowed, createRole, deleteRole } from '../../api';
import { useDb } from '../../api/db';
import { PERMISSION_LABELS, PERMISSIONS_BY_KIND } from '../../domain/roles';
import type { Permission, RoleKind } from '../../domain/types';
import { useMe } from '../../store/session';
import { Badge, Button, Checkbox, Input, Modal, Notice, Panel, Select } from '../../ui';

/*
 * Роли — именованные шаблоны прав (RBAC). Встроенные роли неизменяемы; суперадминистратор
 * может создать роль на основе шаблона с поднабором прав своего вида.
 */

const KIND_LABELS: Record<RoleKind, string> = { admin: 'Администрирование', teacher: 'Преподавание', student: 'Обучение' };

export function Roles() {
  const { user } = useMe();
  const db = useDb((s) => s.db);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');
  if (!user) return null;
  const canManage = allowed(user, 'roles.manage');

  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <div>
          <Button variant="primary" onClick={() => setCreating(true)}>
            Новая роль из шаблона
          </Button>
        </div>
      )}
      {err && <Notice tone="bad">{err}</Notice>}
      <div className="grid gap-3 lg:grid-cols-2">
        {db.roles.map((r) => {
          const users = db.users.filter((u) => u.roleId === r.id).length;
          return (
            <Panel
              key={r.id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {r.name}
                  <Badge tone="accent">{KIND_LABELS[r.kind]}</Badge>
                  {r.builtIn && <Badge>встроенная</Badge>}
                </span>
              }
              actions={
                canManage && !r.builtIn ? (
                  <Button size="sm" variant="danger" onClick={() => setErr(deleteRole(user, r.id) ?? '')}>
                    Удалить
                  </Button>
                ) : undefined
              }
            >
              <p className="text-sm text-c-muted">{r.description}</p>
              <ul className="mt-2 flex flex-col gap-1 text-[13px]">
                {r.permissions.map((p) => (
                  <li key={p} className="flex gap-2">
                    <span className="text-c-ok">✓</span>
                    {PERMISSION_LABELS[p]}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] text-c-muted">Пользователей с ролью: {users}</p>
            </Panel>
          );
        })}
      </div>
      {creating && <CreateRole onClose={() => setCreating(false)} />}
    </div>
  );
}

function CreateRole({ onClose }: { onClose: () => void }) {
  const { user } = useMe();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<RoleKind>('admin');
  const [description, setDescription] = useState('');
  const [perms, setPerms] = useState<Permission[]>([]);
  const [err, setErr] = useState('');
  if (!user) return null;
  return (
    <Modal
      title="Новая роль"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            onClick={() => {
              const e = createRole(user, { name, kind, description, permissions: perms });
              if (e) setErr(e);
              else onClose();
            }}
          >
            Создать
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {err && <Notice tone="bad">{err}</Notice>}
        <Input label="Название" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Дежурный администратор" />
        <Select
          label="Шаблон"
          value={kind}
          onChange={(e) => {
            const next = e.target.value as RoleKind;
            setKind(next);
            // у преподавателя и обучающегося права фиксированные
            setPerms(next === 'admin' ? [] : PERMISSIONS_BY_KIND[next]);
          }}
        >
          {(Object.keys(KIND_LABELS) as RoleKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </Select>
        <Input label="Описание" value={description} onChange={(e) => setDescription(e.target.value)} />
        <div>
          <div className="mb-1.5 text-[13px] font-medium">Права</div>
          {kind === 'admin' ? (
            // Набор прав настраивается только у административных ролей
            <div className="flex flex-col gap-1.5">
              {PERMISSIONS_BY_KIND.admin.map((p) => (
                <Checkbox key={p} checked={perms.includes(p)} onChange={(v) => setPerms(v ? [...perms, p] : perms.filter((x) => x !== p))}>
                  {PERMISSION_LABELS[p]}
                </Checkbox>
              ))}
            </div>
          ) : (
            <>
              <ul className="flex flex-col gap-1 text-[13px]">
                {PERMISSIONS_BY_KIND[kind].map((p) => (
                  <li key={p} className="flex gap-2">
                    <span className="text-c-ok">✓</span>
                    {PERMISSION_LABELS[p]}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] text-c-muted">У преподавателей и обучающихся набор прав одинаковый и не настраивается.</p>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
