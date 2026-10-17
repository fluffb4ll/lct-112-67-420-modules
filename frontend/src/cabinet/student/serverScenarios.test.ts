import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/http';
import { toBody, type BackendStatus, type ScenarioDetails } from '../../api/scenarios';
import { SEED_SCENARIOS } from '../../data/scenarios';
import { BATCH, fetchGroupScenarios, PAGE_SIZE, WITHDRAWN_TTL_MS, type GroupScenariosApi, type WithdrawnMarks, type WithdrawnStore } from './serverScenarios';

const seed = SEED_SCENARIOS.find((s) => s.id === 'sc-lift-praktika')!;

function details(id: string, status: BackendStatus = 'APPROVED'): ScenarioDetails {
  const body = toBody(seed, null);
  return {
    id,
    categoryId: null,
    categoryName: null,
    title: body.title,
    complexity: body.complexity,
    timeLimitSeconds: body.timeLimitSeconds,
    status,
    createdByName: null,
    createdAt: '2026-10-17T10:00:00Z',
    category: null,
    prompt: body.prompt,
    callerProfile: body.callerProfile,
    incidentFacts: body.incidentFacts,
    referenceCard: body.referenceCard,
    createdById: null,
    updatedAt: null,
  };
}

function api(sessions: Record<string, string[]> | null, scenarios: Record<string, ScenarioDetails | Error>, size = PAGE_SIZE): GroupScenariosApi & { asked: string[]; pages: number[] } {
  const asked: string[] = [];
  const pages: number[] = [];
  const all = Object.keys(sessions ?? {});
  return {
    asked,
    pages,
    // постранично, как PageResponse бэкенда
    listSessions: async ({ page }) => {
      pages.push(page);
      return sessions ? { content: all.slice(page * size, (page + 1) * size).map((id) => ({ id })), totalPages: Math.ceil(all.length / size) } : null;
    },
    getSession: async (id) => ({ scenarioIds: sessions![id] }),
    getScenario: async (id) => {
      asked.push(id);
      const r = scenarios[id];
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

describe('fetchGroupScenarios', () => {
  it('собирает утверждённые сценарии из занятий группы без повторов', async () => {
    const a = api({ s1: ['a', 'b'], s2: ['b', 'c'] }, { a: details('a'), b: details('b'), c: details('c', 'DRAFT') });
    const list = await fetchGroupScenarios('g1', a);
    expect(list.map((s) => s.id)).toEqual(['a', 'b']);
    expect(a.asked).toEqual(['a', 'b', 'c']);
  });

  it('без бэкенда (listSessions → null) — пусто', async () => {
    expect(await fetchGroupScenarios('g1', api(null, {}))).toEqual([]);
  });

  it('недоступный сценарий не роняет остальные', async () => {
    const list = await fetchGroupScenarios('g1', api({ s1: ['a', 'b'] }, { a: new Error('403'), b: details('b') }));
    expect(list.map((s) => s.id)).toEqual(['b']);
  });

  it('проходит все страницы занятий, а не только первую', async () => {
    const sessions = Object.fromEntries(Array.from({ length: 2 * PAGE_SIZE + 3 }, (_, i) => [`s${i}`, [`x${i}`]]));
    const scenarios = Object.fromEntries(Object.values(sessions).flat().map((id) => [id, details(id)]));
    const a = api(sessions, scenarios);
    const list = await fetchGroupScenarios('g1', a);
    expect(a.pages).toEqual([0, 1, 2]);
    expect(list).toHaveLength(2 * PAGE_SIZE + 3);
  });

  it('сценариев больше пачки — берутся все', async () => {
    const ids = Array.from({ length: 3 * BATCH + 5 }, (_, i) => `x${i}`);
    const a = api({ s1: ids }, Object.fromEntries(ids.map((id) => [id, details(id)])));
    expect(await fetchGroupScenarios('g1', a)).toHaveLength(ids.length);
  });
});

function memory(marks: WithdrawnMarks = {}): WithdrawnStore & { marks: WithdrawnMarks } {
  const m = { marks, load: () => ({ ...m.marks }), save: (x: WithdrawnMarks) => void (m.marks = x) };
  return m;
}

const NOW = Date.parse('2026-10-17T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const withdrawn = () => new ApiError(400, 'Scenario not found');

describe('fetchGroupScenarios — сценарии, снятые с занятий', () => {
  it('на 400 запоминает сценарий и при следующей загрузке его не запрашивает', async () => {
    const store = memory();
    const first = api({ s1: ['a', 'b'] }, { a: withdrawn(), b: details('b') });
    expect((await fetchGroupScenarios('g1', first, store, NOW)).map((s) => s.id)).toEqual(['b']);
    expect(store.marks).toEqual({ a: NOW });

    const second = api({ s1: ['a', 'b'] }, { a: withdrawn(), b: details('b') });
    expect((await fetchGroupScenarios('g1', second, store, NOW + HOUR)).map((s) => s.id)).toEqual(['b']);
    expect(second.asked).toEqual(['b']);
  });

  it('через сутки спрашивает снова — сценарий могли вернуть', async () => {
    const store = memory({ a: NOW });
    const a = api({ s1: ['a'] }, { a: details('a') });
    const list = await fetchGroupScenarios('g1', a, store, NOW + WITHDRAWN_TTL_MS + 1);
    expect(a.asked).toEqual(['a']);
    expect(list.map((s) => s.id)).toEqual(['a']);
    expect(store.marks).toEqual({});
  });

  it('сценарий из занятия, начатого после отказа, запрашивается сразу', async () => {
    const store = memory({ a: NOW - 2 * HOUR });
    const a: GroupScenariosApi & { asked: string[] } = {
      ...api({ s1: ['a'] }, { a: details('a') }),
      listSessions: async () => ({ content: [{ id: 's1', startedAt: new Date(NOW - HOUR).toISOString() }], totalPages: 1 }),
    };
    expect((await fetchGroupScenarios('g1', a, store, NOW)).map((s) => s.id)).toEqual(['a']);
    expect(a.asked).toEqual(['a']);
  });

  it('сбой сети и 5xx не запоминаются', async () => {
    const store = memory();
    await fetchGroupScenarios('g1', api({ s1: ['a', 'b', 'c'] }, { a: new ApiError(0, 'сеть'), b: new ApiError(503, ''), c: new Error('?') }), store, NOW);
    expect(store.marks).toEqual({});
  });

  it('занятие без списка сценариев не даёт запросов по пустому id', async () => {
    const a: GroupScenariosApi & { asked: string[] } = { ...api({ s1: [] }, {}), getSession: async () => ({}) as { scenarioIds: string[] } };
    expect(await fetchGroupScenarios('g1', a, memory(), NOW)).toEqual([]);
    expect(a.asked).toEqual([]);
  });
});
