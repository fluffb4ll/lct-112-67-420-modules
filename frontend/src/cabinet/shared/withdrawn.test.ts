import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/http';
import { isWithdrawn, scenarioTitle, takeCardError, WITHDRAWN_LABEL } from './withdrawn';

describe('сценарий, снятый с занятий', () => {
  it('в истории вместо пропавшего сценария — подпись, а не id', () => {
    expect(scenarioTitle(undefined, 'ok')).toBe(WITHDRAWN_LABEL);
    expect(scenarioTitle({ title: 'Застрял лифт' }, 'ok')).toBe('Застрял лифт');
    expect(scenarioTitle({ title: 'Застрял лифт' }, 'loading')).toBe('Застрял лифт');
  });

  it('«снят с занятий» — только когда набор с сервера загружен', () => {
    expect(isWithdrawn(undefined, 'ok')).toBe(true);
    expect(isWithdrawn({ title: 'x' }, 'ok')).toBe(false);
    for (const status of ['idle', 'loading', 'failed'] as const) {
      expect(isWithdrawn(undefined, status)).toBe(false);
      expect(scenarioTitle(undefined, status)).not.toBe(WITHDRAWN_LABEL);
    }
  });

  it('400 на сценарий карточки занятия — «снят с занятий», а не текст бэкенда', () => {
    expect(takeCardError(new ApiError(400, 'Scenario not found'))).toBe('Сценарий снят с занятий — карточку открыть нельзя');
  });

  it('прочие сбои — как раньше', () => {
    expect(takeCardError(new ApiError(0, 'Сервер недоступен.'))).toBe('Сервер недоступен.');
    expect(takeCardError(new Error('x'))).toBe('Не удалось открыть карточку');
  });
});
