import { describe, expect, it } from 'vitest';
import cases from './fuzzy_roots.json';
import { matchGroups } from './text';

// Кейсы — копия ai/tests/data/fuzzy_roots.json (общие с ИИ-контуром): фронт и сервер засчитывают корни одинаково.
// Оригинал, если он есть в репозитории, должен совпадать с копией.
const original = import.meta.glob('../../../ai/tests/data/fuzzy_roots.json', { eager: true, import: 'default' });

// реальный ответ faster-whisper на доклад «…застревание в лифте…»
const STT_REPORT = 'Докладываю Днепропетровская улица, дом 19, состревание в листе, ребенок без взрослых';
const GROUPS = [['днепро', '19'], ['застре']];

describe('matchGroups — кейсы ai/tests/data/fuzzy_roots.json', () => {
  it('копия кейсов совпадает с оригиналом в ai/', () => {
    for (const data of Object.values(original)) expect(data).toEqual(cases);
  });

  it.each(cases.match)('«%s» содержит «%s» (%s)', (text, stem) => {
    expect(matchGroups(text, [[stem]], { fuzzy: true }).hit).toBe(1);
  });

  it.each(cases.no_match)('«%s» не содержит «%s» (%s)', (text, stem) => {
    expect(matchGroups(text, [[stem]], { fuzzy: true }).hit).toBe(0);
  });
});

describe('matchGroups — доклад из распознавания речи', () => {
  it('засчитывает корень, искажённый распознаванием', () => {
    expect(matchGroups(STT_REPORT, GROUPS, { fuzzy: true })).toEqual({ hit: 2, missing: [] });
  });

  it('без fuzzy сверяет строго: комментарии набраны руками', () => {
    expect(matchGroups(STT_REPORT, GROUPS).missing).toEqual([['застре']]);
    expect(matchGroups('в листе', [['лифт']]).hit).toBe(0);
  });

  it('многословный корень ищется подстрокой', () => {
    expect(matchGroups('это не наш адрес', [['не наш']], { fuzzy: true }).hit).toBe(1);
  });
});
