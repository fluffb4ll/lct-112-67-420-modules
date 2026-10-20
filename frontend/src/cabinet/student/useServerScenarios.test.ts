import { describe, expect, it } from 'vitest';
import { getDb } from '../../api/db';
import { toBody, type BackendStatus, type ScenarioDetails } from '../../api/scenarios';
import { SEED_SCENARIOS } from '../../data/scenarios';
import { allScenarios, setLessonScenario, useServerScenarioStore } from '../../store/serverScenarios';
import { fetchGroupScenarios, type GroupScenariosApi } from './serverScenarios';
import { refreshServerScenarios } from './useServerScenarios';

const seed = SEED_SCENARIOS.find((s) => s.id === 'sc-lift-praktika')!;

function details(id: string, status: BackendStatus): ScenarioDetails {
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

// бэкенд, где статусы сценариев можно менять между загрузками
function backend(status: Record<string, BackendStatus>): GroupScenariosApi {
  return {
    listSessions: async () => ({ content: [{ id: 's1' }], totalPages: 1 }),
    getSession: async () => ({ scenarioIds: Object.keys(status) }),
    getScenario: async (id) => details(id, status[id]),
  };
}

describe('refreshServerScenarios', () => {
  it('сценарий, ставший архивным, пропадает при следующей загрузке; общая БД не трогается', async () => {
    const localBefore = getDb().scenarios.length;
    const status: Record<string, BackendStatus> = { 'srv-a': 'APPROVED', 'srv-b': 'APPROVED' };
    const fetch = (g: string) => fetchGroupScenarios(g, backend(status));

    await refreshServerScenarios('g1', undefined, fetch);
    expect(allScenarios().filter((s) => s.id.startsWith('srv-')).map((s) => s.id)).toEqual(['srv-a', 'srv-b']);

    status['srv-b'] = 'ARCHIVED';
    await refreshServerScenarios('g1', undefined, fetch);
    expect(useServerScenarioStore.getState().scenarios.map((s) => s.id)).toEqual(['srv-a']);
    expect(allScenarios().some((s) => s.id === 'srv-b')).toBe(false);
    expect(getDb().scenarios.length).toBe(localBefore);
    expect(getDb().scenarios.some((s) => s.id.startsWith('srv-'))).toBe(false);
  });

  it('ответ после ухода со страницы не записывается', async () => {
    const before = useServerScenarioStore.getState();
    await refreshServerScenarios('g2', () => true, async () => [{ ...seed, id: 'srv-late' }]);
    const after = useServerScenarioStore.getState();
    expect(after.scenarios).toBe(before.scenarios);
    expect(after.groupId).toBe(before.groupId);
  });

  it('статус загрузки: ok после ответа; при сбое — failed, набор прежний', async () => {
    let resolve: (v: never[]) => void = () => undefined;
    const pending = refreshServerScenarios('g1', undefined, () => new Promise((r) => (resolve = r)));
    expect(useServerScenarioStore.getState().status).toBe('loading');
    resolve([]);
    await pending;
    expect(useServerScenarioStore.getState().status).toBe('ok');

    await refreshServerScenarios('g1', undefined, async () => [{ ...seed, id: 'srv-kept' }]);
    await expect(refreshServerScenarios('g1', undefined, async () => Promise.reject(new Error('сеть')))).rejects.toThrow('сеть');
    expect(useServerScenarioStore.getState().status).toBe('failed');
    expect(useServerScenarioStore.getState().scenarios.map((s) => s.id)).toEqual(['srv-kept']);
  });

  it('сценарий карточки серверного занятия — в отдельном сторе, обновление набора группы его не стирает', async () => {
    const localBefore = getDb().scenarios.length;
    setLessonScenario({ ...seed, id: 'srv-lesson' });
    await refreshServerScenarios('g1', undefined, async () => []);
    expect(allScenarios().find((s) => s.id === 'srv-lesson')?.title).toBe(seed.title);
    expect(getDb().scenarios.length).toBe(localBefore);
  });
});
