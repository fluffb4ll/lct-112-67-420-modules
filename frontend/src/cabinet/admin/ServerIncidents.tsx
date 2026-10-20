import { useCallback, useEffect, useState } from 'react';
import type { PageResponse } from '../../api/admin';
import { COMPONENT_LABELS, listSystemIncidents, SEVERITY_LABELS, type IncidentComponent, type IncidentSeverity, type SystemIncident } from '../../api/catalogs';
import { describeError } from '../../api/errors';
import { dateTime } from '../../domain/format';
import { Badge, Button, Notice, Panel, Select, Table } from '../../ui';

/*
 * Журнал системных сбоев с сервера (/api/admin/incidents): телефония, ИИ-сервис,
 * база данных и веб-сервер сообщают сюда об ошибках. Фильтры и постраничная навигация
 * выполняются на сервере.
 */

const SEVERITIES: IncidentSeverity[] = ['WARN', 'ERROR', 'FATAL'];
const COMPONENTS: IncidentComponent[] = ['ASTERISK', 'AI', 'DB', 'HTTP'];
const TONE: Record<IncidentSeverity, 'warn' | 'bad' | 'neutral'> = { WARN: 'warn', ERROR: 'bad', FATAL: 'bad' };

export function ServerIncidents() {
  const [data, setData] = useState<PageResponse<SystemIncident> | null>(null);
  const [severity, setSeverity] = useState<IncidentSeverity | ''>('');
  const [component, setComponent] = useState<IncidentComponent | ''>('');
  const [page, setPage] = useState(0);
  const [off, setOff] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<number | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await listSystemIncidents({ severity: severity || undefined, component: component || undefined, page });
      if (r === null) setOff(true);
      else setData(r);
    } catch (e) {
      setErr(describeError(e, 'Не удалось загрузить журнал сбоев'));
    }
  }, [severity, component, page]);

  useEffect(() => {
    let alive = true;
    void listSystemIncidents({ severity: severity || undefined, component: component || undefined, page }).then(
      (r) => {
        if (!alive) return;
        if (r === null) setOff(true);
        else setData(r);
      },
      (e: unknown) => alive && setErr(describeError(e, 'Не удалось загрузить журнал сбоев')),
    );
    return () => {
      alive = false;
    };
  }, [severity, component, page]);

  if (off) return null;

  const rows = data?.content ?? [];
  const pages = Math.max(data?.totalPages ?? 1, 1);

  return (
    <Panel
      title="Журнал системных сбоев (данные сервера)"
      pad={false}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={severity}
            className="w-[170px]"
            onChange={(e) => {
              setPage(0);
              setSeverity(e.target.value as IncidentSeverity | '');
            }}
          >
            <option value="">любая важность</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select
            value={component}
            className="w-[170px]"
            onChange={(e) => {
              setPage(0);
              setComponent(e.target.value as IncidentComponent | '');
            }}
          >
            <option value="">любой компонент</option>
            {COMPONENTS.map((c) => (
              <option key={c} value={c}>
                {COMPONENT_LABELS[c]}
              </option>
            ))}
          </Select>
          <Button size="sm" onClick={() => void reload()}>
            Обновить
          </Button>
        </div>
      }
    >
      {err && (
        <div className="p-3">
          <Notice tone="bad">{err}</Notice>
        </div>
      )}
      {!err && !rows.length && (
        <div className="p-3">
          <Notice tone="ok">Сбоев нет — за выбранный отбор сервер ничего не записал.</Notice>
        </div>
      )}
      {!!rows.length && (
        <>
          <Table>
            <thead>
              <tr>
                <th>Время</th>
                <th>Важность</th>
                <th>Компонент</th>
                <th>Сообщение</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className={i.stackTrace ? 'cursor-pointer hover:bg-c-bg' : ''} onClick={() => i.stackTrace && setOpen(open === i.id ? null : i.id)}>
                  <td className="text-[12px] whitespace-nowrap text-c-muted">{dateTime(i.createdAt)}</td>
                  <td>
                    <Badge tone={TONE[i.severity]}>{SEVERITY_LABELS[i.severity]}</Badge>
                  </td>
                  <td className="text-[13px]">{COMPONENT_LABELS[i.component]}</td>
                  <td className="text-[13px]">
                    {i.message}
                    {open === i.id && i.stackTrace && <pre className="mt-1 max-h-[200px] overflow-auto bg-c-bg p-2 text-[11px] whitespace-pre-wrap text-c-muted">{i.stackTrace}</pre>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="flex items-center justify-between gap-2 border-t border-c-line px-3 py-2 text-[12px] text-c-muted">
            <span>
              Страница {page + 1} из {pages} · всего {data?.totalElements ?? 0}
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
        </>
      )}
    </Panel>
  );
}
