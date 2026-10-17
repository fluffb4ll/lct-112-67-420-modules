import { describe, expect, it } from 'vitest';
import type { Evaluation as ServerEvaluation } from '../api/sessions';
import { evaluationOfCard, PRELIMINARY_LABEL, scoreBadge, serverScoreView, serverStatusLine } from './serverScore';

const base: ServerEvaluation = {
  id: 'e1',
  cardId: 'c1',
  aiScore: null,
  aiGrammarScore: null,
  aiComplianceErrors: null,
  aiRecommendations: null,
  aiStatus: 'PENDING',
  teacherScore: null,
  teacherComment: null,
  evaluatedById: null,
  evaluatedByName: null,
  finalScore: null,
  createdAt: '2026-10-17T10:00:00Z',
  updatedAt: null,
};

describe('serverScoreView', () => {
  it('оценки ещё нет — ждём', () => {
    expect(serverScoreView(null).kind).toBe('pending');
    expect(serverScoreView(base).kind).toBe('pending');
  });

  it('балл ИИ готов — показываем его с подписью «оценка ИИ»', () => {
    expect(serverScoreView({ ...base, aiStatus: 'OK', aiScore: 97, finalScore: 97 })).toEqual({ kind: 'score', score: 97, label: 'оценка ИИ' });
  });

  it('старая оценка без статуса, но с баллом — тоже готова', () => {
    expect(serverScoreView({ ...base, aiStatus: null, aiScore: 80 })).toEqual({ kind: 'score', score: 80, label: 'оценка ИИ' });
  });

  it('перезапуск оценки идёт — старый балл не выдаём за итог', () => {
    expect(serverScoreView({ ...base, aiStatus: 'PENDING', aiScore: 60 }).kind).toBe('pending');
  });

  it('оценка преподавателя главнее оценки ИИ', () => {
    expect(serverScoreView({ ...base, aiStatus: 'OK', aiScore: 97, teacherScore: 85, finalScore: 85 })).toEqual({
      kind: 'score',
      score: 85,
      label: 'оценка преподавателя',
    });
  });

  it('ИИ-контур не ответил', () => {
    expect(serverScoreView({ ...base, aiStatus: 'UNAVAILABLE' }).kind).toBe('unavailable');
  });
});

describe('evaluationOfCard', () => {
  it('достаёт оценку из деталей карточки', () => {
    expect(evaluationOfCard({ id: 'c1', evaluation: base })).toBe(base);
    expect(evaluationOfCard({ id: 'c1', evaluation: null })).toBeNull();
    expect(evaluationOfCard(null)).toBeNull();
  });
});

describe('serverStatusLine', () => {
  it('карточка не ушла на сервер — так и пишем, а не «отправляется…» навсегда', () => {
    expect(serverStatusLine('Не удалось отправить карточку на сервер', null)).toBe('Не удалось отправить карточку на сервер — итоговой оценки по ней не будет.');
  });

  it('ждём отправку, затем оценку, затем итог', () => {
    expect(serverStatusLine(undefined, null)).toBe('Карточка отправляется на сервер…');
    expect(serverStatusLine(undefined, { kind: 'pending', label: 'оценка ИИ готовится…' })).toBe('Оценка ИИ готовится…');
    expect(serverStatusLine(undefined, { kind: 'score', score: 90, label: 'оценка ИИ' })).toContain('может отличаться');
  });
});

describe('scoreBadge', () => {
  it('серверный балл ниже порога — плашка «незачёт», даже если локально зачёт', () => {
    expect(scoreBadge({ score: 90, passed: true }, { kind: 'score', score: 40, label: 'оценка ИИ' }, true, 70)).toEqual({
      score: 40,
      passed: false,
      label: 'оценка ИИ',
    });
  });

  it('серверный балл выше порога — зачёт', () => {
    expect(scoreBadge({ score: 50, passed: false }, { kind: 'score', score: 85, label: 'оценка преподавателя' }, true, 70).passed).toBe(true);
  });

  it('пока оценки сервера нет — локальная, помеченная как предварительная', () => {
    expect(scoreBadge({ score: 90, passed: true }, { kind: 'pending', label: '…' }, true, 70)).toEqual({ score: 90, passed: true, label: PRELIMINARY_LABEL });
    expect(scoreBadge({ score: 50, passed: false }, null, false, 70).label).toBe('незачёт');
  });
});
