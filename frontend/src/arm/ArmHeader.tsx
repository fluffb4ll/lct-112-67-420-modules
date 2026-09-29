import { useState } from 'react';
import { useNow } from '../app/hooks';
import { armHeaderDate } from '../domain/format';
import { IcChevronDown, IcGear, IcHelp, IcMonitor, IcRun, IcSearch } from './icons';

/*
 * Шапка главного экрана АРМ-112 в варианте ДДС (скриншот «Рабочее поле ДДС» с учебного стенда):
 * слева строка поиска происшествий, справа — дата, пользователь и часы. Вкладок у ДДС нет.
 */

export function ArmHeader({ userLabel, onSearch, onExit }: { userLabel: string; onSearch: (q: string) => void; onExit: () => void }) {
  const now = useNow(1000);
  const d = new Date(now);
  const [q, setQ] = useState('');
  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <header className="flex h-[92px] shrink-0 select-none">
      <div className="flex min-w-0 flex-1 flex-col justify-center bg-arm-search px-4">
        <div className="flex items-end gap-3 border-b border-[#8a8f93]">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              onSearch(e.target.value);
            }}
            placeholder="Поиск происшествий"
            className="h-10 min-w-0 flex-1 bg-transparent text-[27px] font-normal text-arm-text outline-none placeholder:text-arm-text"
          />
          <IcSearch size={28} className="mb-1.5 text-arm-text" />
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <button className="flex items-center text-[12px] text-arm-text">
            расширенный по параметрам <IcChevronDown size={16} />
          </button>
          <button
            onClick={() => {
              setQ('');
              onSearch('');
            }}
            className="border border-[#8a8f93] px-2 py-0.5 text-[12px] text-arm-muted hover:bg-white"
          >
            сбросить
          </button>
        </div>
      </div>
      <div className="flex w-[400px] shrink-0 items-start justify-between bg-arm-dark px-3 pt-3 text-white">
        <div className="min-w-0">
          <div className="text-[15px] font-bold whitespace-nowrap">{armHeaderDate(d)}</div>
          <div className="mt-1 flex items-center gap-2 text-[12px] text-[#dfe3e6]">
            <span className="truncate">, {userLabel}</span>
            <IcMonitor size={13} />
            <IcGear size={13} />
            <IcHelp size={13} />
            <button onClick={onExit} title="Выйти" className="text-[#dfe3e6] hover:text-white">
              <IcRun size={14} />
            </button>
          </div>
        </div>
        <div className="flex items-start font-bold tabular-nums">
          <span className="text-[52px] leading-[52px]">
            {pad(d.getHours())}:{pad(d.getMinutes())}
          </span>
          <span className="ml-0.5 text-[19px] leading-5">:{pad(d.getSeconds())}</span>
        </div>
      </div>
    </header>
  );
}
