import { describe, expect, it } from 'vitest';
import { emptyPracticeText } from './practiceEmpty';

describe('пустая самостоятельная тренировка', () => {
  it('пока карточки грузятся — нейтральное «загружаем», без упоминания преподавателя', () => {
    expect(emptyPracticeText('g1', 'idle', null)).toBe('Загружаем карточки…');
    expect(emptyPracticeText('g1', 'loading', 'g1')).toBe('Загружаем карточки…');
  });

  it('в сторе ещё набор прежней группы (сменился пользователь) — тоже «загружаем»', () => {
    expect(emptyPracticeText('g2', 'ok', 'g1')).toBe('Загружаем карточки…');
  });

  it('загрузка сорвалась — просим обновить страницу', () => {
    expect(emptyPracticeText('g1', 'failed', null)).toMatch(/Не удалось загрузить карточки/);
  });

  it('набор группы загружен и пуст — пояснение про занятия преподавателя', () => {
    expect(emptyPracticeText('g1', 'ok', 'g1')).toMatch(/преподаватель назначит занятия/);
  });

  it('без серверной группы грузить нечего — пояснение сразу', () => {
    for (const status of ['idle', 'loading', 'failed', 'ok'] as const) {
      expect(emptyPracticeText(undefined, status, null)).toMatch(/преподаватель назначит занятия/);
    }
  });
});
