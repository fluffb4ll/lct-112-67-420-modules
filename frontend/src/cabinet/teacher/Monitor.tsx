import { useEffect, useState } from 'react';
import { describeError } from '../../api/errors';
import { getSession, listSessions, type SessionDetails, type SessionDto } from '../../api/sessions';
import { getStudyGroup } from '../../api/teacher';
import { useNow } from '../../app/hooks';
import { dateTime, mmss } from '../../domain/format';
import { useMe } from '../../store/session';
import { useCardEvaluations } from '../../training/cardEvaluations';
import { Badge, Button, Empty, Notice, Panel, Select, Table } from '../../ui';
import { monitorRows } from './monitorRows';
import { SessionModal } from './Sessions';

/*
 * Мониторинг идущих занятий по данным сервера: кто из группы сколько карточек сдал,
 * когда последняя сдача, средний итоговый балл и сколько работ ждёт оценки.
 * Обновляется опросом сервера; по обучающемуся — его работы и оценка преподавателя.
 */

const REFRESH_MS = 10_000;

export function Monitor() {
  const { user } = useMe();
  const teacherId = user?.id;
  const [running, setRunning] = useState<SessionDto[] | null>(null);
  const [listErr, setListErr] = useState('');
  const [sessionId, setSessionId] = useState('');

  useEffect(() => {
    if (!teacherId) return;
    let alive = true;
    const load = () =>
      listSessions({ teacherId, activeOnly: true, size: 50 }).then(
        (p) => {
          if (!alive) return;
          setRunning(p ? p.content : []);
          setListErr(p ? '' : 'Сервер занятий недоступен');
        },
        (e: unknown) => alive && setListErr(describeError(e, 'Не удалось загрузить занятия')),
      );
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [teacherId]);

  if (!user) return null;
  if (running === null)
    return <Panel>{listErr ? <Notice tone="bad">{listErr}</Notice> : <Notice tone="neutral">Загрузка…</Notice>}</Panel>;
  const session = running.find((s) => s.id === sessionId) ?? running[0];

  if (!session)
    return (
      <Panel>
        <Empty>Сейчас нет идущих занятий. Запустите занятие в разделе «Занятия».</Empty>
      </Panel>
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Занятие" value={session.id} onChange={(e) => setSessionId(e.target.value)} className="w-full sm:w-[420px]">
          {running.map((s) => (
            <option key={s.id} value={s.id}>
              {s.studyGroupName ?? 'Группа'} · с {dateTime(s.startedAt).slice(0, 16)}
            </option>
          ))}
        </Select>
        <Badge tone="ok">идёт</Badge>
      </div>
      {listErr && <Notice tone="warn">{listErr} — показаны последние полученные данные.</Notice>}
      <SessionMonitor key={session.id} session={session} />
    </div>
  );
}

function SessionMonitor({ session }: { session: SessionDto }) {
  const now = useNow(1000);
  const [data, setData] = useState<SessionDetails | null>(null);
  const [members, setMembers] = useState<{ id: string; fullName: string }[]>([]);
  const [err, setErr] = useState('');
  const [openStudent, setOpenStudent] = useState<string | null>(null);
  const evals = useCardEvaluations(data?.cards, true);

  useEffect(() => {
    let alive = true;
    // состав группы; не отдали — строим список по авторам сданных карточек
    void getStudyGroup(session.studyGroupId).then(
      (g) => alive && setMembers(g.users.filter((u) => u.role === 'ROLE_STUDENT')),
      () => undefined,
    );
    const load = () =>
      getSession(session.id).then(
        (d) => {
          if (!alive) return;
          setData(d);
          setErr('');
        },
        (e: unknown) => alive && setErr(describeError(e, 'Не удалось загрузить занятие')),
      );
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [session.id, session.studyGroupId]);

  const target = data?.targetCardsCount ?? session.targetCardsCount;
  const rows = data ? monitorRows(members, data.cards, evals) : [];
  const elapsed = (now - new Date(session.startedAt).getTime()) / 1000;

  return (
    <>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-c-muted">
        <span>идёт {mmss(Math.max(0, elapsed))}</span>
        {target != null && <span>карточек каждому: {target}</span>}
        {session.minIntervalSeconds != null && session.maxIntervalSeconds != null && (
          <span>
            интервал {session.minIntervalSeconds}–{session.maxIntervalSeconds} с
          </span>
        )}
        <span>обновляется каждые {REFRESH_MS / 1000} с</span>
      </div>
      {err && <Notice tone="bad">{err}</Notice>}
      <Panel pad={false}>
        {!data && !err && (
          <div className="p-4">
            <Notice tone="neutral">Загрузка…</Notice>
          </div>
        )}
        {data && rows.length === 0 && (
          <div className="p-4">
            <Empty>В группе нет обучающихся.</Empty>
          </div>
        )}
        {rows.length > 0 && (
          <Table>
            <thead>
              <tr>
                <th>Обучающийся</th>
                <th>Ход</th>
                <th className="text-right">Сдано</th>
                <th>Последняя сдача</th>
                <th className="text-right">Средний балл</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const all = target != null && r.submitted >= target;
                return (
                  <tr key={r.studentId}>
                    <td className="whitespace-nowrap font-medium">{r.name}</td>
                    <td>
                      <span className="flex flex-wrap items-center gap-1.5">
                        {all ? <Badge tone="ok">всё сдано</Badge> : r.submitted ? <Badge tone="accent">в работе</Badge> : <span className="text-c-muted">не сдавал</span>}
                        {r.awaiting > 0 && <Badge tone="warn">ждут оценки: {r.awaiting}</Badge>}
                      </span>
                    </td>
                    <td className="text-right tabular-nums">
                      {r.submitted}
                      {target != null && ` из ${target}`}
                    </td>
                    <td className="text-[13px] whitespace-nowrap text-c-muted">{r.lastSubmittedAt ? dateTime(r.lastSubmittedAt) : '—'}</td>
                    <td className="text-right font-medium tabular-nums">{r.avgScore ?? '—'}</td>
                    <td>
                      <div className="flex justify-end">
                        <Button size="sm" variant="ghost" disabled={!r.submitted} onClick={() => setOpenStudent(r.studentId)}>
                          Работы
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>
      {openStudent && <SessionModal id={session.id} studentId={openStudent} onClose={() => setOpenStudent(null)} />}
    </>
  );
}
