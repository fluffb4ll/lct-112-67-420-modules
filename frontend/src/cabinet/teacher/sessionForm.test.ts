import { describe, expect, it } from 'vitest';
import { normalizeSessionNumber } from './sessionForm';

describe('normalizeSessionNumber', () => {
  it('при нормализации пустого поля ставит минимум', () => {
    expect(normalizeSessionNumber('', 1, 50)).toBe(1);
  });

  it('ограничивает значение заданным диапазоном', () => {
    expect(normalizeSessionNumber('51', 1, 50)).toBe(50);
    expect(normalizeSessionNumber('-2', 0)).toBe(0);
  });
});
