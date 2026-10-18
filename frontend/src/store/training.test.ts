import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Итоговый статус («Работы завершены», «Отказ от выполнения работ») карточку не закрывает:
// после него обучающийся докладывает руководителю и сам нажимает «Завершить карточку».

vi.mock('../training/sounds', () => ({ chime: vi.fn(), blip: vi.fn() }));
vi.mock('../api/sessions', () => ({ submitCard: vi.fn(async () => ({ cardId: 'card-1' })) }));

const { getDb } = await import('../api/db');
const { serviceById } = await import('../data/services');
const { submitCard } = await import('../api/sessions');
const { useRun } = await import('./training');

const status = { orderNo: '', comment: 'Работы выполнены.', typedChars: 17, typingMs: 3000 };

function begin(opts: { mode?: 'practice' | 'exam'; fromServer?: boolean } = {}) {
  const db = getDb();
  const scenario = db.scenarios.find((s) => s.status === 'approved')!;
  const user = db.users.find((u) => u.serviceId && serviceById(u.serviceId).kind === scenario.serviceKind)!;
  useRun.getState().start({
    user,
    sessionId: opts.fromServer ? 'session-1' : null,
    title: 'Тест',
    mode: opts.mode ?? 'practice',
    scenarioIds: [scenario.id],
    fromServer: opts.fromServer,
  });
  vi.advanceTimersByTime(2500);
  const run = useRun.getState();
  const incidentId = run.current!.incidentId;
  run.openIncident(incidentId);
  return { incidentId, chief: run.service.contacts.find((c) => c.isChief)! };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  useRun.getState().exit();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('итоговый статус карточки', () => {
  it.each(['Работы завершены', 'Отказ от выполнения работ'] as const)('«%s» не закрывает карточку сам', (final) => {
    const { incidentId } = begin();
    useRun.getState().setStatus(incidentId, { ...status, status: 'Принята' });
    useRun.getState().setStatus(incidentId, { ...status, status: final });
    vi.advanceTimersByTime(60_000);
    const run = useRun.getState();
    expect(run.current?.finishedAt).toBeUndefined();
    expect(run.result).toBeNull();
    expect(run.events.some((e) => e.kind === 'finished')).toBe(false);
  });

  it('после итогового статуса доклад руководителю попадает в журнал и в разбор', () => {
    const { incidentId, chief } = begin({ mode: 'exam' });
    useRun.getState().setStatus(incidentId, { ...status, status: 'Принята' });
    useRun.getState().setStatus(incidentId, { ...status, status: 'Работы завершены' });
    vi.advanceTimersByTime(5000);
    useRun.getState().callStarted(chief.id);
    useRun.getState().callEnded(chief.id, 'Докладываю: работы завершены, лифт запущен.');
    useRun.getState().finishCard();
    const run = useRun.getState();
    const kinds = run.events.map((e) => e.kind);
    expect(kinds.indexOf('call_ended')).toBeGreaterThan(kinds.lastIndexOf('status_set'));
    expect(kinds.at(-1)).toBe('finished');
    expect(run.current?.finishedAt).toBeDefined();
    expect(run.result?.evaluation).not.toBeNull();
  });

  it('карточка серверного занятия уходит на сервер один раз — по кнопке, вместе с докладом', () => {
    const { incidentId, chief } = begin({ mode: 'exam', fromServer: true });
    useRun.getState().setStatus(incidentId, { ...status, status: 'Принята' });
    useRun.getState().setStatus(incidentId, { ...status, status: 'Работы завершены' });
    vi.advanceTimersByTime(10_000);
    expect(submitCard).not.toHaveBeenCalled();
    useRun.getState().callEnded(chief.id, 'Докладываю руководителю.');
    useRun.getState().finishCard();
    useRun.getState().finishCard();
    expect(submitCard).toHaveBeenCalledTimes(1);
    const log = vi.mocked(submitCard).mock.calls[0][0].submittedCard.trainingLog!;
    expect(log.events.some((e) => e.kind === 'call_ended' && e.contactId === chief.id)).toBe(true);
  });
});
