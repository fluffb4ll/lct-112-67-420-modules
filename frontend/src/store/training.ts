import { create } from 'zustand';
import { allocIncidentId, clearLive, saveAttempt, saveScenario, setLive } from '../api';
import { toSubmittedCard } from '../api/cardMap';
import { getDb, newId } from '../api/db';
import { describeError } from '../api/errors';
import { submitCard } from '../api/sessions';
import { askHint } from '../api/tutor';
import { BACKGROUND } from '../data/background';
import { OWN_SERVICE_ID } from '../data/scenarios';
import { serviceById } from '../data/services';
import { deriveDemo, eventsToDemo, stepMatches } from '../domain/demo';
import { DEFAULT_NORMS, evaluateDds, type Norms } from '../domain/evaluate';
import { computeRatings, predictSuccess, recommendDifficulty } from '../domain/skills';
import { TERMINAL } from '../domain/statusMachine';
import type {
  DdsService,
  DemoStep,
  Evaluation,
  Incident,
  ResponseStatus,
  Scenario,
  Skill,
  StatusEntry,
  TrainingEvent,
  TrainingMode,
  User,
} from '../domain/types';
import { blip, chime } from '../training/sounds';

/*
 * Прогон занятия на эмуляторе АРМ (станция ДДС).
 * Карточки поступают по одной из очереди сценариев; все действия пишутся событиями;
 * по завершении карточки — оценка, разбор и следующая карточка.
 * Режим record — преподаватель проходит карточку, а его действия сохраняются как шаги «делай как я».
 */

export interface ReceivedInput {
  at: number;
  from: string;
  text: string;
}

export interface RunCurrent {
  scenario: Scenario;
  incidentId: string;
  attemptId: string;
  arrivedAt: number;
  predicted: number;
  finishedAt?: number;
}

export interface CardResult {
  scenario: Scenario;
  evaluation: Evaluation | null;
  recordedSteps?: number;
}

interface RunState {
  active: boolean;
  kind: 'training' | 'record';
  sessionId: string | null;
  title: string;
  mode: TrainingMode;
  user: User | null;
  service: DdsService;
  norms: Norms;
  queue: string[];
  index: number;
  journal: Incident[];
  current: RunCurrent | null;
  events: TrainingEvent[];
  inputs: ReceivedInput[];
  manualHints: { at: number; text: string }[];
  demo: DemoStep[];
  demoStep: number;
  result: CardResult | null;
  history: { title: string; score: number | null; passed: boolean | null }[];
  finishedAll: boolean;
  unread: number;
  inCall: boolean;
  /** Занятие пришло с сервера: заполненные карточки уходят на бэкенд */
  fromServer: boolean;
  /** Ошибка отправки карточки на сервер — показывается в разборе */
  sendError: string | null;

  start: (p: {
    user: User;
    kind?: 'training' | 'record';
    sessionId: string | null;
    title: string;
    mode: TrainingMode;
    scenarioIds: string[];
    norms?: Partial<Norms>;
    fromServer?: boolean;
  }) => void;
  openIncident: (id: string) => void;
  closeIncident: () => void;
  statusFormOpened: () => void;
  setStatus: (incidentId: string, s: { status: ResponseStatus; orderNo: string; comment: string; typedChars: number; typingMs: number }) => void;
  callStarted: (contactId: string) => void;
  callEnded: (contactId: string, transcript: string, reply?: { from: string; text: string }) => void;
  requestHint: () => void;
  finishCard: () => void;
  nextCard: () => void;
  exit: () => void;
  markRead: () => void;
}

let timers: ReturnType<typeof setTimeout>[] = [];
const later = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms));
const clearTimers = () => {
  timers.forEach(clearTimeout);
  timers = [];
};

const iso = (ms: number) => new Date(ms).toISOString();

/** Шаблон карточки → конкретная карточка в журнале обучающегося */
function materialize(
  tpl: Scenario['incident'],
  id: string,
  createdMs: number,
  service: DdsService,
  ownHistory?: StatusEntry[],
): Incident {
  const inc = structuredClone(tpl);
  const operator = inc.operator ? `оп. ${inc.operator.num}` : 'оп. 9999';
  return {
    ...inc,
    id,
    createdAt: iso(createdMs),
    descriptions: inc.descriptions.map((d) => ({ ...d, at: iso(createdMs - 25_000) })),
    services: inc.services.map((s) => {
      const isOwn = s.serviceId === OWN_SERVICE_ID;
      return {
        ...s,
        serviceId: isOwn ? service.id : s.serviceId,
        name: isOwn ? service.short : s.name,
        history: isOwn && ownHistory ? ownHistory : [{ status: 'Добавлена' as const, at: iso(createdMs), operator }],
      };
    }),
  };
}

function backgroundJournal(service: DdsService, now: number): Incident[] {
  return BACKGROUND.map((bg) => {
    const created = now - bg.minutesAgo * 60_000;
    const { minutesAgo: _m, ownPath, others, ...rest } = bg;
    void _m;
    const history: StatusEntry[] = [
      { status: 'Добавлена', at: iso(created), operator: `оп. ${rest.operator?.num ?? '0'}` },
      ...ownPath.map((p) => ({ status: p.status, at: iso(created + p.afterMin * 60_000), operator: 'оп. 0', comment: p.comment, orderNo: p.orderNo })),
    ];
    return {
      ...rest,
      id: String(36814000 + Math.floor(Math.random() * 800)),
      createdAt: iso(created),
      descriptions: rest.descriptions.map((d) => ({ ...d, at: iso(created - 30_000) })),
      services: [
        { serviceId: service.id, name: service.short, via: 'ARM' as const, main: true, history },
        ...others.map((n) => ({ serviceId: n, name: n, via: 'ARM' as const, history: [{ status: 'Принята' as const, at: iso(created + 60_000), operator: 'оп. 0' }] })),
      ],
    };
  });
}

function pickNext(user: User, skill: Skill, kind: DdsService['kind'], excludeId: string): string | undefined {
  const db = getDb();
  const map = new Map(db.scenarios.map((s) => [s.id, s]));
  const ratings = computeRatings(db.attempts.filter((a) => a.studentId === user.id), map);
  const diff = recommendDifficulty(ratings, skill);
  const done = new Set(db.attempts.filter((a) => a.studentId === user.id).map((a) => a.scenarioId));
  const pool = db.scenarios.filter((s) => s.status === 'approved' && s.serviceKind === kind && s.skills.includes(skill) && s.id !== excludeId);
  const ranked = [...pool].sort((a, b) => Number(done.has(a.id)) - Number(done.has(b.id)) || Math.abs(a.difficulty - diff) - Math.abs(b.difficulty - diff));
  return ranked[0]?.id;
}

const initial = {
  active: false,
  kind: 'training' as const,
  sessionId: null,
  title: '',
  mode: 'practice' as TrainingMode,
  user: null,
  service: serviceById(undefined),
  norms: DEFAULT_NORMS,
  queue: [] as string[],
  index: 0,
  journal: [] as Incident[],
  current: null,
  events: [] as TrainingEvent[],
  inputs: [] as ReceivedInput[],
  manualHints: [] as { at: number; text: string }[],
  demo: [] as DemoStep[],
  demoStep: 0,
  result: null,
  history: [] as RunState['history'],
  finishedAll: false,
  unread: 0,
  inCall: false,
  fromServer: false,
  sendError: null,
};

export const useRun = create<RunState>((set, get) => {
  /** Запись события + продвижение шага демонстрации + сохранение попытки + прогресс для преподавателя */
  function push(e: Omit<TrainingEvent, 't'>) {
    const s = get();
    if (!s.current || s.current.finishedAt) return;
    const ev: TrainingEvent = { ...e, t: Date.now() - s.current.arrivedAt };
    const events = [...s.events, ev];
    const demoStep = s.mode === 'demo' && stepMatches(s.demo[s.demoStep], ev) ? s.demoStep + 1 : s.demoStep;
    set({ events, demoStep });
    persist(events);
  }

  function persist(events: TrainingEvent[]) {
    const s = get();
    if (!s.current || !s.user || s.kind === 'record') return;
    const c = s.current;
    saveAttempt({
      id: c.attemptId,
      sessionId: s.sessionId,
      studentId: s.user.id,
      scenarioId: c.scenario.id,
      incidentId: c.incidentId,
      mode: s.mode,
      startedAt: iso(c.arrivedAt),
      events,
    });
    const opened = events.find((e) => e.kind === 'opened');
    const lastStatus = [...events].reverse().find((e) => e.kind === 'status_set')?.status;
    setLive({
      studentId: s.user.id,
      sessionId: s.sessionId,
      scenarioTitle: c.scenario.title,
      incidentId: c.incidentId,
      cardIndex: s.index + 1,
      cardCount: s.queue.length,
      arrivedAt: iso(c.arrivedAt),
      openedAt: opened ? iso(c.arrivedAt + opened.t) : undefined,
      lastStatus,
      inCall: s.inCall,
      updatedAt: new Date().toISOString(),
    });
  }

  function updateIncident(id: string, fn: (inc: Incident) => Incident) {
    set({ journal: get().journal.map((i) => (i.id === id ? fn(i) : i)) });
  }

  /** Другие службы из списка оповещения тоже «живут»: получают и принимают карточку */
  function simulateOthers(inc: Incident) {
    inc.services.forEach((svc, k) => {
      if (svc.serviceId === get().service.id) return;
      const recv = svc.via === 'VIS' ? 3 + k : 15 + k * 9;
      const acc = recv + 20 + k * 11;
      const add = (status: ResponseStatus, sec: number) =>
        later(() => {
          updateIncident(inc.id, (i) => ({
            ...i,
            services: i.services.map((x) =>
              x.serviceId === svc.serviceId ? { ...x, history: [...x.history, { status, at: new Date().toISOString(), operator: svc.via === 'VIS' ? 'оп. 9999' : 'оп. 0' }] } : x,
            ),
          }));
        }, sec * 1000);
      add('Получена службой', recv);
      add('Принята', acc);
    });
  }

  function arrive() {
    const s = get();
    const db = getDb();
    const tpl = db.scenarios.find((x) => x.id === s.queue[s.index]);
    if (!tpl || !s.user) {
      set({ finishedAll: true });
      return;
    }
    const now = Date.now();
    // карточки-контекст (для «дублей») — лежат в журнале раньше основной
    let scenario = structuredClone(tpl);
    const context: Incident[] = [];
    for (const ctx of scenario.journalContext ?? []) {
      const id = allocIncidentId();
      const created = now - ctx.minutesAgo * 60_000;
      const ownHistory: StatusEntry[] = [
        { status: 'Добавлена', at: iso(created), operator: 'оп. 9999' },
        { status: 'Получена службой', at: iso(created + 15_000), operator: `оп. ${s.user.operatorNum ?? '0'}` },
        { status: 'Принята', at: iso(created + 25_000), operator: `оп. ${s.user.operatorNum ?? '0'}`, comment: 'Принято, направлен техник.' },
      ];
      context.push(materialize(ctx.incident, id, created, s.service, ownHistory));
      scenario = JSON.parse(JSON.stringify(scenario).replaceAll(`{${ctx.ref}}`, id)) as Scenario;
    }
    const incidentId = allocIncidentId();
    const incident = materialize(scenario.incident, incidentId, now, s.service);
    const map = new Map(db.scenarios.map((x) => [x.id, x]));
    const predicted = predictSuccess(computeRatings(db.attempts.filter((a) => a.studentId === s.user!.id), map), scenario);
    set({
      journal: [incident, ...context, ...s.journal],
      current: { scenario, incidentId, attemptId: newId('a'), arrivedAt: now, predicted },
      events: [{ t: 0, kind: 'arrived' }],
      inputs: [],
      manualHints: [],
      demo: s.mode === 'demo' ? scenario.demo ?? deriveDemo(scenario) : [],
      demoStep: 0,
      unread: s.unread + 1,
    });
    chime();
    simulateOthers(incident);
    persist(get().events);
  }

  return {
    ...initial,

    start: (p) => {
      clearTimers();
      const service = serviceById(p.user.serviceId);
      const now = Date.now();
      set({
        ...initial,
        active: true,
        kind: p.kind ?? 'training',
        sessionId: p.sessionId,
        fromServer: !!p.fromServer,
        title: p.title,
        mode: p.mode,
        user: p.user,
        service,
        norms: { ...DEFAULT_NORMS, ...p.norms },
        queue: p.scenarioIds,
        journal: backgroundJournal(service, now),
      });
      later(arrive, 2500);
    },

    openIncident: (id) => {
      const s = get();
      set({ unread: 0 });
      const inc = s.journal.find((i) => i.id === id);
      if (!inc || !s.user) return;
      const own = inc.services.find((x) => x.serviceId === s.service.id);
      if (own && own.history.length && own.history[own.history.length - 1].status === 'Добавлена') {
        // «Получена службой» — технический статус при открытии карточки диспетчером (Памятка, стр. 21)
        updateIncident(id, (i) => ({
          ...i,
          services: i.services.map((x) =>
            x.serviceId === s.service.id ? { ...x, history: [...x.history, { status: 'Получена службой', at: new Date().toISOString(), operator: `оп. ${s.user!.operatorNum ?? '0'}` }] } : x,
          ),
        }));
      }
      if (s.current?.incidentId === id && !s.events.some((e) => e.kind === 'opened')) push({ kind: 'opened' });
    },

    closeIncident: () => {
      if (get().current) push({ kind: 'closed' });
    },

    statusFormOpened: () => push({ kind: 'status_form' }),

    setStatus: (incidentId, st) => {
      const s = get();
      if (!s.user) return;
      const entry: StatusEntry = {
        status: st.status,
        at: new Date().toISOString(),
        operator: `оп. ${s.user.operatorNum ?? '0'}`,
        orderNo: st.orderNo.trim() || undefined,
        comment: st.comment.trim() || undefined,
      };
      updateIncident(incidentId, (i) => ({
        ...i,
        services: i.services.map((x) => (x.serviceId === s.service.id ? { ...x, history: [...x.history, entry] } : x)),
      }));
      if (s.current?.incidentId !== incidentId) return;
      push({ kind: 'status_set', status: st.status, comment: entry.comment, orderNo: entry.orderNo, typedChars: st.typedChars, typingMs: st.typingMs });
      // вводные от бригады по ходу работ
      for (const input of s.current.scenario.inputs.filter((x) => x.afterStatus === st.status)) {
        later(() => {
          const cur = get();
          if (!cur.current || cur.current.incidentId !== incidentId || cur.current.finishedAt) return;
          set({ inputs: [...cur.inputs, { at: Date.now(), from: input.from, text: input.text }] });
          push({ kind: 'input_received', text: input.text });
          blip();
        }, input.delaySec * 1000);
      }
      if (TERMINAL.includes(st.status)) later(() => get().finishCard(), 1200);
    },

    callStarted: (contactId) => {
      set({ inCall: true });
      push({ kind: 'call_started', contactId });
    },

    callEnded: (contactId, transcript, reply) => {
      set({ inCall: false });
      // ответ собеседника остаётся в «Вводных»: в нём часто ключевая информация для решения
      if (reply && get().current) set({ inputs: [...get().inputs, { at: Date.now(), from: `${reply.from} (по телефону)`, text: reply.text }] });
      push({ kind: 'call_ended', contactId, transcript });
    },

    requestHint: () => {
      const s = get();
      if (!s.current || s.mode === 'exam') return;
      const text = askHint(s.current.scenario, s.events);
      set({ manualHints: [...s.manualHints, { at: Date.now(), text }] });
      push({ kind: 'hint', text });
    },

    finishCard: () => {
      const s = get();
      if (!s.current || s.current.finishedAt || !s.user) return;
      push({ kind: 'finished' });
      const events = get().events;
      const cur = { ...s.current, finishedAt: Date.now() };
      clearTimers();

      if (s.kind === 'record') {
        const steps = eventsToDemo(events, s.service.contacts);
        const original = getDb().scenarios.find((x) => x.id === cur.scenario.id);
        if (original) saveScenario(s.user, { ...original, demo: steps }, { keepStatus: true });
        set({ current: cur, result: { scenario: cur.scenario, evaluation: null, recordedSteps: steps.length } });
        return;
      }

      const evaluation = evaluateDds(
        events,
        cur.scenario,
        s.norms,
        cur.predicted,
        (skill) => pickNext(s.user!, skill, s.service.kind, cur.scenario.id),
        s.service.contacts.filter((c) => c.isChief).map((c) => c.id),
      );
      saveAttempt({
        id: cur.attemptId,
        sessionId: s.sessionId,
        studentId: s.user.id,
        scenarioId: cur.scenario.id,
        incidentId: cur.incidentId,
        mode: s.mode,
        startedAt: iso(cur.arrivedAt),
        finishedAt: iso(cur.finishedAt),
        events,
        evaluation,
      });
      // занятие с сервера: отправляем заполненную карточку на оценку
      if (s.fromServer && s.sessionId) {
        const inc = get().journal.find((i) => i.id === cur.incidentId);
        if (inc) {
          const report = events
            .map((e) => e.transcript ?? '')
            .filter(Boolean)
            .join(' ');
          const durationSeconds = Math.round((cur.finishedAt - cur.arrivedAt) / 1000);
          void submitCard({
            sessionId: s.sessionId,
            scenarioId: cur.scenario.id,
            submittedCard: toSubmittedCard(inc, s.service.id, report),
            operatorNotes: report,
            startedAt: iso(cur.arrivedAt),
            submittedAt: iso(cur.finishedAt),
            durationSeconds,
            timeDeltaSeconds: durationSeconds - s.norms.totalSec,
          }).catch((e: unknown) => set({ sendError: describeError(e, 'Не удалось отправить карточку на сервер') }));
        }
      }
      set({
        current: cur,
        result: { scenario: cur.scenario, evaluation },
        history: [...s.history, { title: cur.scenario.title, score: evaluation.score, passed: evaluation.passed }],
      });
    },

    nextCard: () => {
      const s = get();
      const index = s.index + 1;
      if (s.kind === 'record' || index >= s.queue.length) {
        set({ result: null, finishedAll: true, current: null });
        if (s.user) clearLive(s.user.id);
        return;
      }
      set({ result: null, index, current: null, events: [], inputs: [], manualHints: [], demo: [], demoStep: 0 });
      later(arrive, 3000);
    },

    exit: () => {
      clearTimers();
      const u = get().user;
      if (u) clearLive(u.id);
      set({ ...initial });
    },

    markRead: () => set({ unread: 0 }),
  };
});

/** Своя служба в карточке */
export const ownService = (inc: Incident, serviceId: string) => inc.services.find((s) => s.serviceId === serviceId);
