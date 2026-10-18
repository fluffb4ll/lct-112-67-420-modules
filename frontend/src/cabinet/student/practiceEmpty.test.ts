import { describe, expect, it } from 'vitest';
import { emptyPracticeText } from './practiceEmpty';

describe('пустая самостоятельная тренировка', () => {
  it('пока карточки грузятся — нейтральное «загружаем», без упоминания преподавателя', () => {
    expect(emptyPracticeText(true, 'idle')).toBe('Загружаем карточки…');
    expect(emptyPracticeText(true, 'loading')).toBe('Загружаем карточки…');
  });

  it('загрузка сорвалась — просим обновить страницу', () => {
    expect(emptyPracticeText(true, 'failed')).toMatch(/Не удалось загрузить карточки/);
  });

  it('набор загружен и пуст — пояснение про занятия преподавателя', () => {
    expect(emptyPracticeText(true, 'ok')).toMatch(/преподаватель назначит занятия/);
  });

  it('без серверного пользователя грузить нечего — пояснение сразу', () => {
    for (const status of ['idle', 'loading', 'failed', 'ok'] as const) {
      expect(emptyPracticeText(false, status)).toMatch(/преподаватель назначит занятия/);
    }
  });
});
