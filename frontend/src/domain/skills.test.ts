import { describe, expect, it } from 'vitest';
import { serverSkillBars } from './skills';

describe('serverSkillBars', () => {
  it('подписи по-русски, порядок навыков, значения округлены', () => {
    expect(serverSkillBars({ literacy: 75, timing: 87.5, zone: 74.4 })).toEqual([
      { label: 'Нормативы времени', value: 88 },
      { label: 'Зона ответственности', value: 74 },
      { label: 'Грамотность текста', value: 75 },
    ]);
  });

  it('незнакомый ключ остаётся в конце как есть', () => {
    expect(serverSkillBars({ newSkill: 50, report: 100 }).map((b) => b.label)).toEqual(['Доклад руководителю', 'newSkill']);
  });

  it('нет данных — нет полос', () => {
    expect(serverSkillBars(null)).toEqual([]);
    expect(serverSkillBars(undefined)).toEqual([]);
    expect(serverSkillBars({})).toEqual([]);
  });
});
