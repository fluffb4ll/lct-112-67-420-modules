import { useDb } from '../../api/db';
import { useNow } from '../../app/hooks';
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
  const drafts = useDb((s) => s.db.scenarios.filter((x) => x.status === 'draft').length);
  const liveList = useDb((s) => s.db.live);
  const now = useNow(30_000);
  const live = liveList.filter((l) => now - new Date(l.updatedAt).getTime() < 10 * 60_000).length;
  if (!user) return null;

  const nav = [
    { id: 'bank', label: 'сценарии', path: '/teacher/bank', badge: drafts, icon: IcDoc },
    { id: 'sessions', label: 'занятия', path: '/teacher/sessions', icon: IcList },
    { id: 'groups', label: 'группы', path: '/teacher/groups', icon: IcUsers },
    { id: 'monitor', label: 'мониторинг', path: '/teacher/monitor', badge: live, icon: IcMonitor },
    { id: 'reports', label: 'статистика', path: '/teacher/reports', icon: IcChart },
  ];
  const s = ['bank', 'sessions', 'groups', 'monitor', 'reports'].includes(section) ? section : 'bank';

  if (s === 'bank' && param) return <ScenarioEditor id={param} nav={nav} />;

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
