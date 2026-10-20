import { describe, expect, it, vi } from 'vitest';
import type { Evaluation } from '../api/sessions';
import { loadCardEvaluations } from './cardEvaluations';

const ev = (cardId: string, aiStatus: Evaluation['aiStatus']) => ({ id: `e-${cardId}`, cardId, aiStatus }) as Evaluation;

describe('loadCardEvaluations', () => {
  it('запрашивает оценки только неоценённых карточек', async () => {
    const load = vi.fn(async (id: string) => ev(id, 'UNAVAILABLE'));
    const res = await loadCardEvaluations(
      [
        { id: 'a', status: 'EVALUATED' },
        { id: 'b', status: 'SUBMITTED' },
      ],
      load,
    );
    expect(load).toHaveBeenCalledExactlyOnceWith('b');
    expect(Object.keys(res)).toEqual(['b']);
    expect(res.b.aiStatus).toBe('UNAVAILABLE');
  });

  it('сбой одной карточки и карточка без оценки не мешают остальным', async () => {
    const load = async (id: string) => {
      if (id === 'x') throw new Error('сеть');
      return id === 'y' ? null : ev(id, 'PENDING');
    };
    const res = await loadCardEvaluations(
      [
        { id: 'x', status: 'SUBMITTED' },
        { id: 'y', status: 'SUBMITTED' },
        { id: 'z', status: 'SUBMITTED' },
      ],
      load,
    );
    expect(Object.keys(res)).toEqual(['z']);
  });

  it('all — запрашивает и оценённые карточки: нужны балл и комментарий преподавателя', async () => {
    const load = vi.fn(async (id: string) => ev(id, 'OK'));
    const res = await loadCardEvaluations(
      [
        { id: 'a', status: 'EVALUATED' },
        { id: 'b', status: 'SUBMITTED' },
      ],
      load,
      true,
    );
    expect(load).toHaveBeenCalledTimes(2);
    expect(Object.keys(res).sort()).toEqual(['a', 'b']);
  });
});
