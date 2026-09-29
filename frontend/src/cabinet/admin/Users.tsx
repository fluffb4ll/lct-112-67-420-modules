import { useCallback, useEffect, useState } from 'react';
import {
  ADMIN_ROLE_ID,
  createUser,
  deleteUser,
  getUser,
  KNOWN_ROLES,
  listDepartments,
  listRoles,
  listUsers,
  RULES,
  STUDENT_ROLE_ID,
  updateUser,
  type CreateUserRequest,
  type PageResponse,
  type RoleDto,
  type UserTableRow,
} from '../../api/admin';
import { BACKEND_PERMISSIONS, type DepartmentDto, type UserInfoDto } from '../../api/auth';
import { describeError } from '../../api/errors';
import { ApiError } from '../../api/http';
import { useMe } from '../../store/session';
import { Badge, Button, Checkbox, ConfirmModal, Input, Modal, Notice, Panel, Select, Table } from '../../ui';

/*
 * Учётные записи — через бэкенд (/api/admin/users/*): список страницами, создание,
 * блокировка, смена пароля, удаление. Логин и права видны в карточке пользователя
 * (GET /api/admin/users/{id}) — в строке таблицы бэкенд их не отдаёт.
 * Администраторов создаёт и меняет только роль с правом ADMIN_CAN_EDIT_ADMINS.
 */

type Loaded<T> = T | null | 'loading';

/** Загрузка данных экрана; null в поле — такого метода на сервере пока нет */
async function loadAll(page: number): Promise<{
  users: PageResponse<UserTableRow> | null;
  roles: RoleDto[] | null;
  departments: DepartmentDto[] | null;
  error?: string;
  denied?: boolean;
}> {
  try {
    const [users, roles, departments] = await Promise.all([listUsers(page), listRoles(), listDepartments()]);
    return { users, roles, departments };
  } catch (e) {
    // 401 здесь означает нехватку прав: истёкшую сессию перехватывает http.ts и возвращает на вход
    const denied = e instanceof ApiError && e.status === 401;
    return { users: null, roles: null, departments: null, error: describeError(e, 'Не удалось загрузить данные'), denied };
  }
}

interface CreatedHere {
  username: string;
  fullName: string;
  roleId: number;
}

export function Users() {
  const { info } = useMe();
  const [page, setPage] = useState(0);
  const [users, setUsers] = useState<Loaded<PageResponse<UserTableRow>>>('loading');
  const [roles, setRoles] = useState<Loaded<RoleDto[]>>('loading');
  const [departments, setDepartments] = useState<Loaded<DepartmentDto[]>>('loading');
  const [createdHere, setCreatedHere] = useState<CreatedHere[]>([]);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [cardFor, setCardFor] = useState<UserTableRow | null>(null);
  const [pwdFor, setPwdFor] = useState<UserTableRow | null>(null);
  const [deleteFor, setDeleteFor] = useState<UserTableRow | null>(null);
  const [denied, setDenied] = useState(false);

  const canEditAdmins = !!info?.permissions.includes(BACKEND_PERMISSIONS.editAdmins);

  const apply = useCallback((r: Awaited<ReturnType<typeof loadAll>>) => {
    setUsers(r.users);
    setRoles(r.roles);
    setDepartments(r.departments);
    setDenied(!!r.denied);
    // сообщение об ошибке снимаем, когда данные снова загрузились; отчёт об удачном действии оставляем
    setMsg((m) => (r.error ? { tone: 'bad', text: r.error } : m?.tone === 'bad' ? null : m));
  }, []);

  const reload = useCallback(() => loadAll(page).then(apply), [apply, page]);

  useEffect(() => {
    let alive = true;
    void loadAll(page).then((r) => alive && apply(r));
    return () => {
      alive = false;
    };
  }, [apply, page]);

  const roleName = (roleId: number) => (Array.isArray(roles) ? roles : KNOWN_ROLES).find((r) => r.id === roleId)?.name ?? `роль ${roleId}`;
  const isAdmin = (u: UserTableRow) => /ADMIN/i.test(u.roleName);
  const editable = (u: UserTableRow) => u.id !== info?.id && (!isAdmin(u) || canEditAdmins);

  const run = async (action: () => Promise<void>, ok: string) => {
    setMsg(null);
    try {
      await action();
      setMsg({ tone: 'ok', text: ok });
      await reload();
    } catch (e) {
      setMsg({ tone: 'bad', text: describeError(e) });
    }
  };

  const rows = users !== null && users !== 'loading' ? users.content.filter((u) => !q || `${u.fullName} ${u.roleName}`.toLowerCase().includes(q.toLowerCase())) : [];
  const total = users !== null && users !== 'loading' ? users.totalElements : 0;
  const pages = users !== null && users !== 'loading' ? Math.max(users.totalPages, 1) : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Button variant="primary" onClick={() => setCreating(true)}>
          Новый пользователь
        </Button>
        <Button onClick={() => void reload()}>Обновить</Button>
        {users !== null && users !== 'loading' && (
          <Input placeholder="Поиск по ФИО и роли на странице" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:ml-auto sm:w-[300px]" />
        )}
      </div>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      {users === 'loading' && <Notice tone="neutral">Загрузка…</Notice>}

      {users === null && !denied && (
        <Notice tone="warn">
          Сервер не отдаёт список пользователей (<code>GET /api/admin/users</code>). Проверьте, что запущена свежая сборка бэкенда. Создавать пользователей можно и без списка.
        </Notice>
      )}

      {users === null && denied && (
        <Notice tone="warn">
          У вашей роли нет права на просмотр списка пользователей (<code>ADMIN_CAN_READ_USERINFO</code>). Обратитесь к суперадминистратору.
        </Notice>
      )}

      {users !== null && users !== 'loading' && (
        <Panel pad={false}>
          <Table>
            <thead>
              <tr>
                <th>ФИО</th>
                <th>Роль</th>
                <th>Подразделение</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td>{u.fullName}</td>
                  <td className="text-[13px]">{u.roleName}</td>
                  <td className="text-[12px] text-c-muted">{u.departmentName ?? '—'}</td>
                  <td>{u.isActive ? <Badge tone="ok">активен</Badge> : <Badge tone="bad">заблокирован</Badge>}</td>
                  <td>
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => setCardFor(u)}>
                        Карточка
                      </Button>
                      {editable(u) && (
                        <>
                          <Button
                            size="sm"
                            variant={u.isActive ? 'danger' : 'secondary'}
                            onClick={() => void run(() => updateUser({ userId: u.id, isActive: !u.isActive }), u.isActive ? `${u.fullName} заблокирован` : `${u.fullName} разблокирован`)}
                          >
                            {u.isActive ? 'Заблокировать' : 'Разблокировать'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setPwdFor(u)}>
                            Пароль
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => setDeleteFor(u)}>
                            Удалить
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="border-t border-c-line px-3 py-2">
            <Pager page={users.page} pages={pages} total={total} onPage={setPage} />
          </div>
        </Panel>
      )}

      {users === null && createdHere.length > 0 && (
        <Panel title="Созданы в этом сеансе" pad={false}>
          <Table>
            <thead>
              <tr>
                <th>Логин</th>
                <th>ФИО</th>
                <th>Роль</th>
              </tr>
            </thead>
            <tbody>
              {createdHere.map((u) => (
                <tr key={u.username}>
                  <td className="font-mono text-[13px]">{u.username}</td>
                  <td>{u.fullName}</td>
                  <td className="text-[13px]">{roleName(u.roleId)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}

      {creating && (
        <CreateUser
          roles={Array.isArray(roles) ? roles : null}
          departments={Array.isArray(departments) ? departments : null}
          canEditAdmins={canEditAdmins}
          onClose={() => setCreating(false)}
          onCreated={(u) => {
            setCreating(false);
            setCreatedHere((list) => [u, ...list]);
            setMsg({ tone: 'ok', text: `Пользователь ${u.username} создан` });
            void reload();
          }}
        />
      )}

      {cardFor && <UserCard row={cardFor} onClose={() => setCardFor(null)} />}

      {pwdFor && (
        <PasswordModal
          target={pwdFor}
          onClose={() => setPwdFor(null)}
          onSave={(password, mustChange) => {
            setPwdFor(null);
            void run(() => updateUser({ userId: pwdFor.id, password, mustChangePassword: mustChange }), `Пароль ${pwdFor.fullName} изменён`);
          }}
        />
      )}

      {deleteFor && (
        <ConfirmModal
          title="Удалить учётную запись?"
          text={`${deleteFor.fullName} потеряет доступ к системе. Если нужно только временно закрыть доступ — используйте блокировку.`}
          confirm="удалить"
          danger
          onConfirm={() => {
            const target = deleteFor;
            setDeleteFor(null);
            void run(() => deleteUser(target.id), `Пользователь ${target.fullName} удалён`);
          }}
          onCancel={() => setDeleteFor(null)}
        />
      )}
    </div>
  );
}

function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[12px] text-c-muted">
      <span>
        Страница {page + 1} из {pages} · всего {total}
      </span>
      <div className="flex gap-1.5">
        <Button size="sm" disabled={page <= 0} onClick={() => onPage(page - 1)}>
          Назад
        </Button>
        <Button size="sm" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>
          Вперёд
        </Button>
      </div>
    </div>
  );
}

/** Карточка пользователя: логин, права и группы бэкенд отдаёт отдельным запросом */
function UserCard({ row, onClose }: { row: UserTableRow; onClose: () => void }) {
  const [data, setData] = useState<UserInfoDto | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    void getUser(row.id).then(
      (u) => alive && setData(u),
      (e: unknown) => alive && setErr(describeError(e, 'Не удалось загрузить карточку')),
    );
    return () => {
      alive = false;
    };
  }, [row.id]);

  const line = (label: string, value: string) => (
    <div className="flex gap-2 border-b border-c-line py-1.5 text-[13px] last:border-0">
      <span className="w-[150px] shrink-0 text-c-muted">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  );

  return (
    <Modal
      title={row.fullName}
      onClose={onClose}
      footer={
        <Button variant="success" className="h-10 px-4 text-[15px]" onClick={onClose}>
          закрыть
        </Button>
      }
    >
      {err && <Notice tone="bad">{err}</Notice>}
      {!data && !err && <Notice tone="neutral">Загрузка…</Notice>}
      {data && (
        <div className="flex flex-col">
          {line('Логин', data.username)}
          {line('Роль', data.role)}
          {line('Права', data.permissions.length ? data.permissions.join(', ') : 'нет')}
          {line('Подразделение', data.department?.name ?? '—')}
          {line('Учебные группы', data.studyGroups?.length ? data.studyGroups.map((g) => g.name).join(', ') : '—')}
          {line('Статус', row.isActive ? 'активен' : 'заблокирован')}
          {line('Id', data.id)}
        </div>
      )}
    </Modal>
  );
}

function CreateUser({
  roles,
  departments,
  canEditAdmins,
  onClose,
  onCreated,
}: {
  roles: RoleDto[] | null;
  departments: DepartmentDto[] | null;
  canEditAdmins: boolean;
  onClose: () => void;
  onCreated: (u: CreatedHere) => void;
}) {
  // список ролей с сервера, а пока его нет — известные id из iam.roles
  const availableRoles = (roles ?? KNOWN_ROLES).filter((r) => r.id !== ADMIN_ROLE_ID || canEditAdmins);
  const [form, setForm] = useState<CreateUserRequest>({
    username: '',
    password: '',
    fullName: '',
    // по умолчанию обучающийся: администратора выбирают осознанно
    roleId: (availableRoles.find((r) => r.id === STUDENT_ROLE_ID) ?? availableRoles.find((r) => r.id !== ADMIN_ROLE_ID) ?? availableRoles[0])?.id ?? STUDENT_ROLE_ID,
    departmentId: null,
    mustChangePassword: true,
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<CreateUserRequest>) => setForm((f) => ({ ...f, ...p }));

  const validate = (): string | null => {
    if (!RULES.username.test(form.username)) return 'Логин: латинские буквы, цифры, точка, дефис или подчёркивание, до 16 символов';
    if (!RULES.fullName.test(form.fullName.trim())) return 'ФИО: только русские или латинские буквы, пробел и апостроф (буква «ё» и дефис пока не принимаются сервером)';
    if (!RULES.password.test(form.password)) return 'Пароль: не короче 8 символов, обязательно латинские буквы и цифры';
    if (!Number.isInteger(form.roleId) || form.roleId < 0) return 'Укажите роль';
    if (form.roleId === ADMIN_ROLE_ID && !canEditAdmins) return 'Недостаточно прав для создания администратора';
    return null;
  };

  const submit = async () => {
    const v = validate();
    if (v) return setErr(v);
    setBusy(true);
    setErr('');
    try {
      await createUser({ ...form, fullName: form.fullName.trim() });
      onCreated({ username: form.username, fullName: form.fullName.trim(), roleId: form.roleId });
    } catch (e) {
      setErr(describeError(e, 'Не удалось создать пользователя'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Новый пользователь"
      onClose={onClose}
      footer={
        <>
          <Button variant="success" className="h-10 px-4 text-[15px]" onClick={onClose}>
            отмена
          </Button>
          <Button variant="success" className="h-10 px-4 text-[15px] font-bold" onClick={() => void submit()} disabled={busy}>
            {busy ? 'создание…' : 'создать'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {err && <Notice tone="bad">{err}</Notice>}
        <Input label="ФИО" value={form.fullName} onChange={(e) => set({ fullName: e.target.value })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Логин" hint="латиница, до 16 символов" value={form.username} onChange={(e) => set({ username: e.target.value.trim() })} autoComplete="off" />
          <Input label="Пароль" hint="от 8 символов, буквы и цифры" type="password" value={form.password} onChange={(e) => set({ password: e.target.value })} autoComplete="new-password" />
        </div>
        <Select
          label="Роль"
          hint={roles ? undefined : 'список ролей на сервере пока не отдаётся, id взяты из таблицы iam.roles'}
          value={form.roleId}
          onChange={(e) => set({ roleId: Number(e.target.value) })}
        >
          {availableRoles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
        {departments && (
          <Select label="Подразделение" value={form.departmentId ?? ''} onChange={(e) => set({ departmentId: e.target.value || null })}>
            <option value="">без подразделения</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        )}
        <Checkbox checked={form.mustChangePassword} onChange={(v) => set({ mustChangePassword: v })}>
          Потребовать сменить пароль при первом входе
        </Checkbox>
      </div>
    </Modal>
  );
}

function PasswordModal({ target, onClose, onSave }: { target: UserTableRow; onClose: () => void; onSave: (password: string, mustChange: boolean) => void }) {
  const [pwd, setPwd] = useState('');
  const [mustChange, setMustChange] = useState(true);
  const [err, setErr] = useState('');
  return (
    <Modal
      title={`Новый пароль: ${target.fullName}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="success" className="h-10 px-4 text-[15px]" onClick={onClose}>
            отмена
          </Button>
          <Button
            variant="success"
            className="h-10 px-4 text-[15px] font-bold"
            onClick={() => (RULES.password.test(pwd) ? onSave(pwd, mustChange) : setErr('Пароль: не короче 8 символов, обязательно латинские буквы и цифры'))}
          >
            сохранить
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {err && <Notice tone="bad">{err}</Notice>}
        <Input label="Новый пароль" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" />
        <Checkbox checked={mustChange} onChange={setMustChange}>
          Потребовать сменить пароль при следующем входе
        </Checkbox>
      </div>
    </Modal>
  );
}
