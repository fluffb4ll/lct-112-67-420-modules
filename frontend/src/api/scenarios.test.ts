import { describe, expect, it } from 'vitest';
import { SEED_SCENARIOS } from '../data/scenarios';
import { fromDetails, playableFromDetails, toBody, type ScenarioDetails } from './scenarios';

const seed = SEED_SCENARIOS.find((s) => s.id === 'sc-lift-praktika')!;
const ID = '0b6c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3';

function details(over: Partial<ScenarioDetails> = {}): ScenarioDetails {
  const body = toBody(seed, null);
  return {
    id: ID,
    categoryId: null,
    categoryName: 'ЛИФТ',
    title: body.title,
    complexity: body.complexity,
    timeLimitSeconds: body.timeLimitSeconds,
    status: 'APPROVED',
    createdByName: null,
    createdAt: '2026-10-17T10:00:00Z',
    category: null,
    prompt: body.prompt,
    callerProfile: body.callerProfile,
    incidentFacts: body.incidentFacts,
    referenceCard: body.referenceCard,
    createdById: null,
    updatedAt: null,
    ...over,
  };
}

describe('playableFromDetails', () => {
  it('утверждённый сценарий фронта возвращается без потерь', () => {
    const sc = playableFromDetails(details())!;
    expect(sc.id).toBe(ID);
    expect(sc.status).toBe('approved');
    expect(sc.incident).toEqual(seed.incident);
    expect(sc.expected).toEqual(seed.expected);
    expect(sc.serviceKind).toBe(seed.serviceKind);
    expect(sc.skills).toEqual(seed.skills);
    expect(sc.chiefReply).toBe(seed.chiefReply);
  });

  it('черновик для тренировки не берём', () => {
    expect(playableFromDetails(details({ status: 'DRAFT' }))).toBeNull();
  });

  it('сценарий без карточки происшествия (как «Лифт e2e») не берём', () => {
    const d = details({ incidentFacts: { type: 'лифт' }, referenceCard: { scenario: { title: 'Лифт e2e', skills: ['report'] } } });
    expect(playableFromDetails(d)).toBeNull();
  });

  it('недостающие поля модели получают значения по умолчанию', () => {
    const ref = toBody(seed, null).referenceCard as { expected: unknown; scenario: Record<string, unknown> };
    const { serviceKind: _k, inputs: _i, station: _s, ...scenario } = ref.scenario;
    void _k;
    void _i;
    void _s;
    const sc = fromDetails(details({ referenceCard: { expected: ref.expected, scenario } }));
    expect(sc.serviceKind).toBe('uprava');
    expect(sc.inputs).toEqual([]);
    expect(sc.station).toBe('dds');
  });
});
