import { useEffect, useState } from 'react';
import { downloadAnalyticsCsv, groupAnalytics, leaderboard, type GroupAnalytics, type LeaderboardEntry } from '../../api/analytics';
import { describeError } from '../../api/errors';
import { listStudyGroups, type StudyGroupRow } from '../../api/teacher';
import { Badge, Button, Notice, Panel, Select, Stat, Table } from '../../ui';
import { HBars } from '../../ui/charts';

/*
 * Отчётность по данным сервера (/api/analytics): сводка по группе, рейтинг обучающихся,
 * средние по навыкам, таблица лидеров и выгрузка CSV. Всё считает бэкенд.
 */

export function ServerReports() {
  const [groups, setGroups] = useState<StudyGroupRow[] | null>(null);
  const [groupId, setGroupId] = useState('');
  const [data, setData] = useState<GroupAnalytics | null>(null);
  const [board, setBoard] = useState<LeaderboardEntry[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void listStudyGroups(0, 100).then(
      (p) => alive && setGroups(p ? p.content : null),
      () => alive && setGroups(null),
    );
    void leaderboard().then(
      (b) => alive && setBoard(b),
      () => alive && setBoard(null),
    );
    return () => {
      alive = false;
    };
  }, []);

  const chosen = groupId || groups?.[0]?.id || '';

  useEffect(() => {
    if (!chosen) return;
    let alive = true;
    void groupAnalytics(chosen).then(
      (d) => alive && setData(d),
      (e: unknown) => {
        if (!alive) return;
        setData(null);
        setErr(describeError(e, 'Не удалось загрузить сводку по группе'));
      },
    );
    return () => {
      alive = false;
    };
  }, [chosen]);

  if (groups === null && board === null) return null;

  const skills = data?.skillsAverage ? Object.entries(data.skillsAverage) : [];

  const saveCsv = async () => {
    setBusy(true);
    setErr('');
    try {
      await downloadAnalyticsCsv(chosen || undefined);
    } catch (e) {
      setErr(describeError(e, 'Не удалось получить выгрузку'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {err && <Notice tone="bad">{err}</Notice>}

      <Panel
        title="Сводка по группе (данные сервера)"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {groups && (
              <Select value={chosen} onChange={(e) => setGroupId(e.target.value)} className="w-[240px]">
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            )}
            <Button disabled={busy} onClick={() => void saveCsv()}>
              {busy ? 'Выгрузка…' : 'Выгрузить CSV'}
            </Button>
          </div>
        }
      >
        {!data ? (
          <Notice tone="neutral">Нет данных по группе.</Notice>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <Stat label="Обучающихся" value={data.totalStudents} />
              <Stat label="Занятий" value={data.totalSessions} />
              <Stat label="Сдано карточек" value={data.totalCardsSubmitted} />
              <Stat label="Средний балл" value={Math.round(data.averageScore)} tone={data.averageScore >= 70 ? 'ok' : 'warn'} />
              <Stat label="Зачётов" value={`${Math.round(data.passedPercentage)} %`} sub={`среднее время ${Math.round(data.averageDurationSeconds)} с`} />
            </div>

            {!!skills.length && (
              <div>
                <div className="mb-1.5 text-[13px] font-medium">Средние по навыкам</div>
                <HBars items={skills.map(([label, value]) => ({ label, value: Math.round(value) }))} />
              </div>
            )}

            {!!data.studentStats.length && (
              <Table>
                <thead>
                  <tr>
                    <th>Обучающийся</th>
                    <th>Карточек</th>
                    <th>Средний балл</th>
                    <th>Итог</th>
                  </tr>
                </thead>
                <tbody>
                  {data.studentStats.map((s) => (
                    <tr key={s.studentId}>
                      <td>{s.fullName}</td>
                      <td className="text-center">{s.cardsSubmitted}</td>
                      <td className="text-center">{Math.round(s.averageScore)}</td>
                      <td>{s.isPassing ? <Badge tone="ok">зачёт</Badge> : <Badge tone="bad">не сдал</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </div>
        )}
      </Panel>

      {!!board?.length && (
        <Panel title="Таблица лидеров (данные сервера)" pad={false}>
          <Table>
            <thead>
              <tr>
                <th>Место</th>
                <th>Обучающийся</th>
                <th>Группа</th>
                <th>Карточек</th>
                <th>Средний балл</th>
              </tr>
            </thead>
            <tbody>
              {board.map((e) => (
                <tr key={e.studentId}>
                  <td className="text-center font-medium">{e.rank}</td>
                  <td>{e.fullName}</td>
                  <td className="text-c-muted">{e.groupName ?? '—'}</td>
                  <td className="text-center">{e.cardsCompleted}</td>
                  <td className="text-center">{Math.round(e.averageScore)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}
    </div>
  );
}
