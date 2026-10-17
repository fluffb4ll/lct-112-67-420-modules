import { useEffect } from 'react';
import type { Scenario } from '../../domain/types';
import { setServerScenarios, useServerScenarioStore } from '../../store/serverScenarios';
import { fetchGroupScenarios } from './serverScenarios';

/**
 * Утверждённые сценарии занятий группы с сервера. Каждая загрузка заменяет набор целиком
 * (store/serverScenarios), в общие локальные данные они не попадают. Без группы — пусто.
 */
export function useServerScenarios(groupId: string | undefined): Scenario[] {
  const own = useServerScenarioStore((s) => (groupId && s.groupId === groupId ? s.scenarios : EMPTY));

  useEffect(() => {
    if (!groupId) return;
    let stopped = false;
    refreshServerScenarios(groupId, () => stopped).catch(() => {
      // нет сети или прав — тренируемся на том, что загружено раньше и есть локально
    });
    return () => {
      stopped = true;
    };
  }, [groupId]);

  return own;
}

/** Загрузить и заменить набор целиком: сценарий, ставший архивным или снятый с занятий, пропадает. */
export async function refreshServerScenarios(groupId: string, stopped: () => boolean = () => false, fetch = fetchGroupScenarios) {
  const list = await fetch(groupId);
  if (!stopped()) setServerScenarios(groupId, list);
}

const EMPTY: Scenario[] = [];
