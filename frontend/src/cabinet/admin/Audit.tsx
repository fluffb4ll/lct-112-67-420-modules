import { useState } from 'react';
import { useDb } from '../../api/db';
import { dateTime } from '../../domain/format';
import { Button, Input, Panel, Table } from '../../ui';
import { downloadCsv } from '../teacher/csv';

/** Журнал аудита действий пользователей (хранение — не менее 6 месяцев) */
export function Audit() {
  const records = useDb((s) => s.db.audit);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(100);
  const list = records.filter((r) => !q || `${r.userLogin} ${r.action} ${r.target ?? ''} ${r.details ?? ''}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Input placeholder="Фильтр: пользователь, действие, объект" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-[380px]" />
        <Button
          className="sm:ml-auto"
          onClick={() =>
            downloadCsv(
              'журнал-аудита.csv',
              ['Время', 'Пользователь', 'Действие', 'Объект', 'Подробности'],
              list.map((r) => [dateTime(r.at), r.userLogin, r.action, r.target ?? '', r.details ?? '']),
            )
          }
        >
          Выгрузить CSV
        </Button>
      </div>
      <Panel pad={false}>
        <Table>
          <thead>
            <tr>
              <th>Время</th>
              <th>Пользователь</th>
              <th>Действие</th>
              <th>Объект</th>
              <th>Подробности</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, limit).map((r) => (
              <tr key={r.id}>
                <td className="text-[12px] whitespace-nowrap text-c-muted">{dateTime(r.at)}</td>
                <td className="font-mono text-[13px]">{r.userLogin}</td>
                <td>{r.action}</td>
                <td className="text-[13px] text-c-muted">{r.target}</td>
                <td className="text-[13px] text-c-muted">{r.details}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        {list.length > limit && (
          <div className="p-3 text-center">
            <Button size="sm" onClick={() => setLimit(limit + 200)}>
              Показать ещё
            </Button>
          </div>
        )}
      </Panel>
    </div>
  );
}
