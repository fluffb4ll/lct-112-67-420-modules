import { useCallback, useEffect, useState } from 'react';
import { BACKEND_PERMISSIONS } from '../../api/auth';
import {
  createIncidentCategory,
  deleteIncidentCategory,
  listIncidentCategories,
  updateIncidentCategory,
  type IncidentCategory,
} from '../../api/catalogs';
import { describeError } from '../../api/errors';
import { useMe } from '../../store/session';
import { Button, ConfirmModal, Empty, Input, Modal, Notice, Panel, Table } from '../../ui';

/*
 * Типы (категории) происшествий — справочник на сервере (/api/incidentCategories).
 * Из него преподаватель выбирает категорию при создании сценария, поэтому без
 * заполненного справочника банк сценариев не пополнить.
 */

type Loaded<T> = T | null | 'loading';

async function load(): Promise<{ list: IncidentCategory[] | null; error?: string }> {
  try {
    return { list: await listIncidentCategories() };
  } catch (e) {
    return { list: null, error: describeError(e, 'Не удалось загрузить справочник') };
  }
}

export function Catalog() {
  const { info } = useMe();
  const [data, setData] = useState<Loaded<IncidentCategory[]>>('loading');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [edit, setEdit] = useState<IncidentCategory | 'new' | null>(null);
  const [remove, setRemove] = useState<IncidentCategory | null>(null);

  const canEdit = !!info?.permissions.includes(BACKEND_PERMISSIONS.editUsers);

  const apply = useCallback((r: Awaited<ReturnType<typeof load>>) => {
    setData(r.list);
    setMsg((m) => (r.error ? { tone: 'bad', text: r.error } : m?.tone === 'bad' ? null : m));
  }, []);

  const reload = useCallback(() => load().then(apply), [apply]);

  useEffect(() => {
    let alive = true;
    void load().then((r) => alive && apply(r));
    return () => {
      alive = false;
    };
  }, [apply]);

  const run = async (action: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await action();
      setMsg({ tone: 'ok', text: ok });
      await reload();
    } catch (e) {
      setMsg({ tone: 'bad', text: describeError(e) });
    }
  };

  const rows = Array.isArray(data) ? data : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={!canEdit} onClick={() => setEdit('new')}>
          Новый тип происшествия
        </Button>
        <Button onClick={() => void reload()}>Обновить</Button>
      </div>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {data === 'loading' && <Notice tone="neutral">Загрузка…</Notice>}
      {data === null && (
        <Notice tone="warn">
          Сервер не отдаёт справочник (<code>GET /api/incidentCategories</code>).
        </Notice>
      )}
      {!canEdit && data !== null && <Notice tone="warn">У вашей роли нет права на правку справочников — он доступен только для просмотра.</Notice>}

      {Array.isArray(data) && (
        <Panel pad={false}>
          {rows.length === 0 ? (
            <div className="p-4">
              <Empty>Справочник пуст. Добавьте типы — без них нельзя создать сценарий.</Empty>
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Код</th>
                  <th>Название</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td className="font-mono text-[13px]">{c.code}</td>
                    <td>{c.name}</td>
                    <td>
                      {canEdit && (
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="secondary" onClick={() => setEdit(c)}>
                            Изменить
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => setRemove(c)}>
                            Удалить
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      )}

      {edit && (
        <CategoryModal
          value={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSave={(code, name) => {
            const target = edit;
            setEdit(null);
            void run(
              () => (target === 'new' ? createIncidentCategory(code, name) : updateIncidentCategory(target.id, code, name)),
              target === 'new' ? `Тип «${name}» добавлен` : `Тип «${name}» изменён`,
            );
          }}
        />
      )}

      {remove && (
        <ConfirmModal
          title="Удалить тип происшествия?"
          text={`«${remove.name}» исчезнет из справочника. Сценарии, созданные с этим типом, останутся.`}
          confirm="удалить"
          danger
          onConfirm={() => {
            const target = remove;
            setRemove(null);
            void run(() => deleteIncidentCategory(target.id), `Тип «${target.name}» удалён`);
          }}
          onCancel={() => setRemove(null)}
        />
      )}
    </div>
  );
}

function CategoryModal({ value, onClose, onSave }: { value: IncidentCategory | null; onClose: () => void; onSave: (code: string, name: string) => void }) {
  const [code, setCode] = useState(value?.code ?? '');
  const [name, setName] = useState(value?.name ?? '');
  const [err, setErr] = useState('');

  const submit = () => {
    if (!code.trim()) return setErr('Укажите код: по нему тип отличается от остальных');
    if (!name.trim()) return setErr('Укажите название');
    onSave(code.trim().toUpperCase(), name.trim());
  };

  return (
    <Modal
      title={value ? 'Изменить тип происшествия' : 'Новый тип происшествия'}
      onClose={onClose}
      footer={
        <>
          <Button variant="success" className="h-10 px-4 text-[15px]" onClick={onClose}>
            отмена
          </Button>
          <Button variant="success" className="h-10 px-4 text-[15px] font-bold" onClick={submit}>
            сохранить
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {err && <Notice tone="bad">{err}</Notice>}
        <Input label="Код" hint="латиницей, например LIFT или GAS" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
        <Input label="Название" hint="как будет видно преподавателю" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      </div>
    </Modal>
  );
}
