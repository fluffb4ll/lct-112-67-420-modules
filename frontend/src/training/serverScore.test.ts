import { describe, expect, it } from 'vitest';
import type { Evaluation as ServerEvaluation } from '../api/sessions';
import { evaluationOfCard, serverScoreView } from './serverScore';

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
