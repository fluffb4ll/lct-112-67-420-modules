import { useState } from 'react';
import { sendMessage } from '../../api';
import { useDb } from '../../api/db';
import { useNow } from '../../app/hooks';
import { finalScore } from '../../domain/analytics';
import { mmss } from '../../domain/format';
import type { Attempt, TrainingSession, User } from '../../domain/types';
import { useMe } from '../../store/session';
import { MODE_LABELS } from '../../training/labels';
import { Badge, Button, Empty, Modal, Notice, Panel, Select, Table, Textarea } from '../../ui';
import { cx } from '../../ui/cx';
import { AttemptDetails } from '../shared/AttemptDetails';

/*
 * Мониторинг занятия в реальном времени: кто на какой карточке, сколько прошло времени,
 * какой статус проставлен, идёт ли доклад. Обратная связь обучающемуся и экспертная оценка.
 * В мок-режиме обновление приходит из других вкладок браузера; на сервере — через WebSocket.
 */

export function Monitor() {
  const { user } = useMe();
  const db = useDb((s) => s.db);
  const now = useNow(1000);
  const running = db.sessions.filter((s) => s.teacherId === user?.id && s.status === 'running');
  const [sessionId, setSessionId] = useState(running[0]?.id ?? '');
  const [writeTo, setWriteTo] = useState<User | null>(null);
  const [openStudent, setOpenStudent] = useState<User | null>(null);
  if (!user) return null;
  const session = running.find((s) => s.id === sessionId) ?? running[0];

  if (!session)
    return (
      <Panel>
        <Empty>Сейчас нет идущих занятий. Запустите занятие в разделе «Занятия».</Empty>
      </Panel>
    );

  const members = db.users.filter((u) => u.groupId === session.groupId);
  const attempts = db.attempts.filter((a) => a.sessionId === session.id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Занятие" value={session.id} onChange={(e) => setSessionId(e.target.value)} className="w-full sm:w-[420px]">
          {running.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </Select>
        <Badge tone="accent">{MODE_LABELS[session.mode]}</Badge>
        <span className="text-sm text-c-muted">
          {db.groups.find((g) => g.id === session.groupId)?.name} · {session.scenarioIds.length} карточек
        </span>
      </div>
      <Notice tone="neutral">Обновляется в реальном времени. Для проверки без сервера откройте обучающегося в соседней вкладке браузера (демо-вход «Обучающийся») и начните это занятие.</Notice>
      <Panel pad={false}>
        <Table>
          <thead>
            <tr>
              <th>Обучающийся</th>
              <th>Сейчас</th>
              <th>Карточка</th>
              <th className="text-right">Прошло</th>
              <th>Статус службы</th>
              <th className="text-right">Готово</th>
              <th className="text-right">Средний балл</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const live = db.live.find((l) => l.studentId === m.id && l.sessionId === session.id);
              const done = attempts.filter((a) => a.studentId === m.id && a.evaluation);
              const avg = done.length ? Math.round(done.reduce((s, a) => s + finalScore(a), 0) / done.length) : null;
              const fresh = live && now - new Date(live.updatedAt).getTime() < 10 * 60_000;
              const elapsed = live ? (now - new Date(live.arrivedAt).getTime()) / 1000 : 0;
              const notOpened = live && !live.openedAt;
              return (
                <tr key={m.id} className={cx(live && fresh && 'bg-[#f6fbf7]')}>
                  <td className="whitespace-nowrap">
                    <button className="font-medium hover:underline" onClick={() => setOpenStudent(m)}>
                      {m.fullName}
                    </button>
                  </td>
                  <td>
                    {live && fresh ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge tone="ok">в работе</Badge>
                        {live.inCall && <Badge tone="accent">доклад по телефону</Badge>}
                        {notOpened && elapsed > session.normOpenSec && <Badge tone="bad">не открыта {Math.round(elapsed)} с</Badge>}
                      </span>
                    ) : done.length ? (
                      <Badge>вне занятия</Badge>
                    ) : (
                      <span className="text-c-muted">не начинал</span>
                    )}
                  </td>
                  <td className="text-[13px]">{live && fresh ? `${live.cardIndex}/${live.cardCount} · ${live.scenarioTitle}` : '—'}</td>
                  <td className={cx('text-right tabular-nums', live && fresh && elapsed > session.normTotalSec && 'text-c-bad')}>{live && fresh ? mmss(elapsed) : '—'}</td>
                  <td className="text-[13px]">{live && fresh ? live.lastStatus ?? (live.openedAt ? 'Получена службой' : 'Добавлена') : '—'}</td>
                  <td className="text-right tabular-nums">{done.length}</td>
                  <td className="text-right font-medium tabular-nums">{avg ?? '—'}</td>
                  <td>
                    <Button size="sm" variant="ghost" onClick={() => setWriteTo(m)}>
                      Написать
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Panel>
      {writeTo && <MessageModal to={writeTo} onClose={() => setWriteTo(null)} />}
      {openStudent && <StudentAttempts student={openStudent} session={session} onClose={() => setOpenStudent(null)} />}
    </div>
  );
}

function MessageModal({ to, onClose }: { to: User; onClose: () => void }) {
  const { user } = useMe();
  const [text, setText] = useState('');
  if (!user) return null;
  return (
    <Modal
      title={`Сообщение: ${to.fullName}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            disabled={!text.trim()}
            onClick={() => {
              sendMessage(user, to.id, text.trim());
              onClose();
            }}
          >
            Отправить
          </Button>
        </>
      }
    >
      <Textarea label="Текст" value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Например: обратите внимание на комментарий к «Не принята» — куда передана информация?" />
      <p className="mt-2 text-[12px] text-c-muted">Сообщение появится у обучающегося на панели тренажёра и в кабинете.</p>
    </Modal>
  );
}

function StudentAttempts({ student, session, onClose }: { student: User; session: TrainingSession; onClose: () => void }) {
  const { user } = useMe();
  const db = useDb((s) => s.db);
  const [open, setOpen] = useState<Attempt | null>(null);
  const list = db.attempts.filter((a) => a.studentId === student.id && a.sessionId === session.id && a.evaluation);
  if (open) return <AttemptDetails attempt={db.attempts.find((a) => a.id === open.id) ?? open} onClose={() => setOpen(null)} reviewer={user ?? undefined} />;
  return (
    <Modal title={`${student.fullName}: ${session.title}`} onClose={onClose} width={720}>
      {list.length === 0 ? (
        <Empty>Завершённых карточек нет.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Карточка</th>
              <th className="text-right">Балл</th>
              <th>Итог</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id}>
                <td>{db.scenarios.find((s) => s.id === a.scenarioId)?.title}</td>
                <td className="text-right font-medium tabular-nums">{finalScore(a)}</td>
                <td>
                  <Badge tone={a.evaluation!.passed ? 'ok' : 'bad'}>{a.evaluation!.passed ? 'зачёт' : 'незачёт'}</Badge>
                </td>
                <td className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setOpen(a)}>
                    Разбор и оценка
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Modal>
  );
}
