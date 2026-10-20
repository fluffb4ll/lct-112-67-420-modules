import { describe, expect, it } from 'vitest';
import { operatorLabel, shortName } from './format';

describe('shortName', () => {
  it('фамилия и инициалы', () => expect(shortName('Пупкин Василий Тестович')).toBe('Пупкин В Т'));
  it('без отчества и с лишними пробелами', () => expect(shortName('  Иванов   Иван ')).toBe('Иванов И'));
  it('пустое имя — пустая строка', () => {
    expect(shortName('')).toBe('');
    expect(shortName(undefined)).toBe('');
  });
});

describe('operatorLabel', () => {
  it('номер оператора и имя через запятую', () => expect(operatorLabel('Кузнецова Елена Андреевна', '227')).toBe('оп. 227, Кузнецова Е А'));
  it('без номера — только имя, без «оп. —» и запятой в начале', () => {
    expect(operatorLabel('Пупкин Василий Тестович')).toBe('Пупкин В Т');
    expect(operatorLabel('Пупкин Василий Тестович', ' ')).toBe('Пупкин В Т');
  });
  it('без имени — только номер', () => expect(operatorLabel('', '227')).toBe('оп. 227'));
});
