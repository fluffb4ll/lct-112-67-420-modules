import { useMemo, useState } from 'react';
import { useDb } from '../../api/db';
import { useNow } from '../../app/hooks';
import { calibration, CHECK_TITLES, dailyScores, done, errorMatrix, finalScore, groupInsights, studentRows } from '../../domain/analytics';
import { SKILL_LABELS } from '../../domain/skills';
import type { Attempt, User } from '../../domain/types';
import { useMe } from '../../store/session';
import { Badge, Button, Modal, Panel, Select, Stat, Table } from '../../ui';
import { Calibration, HBars, Heatmap, LineChart } from '../../ui/charts';
import { AttemptDetails } from '../shared/AttemptDetails';
import { downloadCsv } from './csv';
import { ServerReports } from './ServerReports';

/*
 * Отчётность преподавателя (ТЗ + Q&A п. 23–24): рейтинг команд, рейтинг обучающихся
 * (место, баллы, ошибки, уровень подготовленности), динамика, тепловая карта ошибок,
 * инсайты ИИ по типичным ошибкам группы, достоверность прогноза. Экспорт — CSV для Excel и печать в PDF.
 */

export function Reports() {
  const { user } = useMe();
  const db = useDb((s) => s.db);
  const [groupId, setGroupId] = useState('all');
  const [days, setDays] = useState(14);
  const [student, setStudent] = useState<User | null>(null);
  const now = useNow(60_000);

  const scMap = useMemo(() => new Map(db.scenarios.map((s) => [s.id, s])), [db.scenarios]);
  const groups = db.groups.filter((g) => g.teacherId === user?.id);
  const since = now - days * 86400_000;
  const members = db.users.filter((u) => u.groupId && groups.some((g) => g.id === u.groupId) && (groupId === 'all' || u.groupId === groupId));
  const memberIds = new Set(members.map((m) => m.id));
  const attempts = done(db.attempts).filter((a) => memberIds.has(a.studentId) && new Date(a.startedAt).getTime() >= since);

  const rows = studentRows(members, attempts, scMap)
    .filter((r) => r.attempts > 0)
    .sort((a, b) => b.avgScore - a.avgScore);
  const shownGroups = groups.filter((g) => groupId === 'all' || g.id === groupId);
  const teamRating = shownGroups
    .map((g) => {
      const list = attempts.filter((a) => db.users.find((u) => u.id === a.studentId)?.groupId === g.id);
      return { g, avg: list.length ? list.reduce((s, a) => s + finalScore(a), 0) / list.length : 0, n: list.length };
    })
    .sort((a, b) => b.avg - a.avg);
  const daily = dailyScores(
    attempts,
    shownGroups.map((g) => ({ id: g.id, name: g.name.replace(/\s*\(.*\)/, ''), members: new Set(db.users.filter((u) => u.groupId === g.id).map((u) => u.id)) })),
    days,
  );
  const matrix = errorMatrix(attempts, scMap);
  const cal = calibration(attempts);
  const insights = groupInsights(attempts, scMap);
  const avgScore = attempts.length ? Math.round(attempts.reduce((s, a) => s + finalScore(a), 0) / attempts.length) : 0;
  const passRate = attempts.length ? Math.round((attempts.filter((a) => a.evaluation!.passed).length / attempts.length) * 100) : 0;
  const avgOpen = attempts.length ? Math.round(attempts.reduce((s, a) => s + (a.evaluation!.openSec ?? 60), 0) / attempts.length) : 0;

  const exportCsv = () =>
    downloadCsv(
      'рейтинг-обучающихся.csv',
      ['Место', 'ФИО', 'Группа', 'Попыток', 'Средний балл', 'Зачтено, %', 'Ошибок', 'Открытие, с', 'Уровень подготовки', 'Индекс', 'Слабый навык'],
      rows.map((r, i) => [
        i + 1,
        r.user.fullName,
        db.groups.find((g) => g.id === r.user.groupId)?.name ?? '',
        r.attempts,
        r.avgScore,
        r.passRate,
        r.errors,
        r.avgOpenSec,
        r.level,
        r.readiness,
        SKILL_LABELS[r.weakest],
      ]),
    );

  return (
    <div className="flex flex-col gap-4">
      <ServerReports />
      <div className="no-print flex flex-wrap items-end gap-3">
        <Select label="Группа" value={groupId} onChange={(e) => setGroupId(e.target.value)} className="w-full sm:w-[300px]">
          <option value="all">Все мои группы</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
        <Select label="Период" value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-[180px]">
          <option value={7}>7 дней</option>
          <option value={14}>14 дней</option>
          <option value={30}>30 дней</option>
        </Select>
        <div className="ml-auto flex gap-2">
          <Button onClick={exportCsv}>Выгрузить CSV (Excel)</Button>
          <Button onClick={() => window.print()}>Печать / PDF</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Завершённых карточек" value={attempts.length} />
        <Stat label="Средний балл" value={avgScore || '—'} />
        <Stat label="Зачтено" value={attempts.length ? `${passRate}%` : '—'} />
        <Stat label="Открытие карточки" value={attempts.length ? `${avgOpen} с` : '—'} sub="в среднем, норматив 30 с" tone={avgOpen > 30 ? 'warn' : undefined} />
        <Stat label="Точность прогноза" value={cal.n ? `${Math.round(cal.accuracy * 100)}%` : '—'} sub={`зачёт/незачёт, n = ${cal.n}`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <Panel title="Рейтинг команд">
          {teamRating.length === 0 ? (
            <p className="text-sm text-c-muted">Нет данных.</p>
          ) : (
            <>
              <HBars items={teamRating.map((t, i) => ({ label: `${i + 1}. ${t.g.name.replace(/\s*\(.*\)/, '')}`, value: t.avg, hint: `${Math.round(t.avg)} баллов, ${t.n} карточек` }))} />
              <p className="mt-3 text-[12px] text-c-muted">Средний балл по завершённым карточкам за период.</p>
            </>
          )}
        </Panel>
        <Panel title="Динамика среднего балла по дням">
          <LineChart series={daily.series} xLabels={daily.labels} />
        </Panel>
      </div>

      <Panel title="Рейтинг обучающихся" pad={false}>
        <Table>
          <thead>
            <tr>
              <th>Место</th>
              <th>Обучающийся</th>
              <th>Группа</th>
              <th className="text-right">Карточек</th>
              <th className="text-right">Средний балл</th>
              <th className="text-right">Зачтено</th>
              <th className="text-right">Ошибок</th>
              <th className="text-right">Открытие</th>
              <th>Подготовленность</th>
              <th>Слабый навык</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.user.id} className="cursor-pointer hover:bg-c-bg" onClick={() => setStudent(r.user)}>
                <td className="font-medium">{i + 1}</td>
                <td className="font-medium whitespace-nowrap">{r.user.fullName}</td>
                <td className="text-[12px] text-c-muted">{db.groups.find((g) => g.id === r.user.groupId)?.name.replace(/\s*\(.*\)/, '')}</td>
                <td className="text-right tabular-nums">{r.attempts}</td>
                <td className="text-right font-medium tabular-nums">{r.avgScore}</td>
                <td className="text-right tabular-nums">{r.passRate}%</td>
                <td className="text-right tabular-nums">{r.errors}</td>
                <td className={`text-right tabular-nums ${r.avgOpenSec > 30 ? 'text-c-bad' : ''}`}>{r.avgOpenSec} с</td>
                <td className="whitespace-nowrap">
                  <span className="mr-1.5 tabular-nums">{r.readiness}</span>
                  <span className="text-[12px] text-c-muted">{r.level}</span>
                </td>
                <td className="text-[12px]">{SKILL_LABELS[r.weakest]}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <Panel title="Тепловая карта ошибок: категория происшествия × тип ошибки">
        <Heatmap
          rows={matrix.rows}
          cols={matrix.cols.map((c) => CHECK_TITLES[c])}
          value={(r, c) => {
            const id = matrix.cols.find((x) => CHECK_TITLES[x] === c)!;
            return matrix.cell(r, id)?.rate ?? null;
          }}
          detail={(r, c) => {
            const id = matrix.cols.find((x) => CHECK_TITLES[x] === c)!;
            const cell = matrix.cell(r, id);
            return cell ? `${r} · ${c}: ошибка в ${cell.bad} из ${cell.n} попыток` : `${r} · ${c}: нет данных`;
          }}
          legend="доля попыток с ошибкой данного типа"
        />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Инсайты ИИ по типичным ошибкам группы">
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            {insights.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Panel>
        <Panel title="Достоверность прогноза подготовленности">
          <Calibration bins={cal.bins} />
          <p className="mt-3 text-[13px] text-c-muted">
            Оценка Брайера: <b className="text-c-text">{cal.brier.toFixed(3)}</b> (наивный прогноз «средняя доля зачётов» — {cal.brierBaseline.toFixed(3)}; меньше — лучше). Точность классификации
            «зачёт/незачёт»: <b className="text-c-text">{Math.round(cal.accuracy * 100)}%</b>.
          </p>
        </Panel>
      </div>

      {student && <StudentHistory student={student} attempts={attempts.filter((a) => a.studentId === student.id)} onClose={() => setStudent(null)} />}
    </div>
  );
}

function StudentHistory({ student, attempts, onClose }: { student: User; attempts: Attempt[]; onClose: () => void }) {
  const { user } = useMe();
  const db = useDb((s) => s.db);
  const [open, setOpen] = useState<Attempt | null>(null);
  if (open) return <AttemptDetails attempt={db.attempts.find((a) => a.id === open.id) ?? open} onClose={() => setOpen(null)} reviewer={user ?? undefined} />;
  const list = [...attempts].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return (
    <Modal title={student.fullName} onClose={onClose} width={760}>
      <Table>
        <thead>
          <tr>
            <th>Дата</th>
            <th>Карточка</th>
            <th className="text-right">Балл</th>
            <th>Итог</th>
            <th className="text-right">Прогноз</th>
          </tr>
        </thead>
        <tbody>
          {list.map((a) => (
            <tr key={a.id} className="cursor-pointer hover:bg-c-bg" onClick={() => setOpen(a)}>
              <td className="whitespace-nowrap">{new Date(a.startedAt).toLocaleDateString('ru-RU')}</td>
              <td>{db.scenarios.find((s) => s.id === a.scenarioId)?.title}</td>
              <td className="text-right font-medium tabular-nums">{finalScore(a)}</td>
              <td>
                <Badge tone={a.evaluation!.passed ? 'ok' : 'bad'}>{a.evaluation!.passed ? 'зачёт' : 'незачёт'}</Badge>
              </td>
              <td className="text-right tabular-nums">{Math.round(a.evaluation!.predicted * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Modal>
  );
}
