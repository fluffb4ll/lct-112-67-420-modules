import { describe, expect, it } from 'vitest';
import { toBody, type BackendStatus, type ScenarioDetails } from '../../api/scenarios';
import { SEED_SCENARIOS } from '../../data/scenarios';
import { fetchGroupScenarios, MAX_SCENARIOS, type GroupScenariosApi } from './serverScenarios';

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

function api(sessions: Record<string, string[]> | null, scenarios: Record<string, ScenarioDetails | Error>): GroupScenariosApi & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    listSessions: async () => (sessions ? { content: Object.keys(sessions).map((id) => ({ id })) } : null),
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

  it('число запросов сценариев ограничено', async () => {
    const ids = Array.from({ length: MAX_SCENARIOS + 5 }, (_, i) => `x${i}`);
    const a = api({ s1: ids }, Object.fromEntries(ids.map((id) => [id, details(id)])));
    expect(await fetchGroupScenarios('g1', a)).toHaveLength(MAX_SCENARIOS);
  });
});
