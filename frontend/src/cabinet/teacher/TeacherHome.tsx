import { useEffect, useState } from 'react';
import { listScenarios } from '../../api/scenarios';
import { listSessions } from '../../api/sessions';
import { IcChart, IcDoc, IcList, IcMonitor, IcUsers } from '../../arm/icons';
import { useMe } from '../../store/session';
import { CabinetLayout } from '../CabinetLayout';
import { Groups } from './Groups';
import { Monitor } from './Monitor';
import { Reports } from './Reports';
import { ScenarioBank } from './ScenarioBank';
import { ScenarioEditor } from './ScenarioEditor';
import { Sessions } from './Sessions';

/*
 * Кабинет преподавателя: банк сценариев (генерация ИИ → проверка → утверждение), занятия,
 * мониторинг в реальном времени, отчёты и аналитика.
 */

export function TeacherHome({ section = 'bank', param }: { section?: string; param?: string }) {
  const { user } = useMe();
  // бейджи — по серверу: черновики в банке и идущие занятия; перезапрос при смене раздела
  const [badges, setBadges] = useState<{ drafts?: number; live?: number }>({});
  const teacherId = user?.id;
  useEffect(() => {
    if (!teacherId) return;
    let alive = true;
    const count = (p: Promise<{ totalElements: number } | null>) => p.then((r) => r?.totalElements, () => undefined);
    void Promise.all([count(listScenarios({ status: 'DRAFT', size: 1 })), count(listSessions({ teacherId, activeOnly: true, size: 1 }))]).then(
      ([drafts, live]) => alive && setBadges({ drafts, live }),
    );
    return () => {
      alive = false;
    };
  }, [teacherId, section]);
  if (!user) return null;

  const nav = [
    { id: 'bank', label: 'сценарии', path: '/teacher/bank', badge: badges.drafts, icon: IcDoc },
    { id: 'sessions', label: 'занятия', path: '/teacher/sessions', icon: IcList },
    { id: 'groups', label: 'группы', path: '/teacher/groups', icon: IcUsers },
    { id: 'monitor', label: 'мониторинг', path: '/teacher/monitor', badge: badges.live, icon: IcMonitor },
    { id: 'reports', label: 'статистика', path: '/teacher/reports', icon: IcChart },
  ];
  const s = ['bank', 'sessions', 'groups', 'monitor', 'reports'].includes(section) ? section : 'bank';

  if (s === 'bank' && param) return <ScenarioEditor key={param} id={param} nav={nav} />;

  const titles: Record<string, string> = {
    bank: 'Банк сценариев',
    sessions: 'Занятия',
    groups: 'Учебные группы',
    monitor: 'Мониторинг занятий',
    reports: 'Отчёты и аналитика',
  };

  return (
    <CabinetLayout nav={nav} active={s} title={titles[s]}>
      {s === 'bank' && <ScenarioBank />}
      {s === 'sessions' && <Sessions />}
      {s === 'groups' && <Groups />}
      {s === 'monitor' && <Monitor />}
      {s === 'reports' && <Reports />}
    </CabinetLayout>
  );
}
