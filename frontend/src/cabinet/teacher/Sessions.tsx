import { useCallback, useEffect, useState } from 'react';
import type { PageResponse } from '../../api/admin';
import { describeError } from '../../api/errors';
import { listScenarios, type ScenarioRow } from '../../api/scenarios';
import {
  endSession,
  evaluateCard,
  getEvaluation,
  getSession,
  listSessions,
  startSession,
  type CardSummary,
  type Evaluation,
  type SessionDetails,
  type SessionDto,
} from '../../api/sessions';
import { listStudyGroups, type StudyGroupRow } from '../../api/teacher';
import { dateTime } from '../../domain/format';
import { useMe } from '../../store/session';
import { Badge, Button, Checkbox, ConfirmModal, Empty, Input, Modal, Notice, Panel, Select, Table, Textarea } from '../../ui';

/*
 * Занятия — через бэкенд (/api/sessions, ветка mvp).
 * Преподаватель выбирает группу и утверждённые сценарии, задаёт число карточек и разброс
 * интервалов между ними; сервер сам раздаёт карточки всем обучающимся группы.
 * В карточке занятия видны сданные работы, оценка ИИ и оценка преподавателя.
 */

type Loaded<T> = T | null | 'loading';

async function load(teacherId: string): Promise<{ list: PageResponse<SessionDto> | null; error?: string }> {
  try {
    return { list: await listSessions({ teacherId, size: 50 }) };
  } catch (e) {
    return { list: null, error: describeError(e, 'Не удалось загрузить занятия') };
  }
}

export function Sessions() {
  const { user } = useMe();
  const [data, setData] = useState<Loaded<PageResponse<SessionDto>>>('loading');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [endFor, setEndFor] = useState<SessionDto | null>(null);

  const apply = useCallback((r: Awaited<ReturnType<typeof load>>) => {
    setData(r.list);
    setMsg((m) => (r.error ? { tone: 'bad', text: r.error } : m?.tone === 'bad' ? null : m));
  }, []);

  const reload = useCallback(() => (user ? load(user.id).then(apply) : Promise.resolve()), [apply, user]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    void load(user.id).then((r) => alive && apply(r));
    return () => {
      alive = false;
    };
  }, [apply, user]);

  if (!user) return null;
  const rows = data !== null && data !== 'loading' ? data.content : [];

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setCreating(true)}>
          Новое занятие
        </Button>
        <Button onClick={() => void reload()}>Обновить</Button>
      </div>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {data === 'loading' && <Notice tone="neutral">Загрузка…</Notice>}
      {data === null && (
        <Notice tone="warn">
          Сервер не отдаёт занятия (<code>GET /api/sessions</code>). Методы готовы в ветке <code>mvp</code> — возможно, запущена сборка без них.
        </Notice>
      )}

      {data !== null && data !== 'loading' && (
        <Panel pad={false}>
          {rows.length === 0 ? (
            <div className="p-4">
              <Empty>Занятий нет. Создайте новое — карточки раздадутся всей группе.</Empty>
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Группа</th>
                  <th>Начато</th>
                  <th>Карточек</th>
                  <th>Интервал</th>
                  <th>Статус</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium">{s.studyGroupName ?? s.studyGroupId}</td>
                    <td className="text-[12px] whitespace-nowrap text-c-muted">{dateTime(s.startedAt)}</td>
                    <td className="text-center">{s.targetCardsCount ?? '—'}</td>
                    <td className="text-[12px] whitespace-nowrap text-c-muted">
                      {s.minIntervalSeconds != null && s.maxIntervalSeconds != null ? `${s.minIntervalSeconds}–${s.maxIntervalSeconds} с` : '—'}
                    </td>
                    <td>{s.active ? <Badge tone="ok">идёт</Badge> : <Badge tone="neutral">завершено</Badge>}</td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => setOpenId(s.id)}>
                          Работы
                        </Button>
                        {s.active && (
                          <Button size="sm" variant="danger" onClick={() => setEndFor(s)}>
                            Завершить
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      )}

      {creating && (
        <StartModal
          onClose={() => setCreating(false)}
          onStarted={(r) => {
            setCreating(false);
            setMsg({ tone: 'ok', text: `Занятие начато: обучающихся ${r.students}, карточек назначено ${r.cards}.` });
            void reload();
          }}
        />
      )}

      {openId && <SessionModal id={openId} onClose={() => setOpenId(null)} />}

      {endFor && (
        <ConfirmModal
          title="Завершить занятие?"
          text="Обучающиеся больше не смогут сдавать карточки. Уже сданные работы и оценки останутся."
          confirm="завершить"
          danger
          onConfirm={() => {
            const s = endFor;
            setEndFor(null);
            void run(() => endSession(s.id), 'Занятие завершено');
          }}
          onCancel={() => setEndFor(null)}
        />
      )}
    </div>
  );
}

function StartModal({ onClose, onStarted }: { onClose: () => void; onStarted: (r: { students: number; cards: number }) => void }) {
  const [groups, setGroups] = useState<StudyGroupRow[] | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioRow[] | null>(null);
  const [groupId, setGroupId] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [count, setCount] = useState(5);
  const [minSec, setMinSec] = useState(60);
  const [maxSec, setMaxSec] = useState(180);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    void listStudyGroups(0, 100).then(
      (p) => alive && setGroups(p ? p.content : null),
      () => alive && setGroups(null),
    );
    // в занятие идут только утверждённые сценарии
    void listScenarios({ status: 'APPROVED', size: 100 }).then(
      (p) => alive && setScenarios(p ? p.content : null),
      () => alive && setScenarios(null),
    );
    return () => {
      alive = false;
    };
  }, []);

  const chosenGroup = groupId || groups?.[0]?.id || '';

  const submit = async () => {
    if (!chosenGroup) return setErr('Выберите группу');
    if (!picked.length) return setErr('Отметьте хотя бы один сценарий');
    if (minSec > maxSec) return setErr('Минимальный интервал больше максимального');
    setBusy(true);
    setErr('');
    try {
      const r = await startSession({ studyGroupId: chosenGroup, scenarioIds: picked, targetCardsCount: count, minIntervalSeconds: minSec, maxIntervalSeconds: maxSec });
      onStarted({ students: r.totalStudentsAssigned, cards: r.totalCardsAssigned });
    } catch (e) {
      setErr(describeError(e, 'Не удалось начать занятие'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Новое занятие"
      width={640}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Запуск…' : 'Начать занятие'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {err && <Notice tone="bad">{err}</Notice>}

        {groups === null ? (
          <Notice tone="warn">Сервер не отдаёт учебные группы — занятие назначать некому.</Notice>
        ) : (
          <Select label="Группа" value={chosenGroup} onChange={(e) => setGroupId(e.target.value)}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <Input label="Карточек на обучающегося" type="number" min={1} max={50} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} />
          <Input label="Интервал от, с" type="number" min={0} value={minSec} onChange={(e) => setMinSec(Math.max(0, Number(e.target.value) || 0))} />
          <Input label="Интервал до, с" type="number" min={0} value={maxSec} onChange={(e) => setMaxSec(Math.max(0, Number(e.target.value) || 0))} />
        </div>

        <div>
          <div className="mb-1.5 text-[13px] font-medium">Сценарии занятия (только утверждённые)</div>
          {scenarios === null && <Notice tone="warn">Сервер не отдаёт банк сценариев.</Notice>}
          {scenarios?.length === 0 && <Notice tone="warn">Утверждённых сценариев нет — сначала утвердите их в банке.</Notice>}
          {!!scenarios?.length && (
            <div className="max-h-[220px] overflow-y-auto border border-c-line p-2">
              {scenarios.map((s) => (
                <Checkbox key={s.id} checked={picked.includes(s.id)} onChange={(v) => setPicked(v ? [...picked, s.id] : picked.filter((x) => x !== s.id))}>
                  {s.title}
                  <span className="text-c-muted"> · {s.categoryName ?? 'без категории'}</span>
                </Checkbox>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Карточка занятия: сданные работы, оценка ИИ и выставление оценки преподавателем */
function SessionModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<SessionDetails | null>(null);
  const [err, setErr] = useState('');
  const [scoreFor, setScoreFor] = useState<CardSummary | null>(null);

  const load = useCallback(
    () =>
      getSession(id).then(
        (d) => setData(d),
        (e: unknown) => setErr(describeError(e, 'Не удалось загрузить занятие')),
      ),
    [id],
  );

  useEffect(() => {
    let alive = true;
    void getSession(id).then(
      (d) => alive && setData(d),
      (e: unknown) => alive && setErr(describeError(e, 'Не удалось загрузить занятие')),
    );
    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <Modal
      title={data ? `Занятие: ${data.studyGroupName ?? ''}` : 'Занятие'}
      width={760}
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
        {data && !data.cards.length && <Notice tone="neutral">Сданных работ пока нет.</Notice>}
        {data && !!data.cards.length && (
          <Table>
            <thead>
              <tr>
                <th>Обучающийся</th>
                <th>Сценарий</th>
                <th>Время</th>
                <th>Норматив</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.cards.map((c) => (
                <tr key={c.id}>
                  <td>{c.studentName ?? c.studentId}</td>
                  <td className="text-[13px]">{c.scenarioTitle ?? '—'}</td>
                  <td className="text-[12px] whitespace-nowrap text-c-muted">{c.durationSeconds != null ? `${c.durationSeconds} с` : '—'}</td>
                  <td className={`text-[12px] whitespace-nowrap ${(c.timeDeltaSeconds ?? 0) > 0 ? 'text-c-bad' : 'text-c-muted'}`}>
                    {c.timeDeltaSeconds == null ? '—' : c.timeDeltaSeconds > 0 ? `+${c.timeDeltaSeconds} с` : 'в норматив'}
                  </td>
                  <td>{c.status === 'EVALUATED' ? <Badge tone="ok">оценена</Badge> : <Badge tone="warn">ждёт оценки</Badge>}</td>
                  <td>
                    <div className="flex justify-end">
                      <Button size="sm" variant="ghost" onClick={() => setScoreFor(c)}>
                        Оценка
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      {scoreFor && (
        <ScoreModal
          card={scoreFor}
          onClose={() => setScoreFor(null)}
          onSaved={() => {
            setScoreFor(null);
            void load();
          }}
        />
      )}
    </Modal>
  );
}

function ScoreModal({ card, onClose, onSaved }: { card: CardSummary; onClose: () => void; onSaved: () => void }) {
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [score, setScore] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    void getEvaluation(card.id).then(
      (e) => {
        if (!alive) return;
        setEvaluation(e);
        setScore(e.teacherScore != null ? String(e.teacherScore) : '');
        setComment(e.teacherComment ?? '');
      },
      () => alive && setEvaluation(null),
    );
    return () => {
      alive = false;
    };
  }, [card.id]);

  const save = async () => {
    const n = Number(score);
    if (!Number.isFinite(n) || n < 0 || n > 100) return setErr('Оценка — число от 0 до 100');
    setBusy(true);
    setErr('');
    try {
      await evaluateCard(card.id, n, comment.trim());
      onSaved();
    } catch (e) {
      setErr(describeError(e, 'Не удалось сохранить оценку'));
    } finally {
      setBusy(false);
    }
  };

  const errors = evaluation?.aiComplianceErrors ? Object.entries(evaluation.aiComplianceErrors) : [];

  return (
    <Modal
      title={`Оценка: ${card.studentName ?? ''}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Сохранение…' : 'Сохранить оценку'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {err && <Notice tone="bad">{err}</Notice>}
        {evaluation === null ? (
          <Notice tone="neutral">Оценка ИИ ещё не готова или недоступна — можно выставить свою.</Notice>
        ) : (
          <div className="border border-c-line p-3 text-[13px]">
            <div>
              <b>Оценка ИИ:</b> {evaluation.aiScore ?? '—'}
              {evaluation.finalScore != null && <span className="text-c-muted"> · итог {evaluation.finalScore}</span>}
            </div>
            {evaluation.aiRecommendations && <div className="mt-1 text-c-muted">{evaluation.aiRecommendations}</div>}
            {!!errors.length && (
              <ul className="mt-1 list-disc pl-5 text-c-muted">
                {errors.map(([k, v]) => (
                  <li key={k}>
                    {k}: {String(v)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <Input label="Оценка преподавателя (0–100)" type="number" min={0} max={100} value={score} onChange={(e) => setScore(e.target.value)} />
        <Textarea label="Комментарий" rows={4} value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
    </Modal>
  );
}
