import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/http';
import { scenarioTitle, takeCardError, WITHDRAWN_LABEL } from './withdrawn';

describe('сценарий, снятый с занятий', () => {
  it('в истории вместо пропавшего сценария — подпись, а не id', () => {
    expect(scenarioTitle(undefined)).toBe(WITHDRAWN_LABEL);
    expect(scenarioTitle({ title: 'Застрял лифт' })).toBe('Застрял лифт');
  });

  it('400 на сценарий карточки занятия — «снят с занятий», а не текст бэкенда', () => {
    expect(takeCardError(new ApiError(400, 'Scenario not found'))).toBe('Сценарий снят с занятий — карточку открыть нельзя');
  });

  it('прочие сбои — как раньше', () => {
    expect(takeCardError(new ApiError(0, 'Сервер недоступен.'))).toBe('Сервер недоступен.');
    expect(takeCardError(new Error('x'))).toBe('Не удалось открыть карточку');
  });
});
