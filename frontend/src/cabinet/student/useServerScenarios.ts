import { useEffect, useState } from 'react';
import { mutate } from '../../api/db';
import { fetchGroupScenarios } from './serverScenarios';

/**
 * Утверждённые сценарии занятий группы с сервера: кладёт их в локальные данные (на них работает
 * эмулятор) и возвращает их id. Без группы или без бэкенда — пустое множество.
 */
export function useServerScenarios(groupId: string | undefined): Set<string> {
  const [ids, setIds] = useState<{ groupId: string; ids: Set<string> } | null>(null);

  useEffect(() => {
    if (!groupId) return;
    let stopped = false;
    fetchGroupScenarios(groupId)
      .then((list) => {
        if (stopped || !list.length) return;
        mutate((d) => {
          for (const sc of list) {
            const i = d.scenarios.findIndex((x) => x.id === sc.id);
            if (i >= 0) d.scenarios[i] = sc;
            else d.scenarios.unshift(sc);
          }
        });
        setIds({ groupId, ids: new Set(list.map((s) => s.id)) });
      })
      .catch(() => {
        // нет сети или прав — тренируемся на том, что есть локально
      });
    return () => {
      stopped = true;
    };
  }, [groupId]);

  return ids && ids.groupId === groupId ? ids.ids : EMPTY;
}

const EMPTY = new Set<string>();
