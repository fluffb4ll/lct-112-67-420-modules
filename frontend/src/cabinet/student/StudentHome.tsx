import { useEffect, useMemo, useState } from 'react';
import { clearLive, markRead } from '../../api';
import { useDb } from '../../api/db';
import { navigate, useRoute } from '../../app/router';
import { IcBook, IcChart, IcList } from '../../arm/icons';
import { serviceById } from '../../data/services';
import { finalScore } from '../../domain/analytics';
import { dateTime, ddmmyyyy } from '../../domain/format';
import { computeRatings, readiness, recommendDifficulty, SKILL_ADVICE, SKILL_LABELS, SKILLS, weakestSkill } from '../../domain/skills';
import type { Attempt, Scenario, TrainingMode } from '../../domain/types';
import { useMe } from '../../store/session';
import { useRun } from '../../store/training';
import { MODE_DESCRIPTIONS, MODE_LABELS } from '../../training/labels';
import { Badge, Button, Empty, Notice, Panel, Stat, Table } from '../../ui';
import { HBars } from '../../ui/charts';
import { CabinetLayout } from '../CabinetLayout';
import { AttemptDetails } from '../shared/AttemptDetails';
import { Handbook } from './Handbook';
import { ServerLesson } from './ServerLesson';
import { ServerProfile } from './ServerProfile';

/*
 * Кабинет обучающегося: назначенные занятия, самостоятельная тренировка по рекомендации ИИ,
 * собственные результаты и прогресс, справочные материалы. Чужие результаты недоступны (ТЗ).
 */

export function StudentHome() {
  const route = useRoute();
  const tab = route[1] ?? 'lessons';
  const { user, info } = useMe();
  const db = useDb((s) => s.db);
  const start = useRun((s) => s.start);
  const [details, setDetails] = useState<Attempt | null>(null);

  const scMap = useMemo(() => new Map(db.scenarios.map((s) => [s.id, s])), [db.scenarios]);
  const hasStaleLive = !!user && db.live.some((l) => l.studentId === user.id);

  // занятие прервано (закрыта вкладка, перезагрузка) — убираем «в работе» из мониторинга преподавателя
  useEffect(() => {
    if (user && hasStaleLive && !useRun.getState().active) clearLive(user.id);
  }, [user, hasStaleLive]);

  if (!user) return null;
  const service = serviceById(user.serviceId);
  const mine = db.attempts.filter((a) => a.studentId === user.id && a.evaluation).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const ratings = computeRatings(mine, scMap);
  const ready = readiness(ratings);
  const weak = weakestSkill(ratings);
  const sessions = db.sessions.filter((s) => s.groupId === user.groupId && s.status !== 'finished');
  const messages = db.messages.filter((m) => m.to === user.id && !m.read);

  const assignedIds = new Set(db.sessions.filter((s) => s.groupId === user.groupId).flatMap((s) => s.scenarioIds));
  const pool = db.scenarios.filter((s) => s.status === 'approved' && s.serviceKind === service.kind && assignedIds.has(s.id));
  const diff = recommendDifficulty(ratings, weak);
  const recommended = [...pool]
    .sort((a, b) => Number(b.skills.includes(weak)) - Number(a.skills.includes(weak)) || Math.abs(a.difficulty - diff) - Math.abs(b.difficulty - diff))
    .slice(0, 3);

  const run = (title: string, mode: TrainingMode, ids: string[], sessionId: string | null, norms?: { openSec: number; totalSec: number; passScore: number }) => {
    start({ user, sessionId, title, mode, scenarioIds: ids, norms });
    navigate('/arm');
  };

  const nav = [
    { id: 'lessons', label: 'занятия', path: '/student', icon: IcList },
    { id: 'results', label: 'результаты', path: '/student/results', icon: IcChart },
    { id: 'help', label: 'справка', path: '/student/help', icon: IcBook },
  ];

  const titles: Record<string, string> = { lessons: 'Занятия', results: 'Мои результаты', help: 'Справочные материалы' };

  return (
    <CabinetLayout nav={nav} active={tab} title={titles[tab] ?? 'Занятия'}>
      {messages.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn">
            {messages.map((m) => (
              <div key={m.id}>
                <b>Преподаватель:</b> {m.text}
              </div>
            ))}
            <button className="mt-1 text-[13px] underline" onClick={() => markRead(messages.map((m) => m.id))}>
              Прочитано
            </button>
          </Notice>
        </div>
      )}

      {tab === 'lessons' && (
        <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
          <div className="flex flex-col gap-4">
            <ServerLesson user={user} groupId={info?.studyGroups?.[0]?.id ?? user.groupId} />
            <Panel title="Занятия группы">
              {sessions.length === 0 && <Empty>Сейчас нет назначенных занятий.</Empty>}
              <div className="flex flex-col gap-3">
                {sessions.map((s) => {
                  const done = db.attempts.filter((a) => a.sessionId === s.id && a.studentId === user.id && a.evaluation).length;
                  return (
                    <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 border border-c-line p-3">
                      <div className="min-w-0">
                        <div className="font-medium">{s.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-c-muted">
                          <Badge tone="accent">{MODE_LABELS[s.mode]}</Badge>
                          <span>
                            {s.scenarioIds.length} карт. · открыть за {s.normOpenSec} с · отработать за {s.normTotalSec / 60} мин
                          </span>
                          {done > 0 && <span>· пройдено попыток: {done}</span>}
                        </div>
                        <div className="mt-1 text-[12px] text-c-muted">{MODE_DESCRIPTIONS[s.mode]}</div>
                      </div>
                      {s.status === 'running' ? (
                        <Button variant="primary" onClick={() => run(s.title, s.mode, s.scenarioIds, s.id, { openSec: s.normOpenSec, totalSec: s.normTotalSec, passScore: s.passScore })}>
                          Начать
                        </Button>
                      ) : (
                        <Badge>Ожидает старта преподавателем</Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            </Panel>

            <Panel title="Самостоятельная тренировка">
              <p className="text-sm text-c-muted">
                ИИ подобрал карточки по вашему самому слабому навыку — <b className="text-c-text">«{SKILL_LABELS[weak]}»</b>, сложность {diff}. {SKILL_ADVICE[weak]}
              </p>
              <ul className="mt-3 flex flex-col gap-2 text-sm">
                {recommended.map((s: Scenario) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 bg-c-bg px-3 py-2">
                    <span>{s.title}</span>
                    <span className="shrink-0 text-[12px] text-c-muted">сложность {s.difficulty}</span>
                  </li>
                ))}
              </ul>
              {recommended.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="primary" onClick={() => run('Самостоятельная тренировка', 'practice', recommended.map((s) => s.id), null)}>
                    Начать тренировку
                  </Button>
                  <span className="self-center text-[12px] text-c-muted">Режим «Обучение», с подсказками ИИ</span>
                </div>
              )}
            </Panel>
          </div>

          <div className="flex flex-col gap-4">
            <Panel title="Уровень подготовки">
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-medium">{ready.index}</span>
                <span className="text-sm text-c-muted">из 100 · {ready.level}</span>
              </div>
              <p className="mt-1 text-[12px] text-c-muted">Оценка по рейтингу навыков (модель Эло), пересчитывается после каждой карточки.</p>
              <div className="mt-4">
                <HBars
                  items={SKILLS.map((s) => ({ label: SKILL_LABELS[s], value: Math.max(0, Math.min(100, Math.round(((ratings[s] - 850) / 400) * 100))) }))}
                  format={(v) => String(v)}
                />
              </div>
            </Panel>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Попыток" value={mine.length} />
              <Stat label="Средний балл" value={mine.length ? Math.round(mine.reduce((s, a) => s + finalScore(a), 0) / mine.length) : '—'} />
              <Stat label="Зачтено" value={mine.length ? `${Math.round((mine.filter((a) => a.evaluation!.passed).length / mine.length) * 100)}%` : '—'} />
              <Stat label="Открытие, среднее" value={mine.length ? `${Math.round(mine.reduce((s, a) => s + (a.evaluation!.openSec ?? 60), 0) / mine.length)} с` : '—'} sub="норматив 30 с" />
            </div>
          </div>
        </div>
      )}

      {tab === 'results' && (
        <div className="mb-4">
          <ServerProfile studentId={user.id} />
        </div>
      )}
      {tab === 'results' && (
        <Panel title={`Попытки (${mine.length})`} pad={false}>
          {mine.length === 0 ? (
            <div className="p-4">
              <Empty>Результатов пока нет.</Empty>
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Карточка</th>
                  <th>Режим</th>
                  <th className="text-right">Балл</th>
                  <th>Итог</th>
                  <th className="text-right">Открытие</th>
                  <th className="text-right">Отработка</th>
                  <th className="text-right">Прогноз</th>
                  <th>Преподаватель</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((a) => (
                  <tr key={a.id} className="cursor-pointer hover:bg-c-bg" onClick={() => setDetails(a)}>
                    <td className="whitespace-nowrap">{ddmmyyyy(a.startedAt)}</td>
                    <td>{scMap.get(a.scenarioId)?.title ?? a.scenarioId}</td>
                    <td className="whitespace-nowrap">{MODE_LABELS[a.mode]}</td>
                    <td className="text-right font-medium tabular-nums">{finalScore(a)}</td>
                    <td>
                      <Badge tone={a.evaluation!.passed ? 'ok' : 'bad'}>{a.evaluation!.passed ? 'зачёт' : 'незачёт'}</Badge>
                    </td>
                    <td className="text-right tabular-nums">{a.evaluation!.openSec === null ? '—' : `${Math.round(a.evaluation!.openSec)} с`}</td>
                    <td className="text-right tabular-nums">{Math.round(a.evaluation!.totalSec)} с</td>
                    <td className="text-right tabular-nums">{Math.round(a.evaluation!.predicted * 100)}%</td>
                    <td className="max-w-[240px] truncate text-c-muted" title={a.review?.comment}>
                      {a.review ? `${dateTime(a.review.at).slice(0, 10)}: ${a.review.comment}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      )}

      {tab === 'help' && <Handbook />}

      {details && <AttemptDetails attempt={details} onClose={() => setDetails(null)} />}
    </CabinetLayout>
  );
}
