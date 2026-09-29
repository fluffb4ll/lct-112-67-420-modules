import { useCallback, useEffect, useState } from 'react';
import { mutate } from '../../api/db';
import { describeError } from '../../api/errors';
import { fromDetails, getScenario } from '../../api/scenarios';
import { incomingCards, listSessions, type IncomingCard, type IncomingCardsStream } from '../../api/sessions';
import { navigate } from '../../app/router';
import type { User } from '../../domain/types';
import { useRun } from '../../store/training';
import { Badge, Button, Notice, Panel, Table } from '../../ui';

/*
 * Занятие, назначенное преподавателем на сервере (/api/sessions).
 * Обучающийся видит, сколько карточек уже сдал и когда придёт следующая;
 * пришедшую карточку можно принять — она открывается в эмуляторе АРМ,
 * а по завершении уходит на сервер вместе со временем работы.
 */

const POLL_MS = 10_000;

export function ServerLesson({ user, groupId }: { user: User; groupId: string | undefined }) {
  const [stream, setStream] = useState<IncomingCardsStream | null>(null);
  const [state, setState] = useState<'loading' | 'none' | 'ok' | 'off'>('loading');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const start = useRun((s) => s.start);

  const tick = useCallback(async () => {
    if (!groupId) {
      setState('none');
      return;
    }
    try {
      const page = await listSessions({ studyGroupId: groupId, activeOnly: true, size: 1 });
      if (page === null) {
        setState('off');
        return;
      }
      const session = page.content[0];
      if (!session) {
        setStream(null);
        setState('none');
        return;
      }
      setStream(await incomingCards(session.id));
      setState('ok');
    } catch (e) {
      setErr(describeError(e, 'Не удалось получить занятие'));
      setState('none');
    }
  }, [groupId]);

  useEffect(() => {
    let alive = true;
    const run = () => {
      if (alive) void tick();
    };
    run();
    const id = setInterval(run, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [tick]);

  const take = async (card: IncomingCard) => {
    if (!stream) return;
    setBusy(true);
    setErr('');
    try {
      // сценарий берём с сервера и кладём в локальные данные: на них работает сам эмулятор
      const sc = fromDetails(await getScenario(card.scenarioId));
      mutate((d) => {
        const i = d.scenarios.findIndex((x) => x.id === sc.id);
        if (i >= 0) d.scenarios[i] = sc;
        else d.scenarios.unshift(sc);
      });
      start({
        user,
        sessionId: stream.sessionId,
        title: `Занятие: ${card.title}`,
        mode: 'exam',
        scenarioIds: [card.scenarioId],
        fromServer: true,
        norms: card.timeLimitSeconds ? { totalSec: card.timeLimitSeconds, openSec: card.openLimitSeconds ?? undefined } : undefined,
      });
      navigate('/arm');
    } catch (e) {
      setErr(describeError(e, 'Не удалось открыть карточку'));
    } finally {
      setBusy(false);
    }
  };

  if (state === 'off') return null;

  const arrived = (stream?.incomingCards ?? []).filter((c) => c.arrivalOffsetSeconds <= (stream?.elapsedSeconds ?? 0));
  const waiting = arrived.filter((c) => !c.isSubmitted);

  return (
    <Panel
      title="Занятие от преподавателя"
      actions={
        stream && (
          <span className="text-[12px] text-c-muted">
            сдано {stream.cardsCompletedCount} из {stream.targetCardsCount}
            {stream.nextCardInSeconds != null && !stream.isSessionCompleted && ` · следующая через ${stream.nextCardInSeconds} с`}
          </span>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {err && <Notice tone="bad">{err}</Notice>}
        {state === 'loading' && <Notice tone="neutral">Проверяем, идёт ли занятие…</Notice>}
        {state === 'none' && !err && <Notice tone="neutral">Занятие сейчас не идёт. Можно тренироваться самостоятельно.</Notice>}
        {stream?.isSessionCompleted && <Notice tone="ok">Все карточки занятия сданы. Результаты проверит преподаватель.</Notice>}
        {state === 'ok' && !waiting.length && !stream?.isSessionCompleted && <Notice tone="neutral">Новых карточек пока нет — ждите вызова.</Notice>}
        {!!waiting.length && (
          <Table>
            <thead>
              <tr>
                <th>Карточка</th>
                <th>Норматив</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {waiting.map((c) => (
                <tr key={c.scenarioId}>
                  <td>
                    <div className="font-medium">{c.title}</div>
                    <div className="text-[12px] text-c-muted">{c.prompt}</div>
                  </td>
                  <td className="text-[12px] whitespace-nowrap text-c-muted">{c.timeLimitSeconds ? `${c.timeLimitSeconds} с` : '—'}</td>
                  <td>
                    <div className="flex justify-end">
                      <Button variant="primary" disabled={busy} onClick={() => void take(c)}>
                        Принять карточку
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {!!arrived.filter((c) => c.isSubmitted).length && (
          <div className="flex flex-wrap gap-1.5">
            {arrived
              .filter((c) => c.isSubmitted)
              .map((c) => (
                <Badge key={c.scenarioId} tone="ok">
                  сдано: {c.title}
                </Badge>
              ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
