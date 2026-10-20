import { describe, expect, it } from 'vitest';
import { RULES } from './admin';

describe('RULES.fullName', () => {
  it('принимает ё и дефис внутри ФИО', () => {
    expect(RULES.fullName.test('Сидоров-Ёлкин Пётр Иванович')).toBe(true);
    expect(RULES.fullName.test('Елкин-Сидоров Анна')).toBe(true);
  });

  it('не принимает подчёркивание и другие знаки', () => {
    expect(RULES.fullName.test('Сидоров_Ёлкин Пётр')).toBe(false);
  });
});
