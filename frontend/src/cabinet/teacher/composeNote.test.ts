import { describe, expect, it } from 'vitest';
import { AiUnavailable, type ComposeResult } from '../../api/ai';
import type { Scenario } from '../../domain/types';
import { composeAndSave, composedOrigin, generateMessage, noticesAfterLoad, type GenerateOutcome } from './composeNote';

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
    // причина шаблона уходит в уведомление преподавателю
    expect(o).toEqual({ saved: 4, failed: 0, byTemplate: 1, stoppedByLimit: false, why: 'нет связи' });
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

describe('noticesAfterLoad — сообщения банка после перезагрузки списка', () => {
  const limit = generateMessage({ saved: 0, failed: 0, byTemplate: 0, stoppedByLimit: true }, 3);

  it('итог генерации «превышен лимит» не пропадает после reload из onDone', () => {
    const after = noticesAfterLoad({ load: null, generate: limit }, undefined);
    expect(after.generate).toBe(limit);
    expect(after.generate?.text).toContain('Сохранено черновиков: 0 из 3');
  });

  it('ошибка загрузки показывается и сбрасывается следующей удачной загрузкой, итог генерации не трогает', () => {
    const failed = noticesAfterLoad({ load: null, generate: limit }, 'Сервер недоступен');
    expect(failed).toEqual({ load: 'Сервер недоступен', generate: limit });
    expect(noticesAfterLoad(failed, undefined)).toEqual({ load: null, generate: limit });
  });
});

describe('composeAndSave — модель и причина шаблона в итоге', () => {
  const model = (name: string) => ({ component: 'llm', model_name: name, model_version: '1' });
  const go = (results: ((d: Scenario) => Promise<ComposeResult>)[], closedAfter?: number) => {
    const saving: number[] = [];
    let asked = 0;
    const out = composeAndSave(drafts.slice(0, results.length), {
      compose: (d, i) => {
        asked++;
        return results[i](d);
      },
      save: async () => {},
      closed: () => closedAfter !== undefined && asked > closedAfter,
      onSaving: (i) => saving.push(i),
    });
    return out.then((o) => ({ o, saving }));
  };

  it('model — имя модели из первого ответа с текстом от модели', async () => {
    const { o, saving } = await go([
      (d) => Promise.resolve({ scenario: d, by: 'llm', model: model('qwen-a') }),
      (d) => Promise.resolve({ scenario: d, by: 'llm', model: model('qwen-b') }),
    ]);
    expect(o).toEqual({ saved: 2, failed: 0, byTemplate: 0, stoppedByLimit: false, model: 'qwen-a' });
    expect(saving).toEqual([0, 1]);
  });

  it('ответ модели без model — поле model не заполняется', async () => {
    const { o } = await go([(d) => Promise.resolve({ scenario: d, by: 'llm' })]);
    expect(o.model).toBeUndefined();
  });

  it('шаблон — why из composeFallbackReason, по первому такому сценарию', async () => {
    const { o } = await go([
      (d) => Promise.resolve({ scenario: d, by: 'template', model: model('qwen-a'), rejected: ['title', 'description'] }),
      (d) => Promise.resolve({ scenario: d, by: 'template', model: null }),
    ]);
    expect(o.byTemplate).toBe(2);
    expect(o.model).toBeUndefined();
    expect(o.why).toBe('модель qwen-a написала текст, но проверка контура его отклонила: название, описание');
  });

  it('модель не подключена — причина со временем ответа', async () => {
    const { o } = await go([(d) => Promise.resolve({ scenario: d, by: 'template', model: null })]);
    expect(o.why).toMatch(/^на сервере не подключена языковая модель — контур работает по правилам \(ответ пришёл за [\d.]+ с\)$/);
  });

  it('ошибка не по лимиту — её текст в why; не Error — общая фраза', async () => {
    const err = await go([() => Promise.reject(new AiUnavailable('ИИ-контур ответил 504', 504))]);
    expect(err.o).toEqual({ saved: 1, failed: 0, byTemplate: 1, stoppedByLimit: false, why: 'ИИ-контур ответил 504' });
    const odd = await go([() => Promise.reject('boom')]);
    expect(odd.o.why).toBe('ИИ-контур недоступен');
  });

  it('onSaving не зовётся после 429 и если окно закрыли, пока шёл запрос', async () => {
    const limited = await go([(d) => Promise.resolve({ scenario: d, by: 'llm' }), () => Promise.reject(new AiUnavailable('лимит', 429))]);
    expect(limited.saving).toEqual([0]);
    const closed = await go([(d) => Promise.resolve({ scenario: d, by: 'llm' })], 0);
    expect(closed.saving).toEqual([]);
    expect(closed.o.saved).toBe(0);
  });
});

describe('generateMessage — модель и причина шаблона', () => {
  const o = (over: Partial<GenerateOutcome>): GenerateOutcome => ({ saved: 3, failed: 0, byTemplate: 0, stoppedByLimit: false, ...over });

  it('модель названа, когда весь текст от неё', () => {
    expect(generateMessage(o({ model: 'qwen-a' }), 3).text).toBe(
      'Сгенерировано черновиков: 3, текст написала языковая модель qwen-a. Проверьте эталон и утвердите — после этого сценарии попадут в общий банк.',
    );
  });

  it('шаблон с причиной — причина в тексте; модель тогда не называется', () => {
    const m = generateMessage(o({ byTemplate: 1, why: 'нет связи', model: 'qwen-a' }), 3);
    expect(m.tone).toBe('ok');
    expect(m.text).toBe(
      'Сгенерировано черновиков: 3 (для 1 текст из шаблона классификатора: нет связи). Проверьте эталон и утвердите — после этого сценарии попадут в общий банк.',
    );
    expect(m.text).not.toContain('qwen-a');
  });

  it('лимит с шаблоном — причина тоже в сообщении', () => {
    const m = generateMessage(o({ saved: 2, byTemplate: 1, why: 'нет связи', stoppedByLimit: true }), 4);
    expect(m.text).toContain('Сохранено черновиков: 2 из 4 (для 1 текст из шаблона классификатора: нет связи).');
  });
});
