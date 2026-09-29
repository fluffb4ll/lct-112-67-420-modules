import type { ComponentType, ReactNode } from 'react';
import { useNow } from '../app/hooks';
import { navigate } from '../app/router';
import { IcHelp, IcRun } from '../arm/icons';
import { armHeaderDate } from '../domain/format';
import { useMe, useSession } from '../store/session';
import { cx } from '../ui/cx';

/*
 * Каркас кабинетов в виде главного экрана АРМ-112 (Памятка, стр. 12):
 * слева светлый блок с заголовком раздела (как «Поиск происшествий»),
 * справа тёмный блок — дата, пользователь, часы и ряд вкладок с иконками (как «журнал», «статистика», «аудит»).
 * На узком экране блоки встают друг под другом, вкладки прокручиваются.
 */

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  badge?: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function CabinetLayout({ nav, active, children, title, actions }: { nav: NavItem[]; active: string; title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const { user, role } = useMe();
  const signOut = useSession((s) => s.signOut);
  const now = new Date(useNow(1000));

  const logout = () => {
    void signOut();
    navigate('/login');
  };

  const parts = (user?.fullName ?? '').split(' ');
  const shortName = `${parts[0] ?? ''} ${parts[1]?.[0] ?? ''} ${parts[2]?.[0] ?? ''}`.trim();

  return (
    <div className="flex min-h-full flex-col bg-c-bg">
      <header className="no-print flex shrink-0 flex-col lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col justify-center bg-arm-search px-4 py-3">
          <h1 className="truncate border-b border-[#8a8f93] pb-1 text-[27px] leading-tight text-arm-text">{title}</h1>
          <div className="mt-2 flex min-h-8 flex-wrap items-center justify-between gap-2">
            <span className="text-[12px] text-arm-text">учебный комплекс АРМ-112 · {role?.name.toLowerCase()}</span>
            {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
          </div>
        </div>

        <div className="flex shrink-0 flex-col bg-arm-dark text-white lg:w-[560px]">
          <div className="flex items-start justify-between gap-3 px-3 pt-2.5">
            <div className="min-w-0">
              <div className="text-[15px] font-bold whitespace-nowrap">{armHeaderDate(now)}</div>
              <div className="mt-1 flex items-center gap-2 text-[12px] text-[#dfe3e6]">
                <span className="truncate">, {shortName}</span>
                <IcHelp size={13} />
                <button onClick={logout} title="Выйти" aria-label="Выйти" className="text-[#dfe3e6] hover:text-white">
                  <IcRun size={14} />
                </button>
              </div>
            </div>
            <div className="flex items-start font-bold tabular-nums">
              <span className="text-[44px] leading-[44px]">
                {pad(now.getHours())}:{pad(now.getMinutes())}
              </span>
              <span className="ml-0.5 text-[16px] leading-4">:{pad(now.getSeconds())}</span>
            </div>
          </div>
          <nav className="mt-2 flex overflow-x-auto">
            {nav.map((n) => {
              const Icon = n.icon;
              const on = active === n.id;
              return (
                <button
                  key={n.id}
                  onClick={() => navigate(n.path)}
                  className={cx(
                    'relative flex min-w-[84px] shrink-0 flex-col items-center gap-0.5 border-r border-[#3f474d] px-2 pt-1.5 pb-1 text-[11px] font-bold',
                    on ? 'bg-arm-blue' : 'hover:bg-arm-sub',
                  )}
                >
                  {Icon && <Icon size={18} />}
                  {n.label}
                  {!!n.badge && <span className="absolute top-0.5 right-1 bg-arm-orange px-1 text-[10px] leading-4">{n.badge}</span>}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="min-w-0 flex-1 p-3 sm:p-4">
        <div className="mx-auto max-w-[1500px]">{children}</div>
      </main>
    </div>
  );
}
