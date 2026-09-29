import { useCallback, useEffect, useState } from 'react';
import { listUsers, type PageResponse, type UserTableRow } from '../../api/admin';
import { describeError } from '../../api/errors';
import {
  addGroupMember,
  createStudyGroup,
  deleteStudyGroup,
  getStudyGroup,
  listStudyGroups,
  PERMISSION_EDIT_GROUPS,
  removeGroupMember,
  updateStudyGroup,
  type StudyGroupInfo,
  type StudyGroupRow,
} from '../../api/teacher';
import { useMe } from '../../store/session';
import { Button, ConfirmModal, Input, Modal, Notice, Panel, Select, Table } from '../../ui';

/*
 * Учебные группы — через бэкенд (/api/teacher/studyGroup*, ветка teacher).
 * Создание, переименование, удаление и просмотр состава работают.
 * Зачислять обучающихся пока нечем: на сервере нет метода добавления участника,
 * поэтому состав группы только показывается (см. docs/backend-api.md).
 */

type Loaded<T> = T | null | 'loading';

async function load(page: number): Promise<{ groups: PageResponse<StudyGroupRow> | null; error?: string }> {
  try {
    return { groups: await listStudyGroups(page) };
  } catch (e) {
    return { groups: null, error: describeError(e, 'Не удалось загрузить группы') };
  }
}

export function Groups() {
  const { user, info } = useMe();
  const [page, setPage] = useState(0);
  const [groups, setGroups] = useState<Loaded<PageResponse<StudyGroupRow>>>('loading');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [renameFor, setRenameFor] = useState<StudyGroupRow | null>(null);
  const [membersFor, setMembersFor] = useState<StudyGroupRow | null>(null);
  const [deleteFor, setDeleteFor] = useState<StudyGroupRow | null>(null);

  const canEdit = !!info?.permissions.includes(PERMISSION_EDIT_GROUPS);

  const apply = useCallback((r: Awaited<ReturnType<typeof load>>) => {
    setGroups(r.groups);
    setMsg((m) => (r.error ? { tone: 'bad', text: r.error } : m?.tone === 'bad' ? null : m));
  }, []);

  const reload = useCallback(() => load(page).then(apply), [apply, page]);

  useEffect(() => {
    let alive = true;
    void load(page).then((r) => alive && apply(r));
    return () => {
      alive = false;
    };
  }, [apply, page]);

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

  const mine = (g: StudyGroupRow) => g.teacher?.id === user?.id;
  const rows = groups !== null && groups !== 'loading' ? groups.content : [];
  const pages = groups !== null && groups !== 'loading' ? Math.max(groups.totalPages, 1) : 1;
  const total = groups !== null && groups !== 'loading' ? groups.totalElements : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Button variant="primary" disabled={!canEdit} onClick={() => setCreating(true)}>
          Новая группа
        </Button>
        <Button onClick={() => void reload()}>Обновить</Button>
      </div>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      {groups === 'loading' && <Notice tone="neutral">Загрузка…</Notice>}

      {groups === null && (
        <Notice tone="warn">
          Сервер не отдаёт учебные группы (<code>GET /api/teacher/studyGroups</code>). Методы готовы в ветке <code>teacher</code> — возможно, на сервере запущена сборка без них.
        </Notice>
      )}

      {!canEdit && groups !== null && <Notice tone="warn">У вашей роли нет права на изменение групп (ADMIN_CAN_EDIT_GROUPS) — группы доступны только для просмотра.</Notice>}

      {groups !== null && groups !== 'loading' && (
        <Panel pad={false}>
          <Table>
            <thead>
              <tr>
                <th>Группа</th>
                <th>Преподаватель</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id}>
                  <td>{g.name}</td>
                  <td className="text-[13px] text-c-muted">{g.teacher ? `${g.teacher.fullName}${mine(g) ? ' — вы' : ''}` : 'не назначен'}</td>
                  <td>
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => setMembersFor(g)}>
                        Состав
                      </Button>
                      {canEdit && mine(g) && (
                        <Button size="sm" variant="secondary" onClick={() => setRenameFor(g)}>
                          Переименовать
                        </Button>
                      )}
                      {canEdit && (
                        <Button size="sm" variant="danger" onClick={() => setDeleteFor(g)}>
                          Удалить
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-[13px] text-c-muted">
                    Групп пока нет
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
          <div className="flex items-center justify-between gap-2 border-t border-c-line px-3 py-2 text-[12px] text-c-muted">
            <span>
              Страница {page + 1} из {pages} · всего {total}
            </span>
            <div className="flex gap-1.5">
              <Button size="sm" disabled={page <= 0} onClick={() => setPage(page - 1)}>
                Назад
              </Button>
              <Button size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
                Вперёд
              </Button>
            </div>
          </div>
        </Panel>
      )}

      {creating && user && (
        <NameModal
          title="Новая группа"
          confirm="создать"
          onClose={() => setCreating(false)}
          onSave={(name) => {
            setCreating(false);
            void run(async () => {
              await createStudyGroup(name, user.id);
            }, `Группа «${name}» создана`);
          }}
        />
      )}

      {renameFor && (
        <NameModal
          title="Переименовать группу"
          confirm="сохранить"
          value={renameFor.name}
          onClose={() => setRenameFor(null)}
          onSave={(name) => {
            const target = renameFor;
            setRenameFor(null);
            void run(() => updateStudyGroup({ groupId: target.id, name }), `Группа переименована в «${name}»`);
          }}
        />
      )}

      {membersFor && <MembersModal group={membersFor} canEdit={canEdit} onClose={() => setMembersFor(null)} />}

      {deleteFor && (
        <ConfirmModal
          title="Удалить группу?"
          text={`«${deleteFor.name}» исчезнет из списка. Учётные записи обучающихся останутся.`}
          confirm="удалить"
          danger
          onConfirm={() => {
            const target = deleteFor;
            setDeleteFor(null);
            void run(() => deleteStudyGroup(target.id), `Группа «${target.name}» удалена`);
          }}
          onCancel={() => setDeleteFor(null)}
        />
      )}
    </div>
  );
}

function NameModal({ title, confirm, value = '', onClose, onSave }: { title: string; confirm: string; value?: string; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(value);
  const [err, setErr] = useState('');
  const submit = () => (name.trim() ? onSave(name.trim()) : setErr('Укажите название группы'));

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="success" className="h-10 px-4 text-[15px]" onClick={onClose}>
            отмена
          </Button>
          <Button variant="success" className="h-10 px-4 text-[15px] font-bold" onClick={submit}>
            {confirm}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {err && <Notice tone="bad">{err}</Notice>}
        <Input
          label="Название"
          hint="например, «Смена 2, поток 112-А»"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </div>
    </Modal>
  );
}

/** Состав группы: список участников, зачисление обучающегося и отчисление */
function MembersModal({ group, canEdit, onClose }: { group: StudyGroupRow; canEdit: boolean; onClose: () => void }) {
  const [data, setData] = useState<StudyGroupInfo | null>(null);
  const [students, setStudents] = useState<UserTableRow[] | null>(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(
    () =>
      getStudyGroup(group.id).then(
        (g) => setData(g),
        (e: unknown) => setErr(describeError(e, 'Не удалось загрузить состав группы')),
      ),
    [group.id],
  );

  useEffect(() => {
    let alive = true;
    void getStudyGroup(group.id).then(
      (g) => alive && setData(g),
      (e: unknown) => alive && setErr(describeError(e, 'Не удалось загрузить состав группы')),
    );
    // кого можно зачислить: обучающиеся из общего списка пользователей
    void listUsers(0, 100).then(
      (p) => alive && setStudents(p ? p.content.filter((u) => /STUDENT|ОБУЧ/i.test(u.roleName) && u.isActive) : null),
      () => alive && setStudents(null),
    );
    return () => {
      alive = false;
    };
  }, [group.id]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setErr('');
    try {
      await action();
      await load();
    } catch (e) {
      setErr(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const inGroup = new Set(data?.users.map((u) => u.id) ?? []);
  const free = (students ?? []).filter((s) => !inGroup.has(s.id));

  return (
    <Modal
      title={`Состав: ${group.name}`}
      onClose={onClose}
      footer={
        <Button variant="success" className="h-10 px-4 text-[15px]" onClick={onClose}>
          закрыть
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {err && <Notice tone="bad">{err}</Notice>}
        {!data && !err && <Notice tone="neutral">Загрузка…</Notice>}

        {canEdit && data && (
          <div className="flex items-end gap-2">
            {students === null ? (
              <Notice tone="warn">Список обучающихся недоступен: нужен доступ к списку пользователей (ADMIN_CAN_READ_USERINFO).</Notice>
            ) : (
              <>
                <Select label="Зачислить обучающегося" className="flex-1" value={pick} onChange={(e) => setPick(e.target.value)}>
                  <option value="">выберите из списка</option>
                  {free.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fullName}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="primary"
                  disabled={!pick || busy}
                  onClick={() => {
                    const id = pick;
                    setPick('');
                    void run(() => addGroupMember(group.id, id));
                  }}
                >
                  Добавить
                </Button>
              </>
            )}
          </div>
        )}

        {data && !data.users.length && <Notice tone="neutral">В группе пока никого нет.</Notice>}
        {data && !!data.users.length && (
          <Table>
            <thead>
              <tr>
                <th>ФИО</th>
                <th>Логин</th>
                <th>Роль</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td>{u.fullName}</td>
                  <td className="font-mono text-[13px]">{u.username}</td>
                  <td className="text-[13px] text-c-muted">{u.role}</td>
                  <td>
                    {canEdit && (
                      <div className="flex justify-end">
                        <Button size="sm" variant="danger" disabled={busy} onClick={() => void run(() => removeGroupMember(group.id, u.id))}>
                          Убрать
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </Modal>
  );
}
