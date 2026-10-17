import { describe, expect, it } from 'vitest';
import { AiUnavailable, type ComposeResult } from '../../api/ai';
import type { Scenario } from '../../domain/types';
import { composeAndSave, composedOrigin, generateMessage, type GenerateOutcome } from './composeNote';

const sc = {} as Scenario;
const drafts = ['a', 'b', 'c', 'd'].map((id) => ({ id }) as Scenario);

describe('composedOrigin', () => {
  it('«Сгенерирован ИИ» — только если текст написала модель', () => {
    expect(composedOrigin({ scenario: sc, by: 'llm' } satisfies ComposeResult)).toBe('generated');
  });

  it('шаблон или недоступный контур — «по шаблону», а не «создан преподавателем»', () => {
    expect(composedOrigin({ scenario: sc, by: 'template' })).toBe('template');
    expect(composedOrigin(null)).toBe('template');
  });
});

describe('composeAndSave', () => {
  const run = (compose: (d: Scenario, i: number) => Promise<ComposeResult>) => {
    const asked: string[] = [];
    const saved: Scenario[] = [];
    const out = composeAndSave(drafts, {
      compose: (d, i) => {
        asked.push(d.id);
        return compose(d, i);
      },
      save: async (s) => {
        saved.push(s);
      },
      closed: () => false,
    });
    return out.then((o) => ({ o, asked, saved }));
  };

  it('после 429 генерация останавливается: следующие сценарии не запрашиваются', async () => {
    const { o, asked, saved } = await run((d, i) =>
      i === 1 ? Promise.reject(new AiUnavailable('лимит', 429)) : Promise.resolve({ scenario: d, by: 'llm' }),
    );
    expect(asked).toEqual(['a', 'b']);
    expect(saved.map((s) => s.id)).toEqual(['a']);
    expect(o).toEqual({ saved: 1, failed: 0, byTemplate: 0, stoppedByLimit: true });
  });

  it('контур не ответил — сохраняем с текстом шаблона и идём дальше', async () => {
    const { o, saved } = await run((d, i) => (i === 1 ? Promise.reject(new AiUnavailable('нет связи', 502)) : Promise.resolve({ scenario: d, by: 'llm' })));
    expect(saved.map((s) => [s.id, s.origin])).toEqual([
      ['a', 'generated'],
      ['b', 'template'],
      ['c', 'generated'],
      ['d', 'generated'],
    ]);
    expect(o).toEqual({ saved: 4, failed: 0, byTemplate: 1, stoppedByLimit: false });
  });
});

describe('generateMessage', () => {
  const o = (over: Partial<GenerateOutcome>): GenerateOutcome => ({ saved: 3, failed: 0, byTemplate: 0, stoppedByLimit: false, ...over });

  it('всё написал ИИ', () => {
    expect(generateMessage(o({}), 3)).toEqual({
      tone: 'ok',
      text: 'Сгенерировано черновиков: 3, текст написан ИИ. Проверьте эталон и утвердите — после этого сценарии попадут в общий банк.',
    });
  });

  it('контур не ответил', () => {
    expect(generateMessage(o({ byTemplate: 2 }), 3).text).toContain('для 2 ИИ-контур не ответил — текст из шаблона классификатора');
  });

  it('лимит: сколько сохранено из скольких и что делать', () => {
    const m = generateMessage(o({ saved: 1, stoppedByLimit: true }), 4);
    expect(m.tone).toBe('bad');
    expect(m.text).toBe('Превышен лимит запросов к ИИ-контуру — генерация остановлена. Сохранено черновиков: 1 из 4. Подождите минуту и сгенерируйте оставшиеся.');
  });
});
