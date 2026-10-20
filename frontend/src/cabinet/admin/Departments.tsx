import { useCallback, useEffect, useState } from 'react';
import { BACKEND_PERMISSIONS } from '../../api/auth';
import { createDepartment, deleteDepartment, listDepartments, updateDepartment, type Department } from '../../api/catalogs';
import { describeError } from '../../api/errors';
import { DDS_SERVICES } from '../../data/services';
import { useMe } from '../../store/session';
import { Button, ConfirmModal, Empty, Input, Modal, Notice, Panel, Table } from '../../ui';

/*
 * Подразделения — справочник на сервере (/api/departments). Подразделение определяет, за какую
 * дежурно-диспетчерскую службу работает обучающийся: по его коду рабочее место подставляет
 * нужные телефоны, ленту служб и классификатор. Без справочника всех обучающихся пришлось бы
 * держать на одной службе.
 */

type Loaded<T> = T | null | 'loading';

/** Коды служб, которые знает рабочее место: совпадение кода даёт обучающемуся её телефоны и ленту */
const KNOWN_CODES = new Set(DDS_SERVICES.map((s) => s.id));

async function load(): Promise<{ list: Department[] | null; error?: string }> {
  try {
    return { list: await listDepartments() };
  } catch (e) {
    return { list: null, error: describeError(e, 'Не удалось загрузить подразделения') };
  }
}

export function Departments() {
  const { info } = useMe();
  const [data, setData] = useState<Loaded<Department[]>>('loading');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [edit, setEdit] = useState<Department | 'new' | null>(null);
  const [remove, setRemove] = useState<Department | null>(null);

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
          Новое подразделение
        </Button>
        <Button onClick={() => void reload()}>Обновить</Button>
      </div>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {data === 'loading' && <Notice tone="neutral">Загрузка…</Notice>}
      {data === null && (
        <Notice tone="warn">
          Сервер не отдаёт подразделения (<code>GET /api/departments</code>).
        </Notice>
      )}
      {!canEdit && data !== null && <Notice tone="warn">У вашей роли нет права на правку справочников — он доступен только для просмотра.</Notice>}

      {Array.isArray(data) && (
        <Panel pad={false}>
          {rows.length === 0 ? (
            <div className="p-4">
              <Empty>Подразделений нет. Добавьте их — без подразделения обучающийся работает за службу по умолчанию.</Empty>
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Код</th>
                  <th>Название</th>
                  <th>Рабочее место</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td className="font-mono text-[13px]">{d.code}</td>
                    <td>{d.name}</td>
                    <td className="text-[12px] text-c-muted">
                      {KNOWN_CODES.has(d.code) ? 'своя служба на АРМ' : 'служба по умолчанию: код не совпал'}
                    </td>
                    <td>
                      {canEdit && (
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="secondary" onClick={() => setEdit(d)}>
                            Изменить
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => setRemove(d)}>
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
        <DepartmentModal
          value={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSave={(code, name) => {
            const target = edit;
            setEdit(null);
            void run(
              () => (target === 'new' ? createDepartment(code, name) : updateDepartment(target.id, code, name)),
              target === 'new' ? `Подразделение «${name}» добавлено` : `Подразделение «${name}» изменено`,
            );
          }}
        />
      )}

      {remove && (
        <ConfirmModal
          title="Удалить подразделение?"
          text={`«${remove.name}» исчезнет из справочника. Учётные записи останутся, но потеряют привязку к службе.`}
          confirm="удалить"
          danger
          onConfirm={() => {
            const target = remove;
            setRemove(null);
            void run(() => deleteDepartment(target.id), `Подразделение «${target.name}» удалено`);
          }}
          onCancel={() => setRemove(null)}
        />
      )}
    </div>
  );
}

function DepartmentModal({ value, onClose, onSave }: { value: Department | null; onClose: () => void; onSave: (code: string, name: string) => void }) {
  const [code, setCode] = useState(value?.code ?? '');
  const [name, setName] = useState(value?.name ?? '');
  const [err, setErr] = useState('');

  const submit = () => {
    const clean = code.trim().toLowerCase();
    if (!clean) return setErr('Укажите код службы');
    if (!/^[a-z0-9-]+$/.test(clean)) return setErr('Код латиницей: строчные буквы, цифры и дефис');
    if (!name.trim()) return setErr('Укажите название');
    onSave(clean, name.trim());
  };

  return (
    <Modal
      title={value ? 'Изменить подразделение' : 'Новое подразделение'}
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
        <Input
          label="Код службы"
          hint={`как в рабочем месте: ${DDS_SERVICES.map((s) => s.id).join(', ')}`}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
        />
        <Input label="Название" hint="как будет видно администратору и преподавателю" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
      </div>
    </Modal>
  );
}
