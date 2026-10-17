import { describe, expect, it } from 'vitest';
import type { ComposeResult } from '../../api/ai';
import type { Scenario } from '../../domain/types';
import { composedOrigin, composeNote } from './composeNote';

const sc = {} as Scenario;

describe('composedOrigin', () => {
  it('«Сгенерирован ИИ» — только если текст написала модель', () => {
    expect(composedOrigin({ scenario: sc, by: 'llm' } satisfies ComposeResult)).toBe('generated');
  });

  it('шаблон или недоступный контур — «по шаблону», а не «создан преподавателем»', () => {
    expect(composedOrigin({ scenario: sc, by: 'template' })).toBe('template');
    expect(composedOrigin(null)).toBe('template');
  });
});

describe('composeNote', () => {
  it('всё написал ИИ', () => {
    expect(composeNote(0, 0)).toBe(', текст написан ИИ');
  });

  it('контур не ответил', () => {
    expect(composeNote(2, 0)).toBe(' (для 2 ИИ-контур не ответил — текст из шаблона классификатора)');
  });

  it('429 называется лимитом и советует повторить', () => {
    const note = composeNote(3, 3);
    expect(note).toContain('превышен лимит запросов');
    expect(note).toContain('подождите минуту');
    expect(note).not.toContain('не ответил');
  });

  it('лимит и отказ контура вперемешку', () => {
    expect(composeNote(3, 1)).toContain('для 1 превышен лимит запросов к ИИ-контуру, для 2 контур не ответил');
  });
});
