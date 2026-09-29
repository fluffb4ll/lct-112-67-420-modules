import { useState, type ReactNode } from 'react';
import { currentStatus } from '../domain/statusMachine';
import { ddmmyy, dateTime, hhmm, hhmmss, journalAddress, ss } from '../domain/format';
import type { Incident } from '../domain/types';
import { cx } from '../ui/cx';
import { IcBolt, IcBookmark, IcChevronDown, IcChevronLeft, IcChevronRight, IcChevronUp, IcClipboard, IcInfo, IcLink, IcMapOff, IcTimer } from './icons';

/*
 * «Список происшествий» — главный экран ДДС. Колонки и порядок — как на учебном стенде:
 * Связи, ЧС, Опер., АРМ, Номер, Дата, Время, Тип происшествия, Постр., Адрес, Статус службы.
 * Под строкой — описание; по стрелке — предпросмотр (службы, заявитель, признаки).
 */

const GRID =
  'grid grid-cols-[32px_32px_22px_32px_32px_54px_40px_78px_66px_70px_minmax(160px,1.25fr)_44px_minmax(220px,2fr)_150px_40px]';

export function Journal({
  incidents,
  serviceId,
  currentId,
  unread,
  onOpen,
}: {
  incidents: Incident[];
  serviceId: string;
  currentId?: string;
  unread: number;
  onOpen: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const sorted = [...incidents].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-arm-journal px-4 pb-6 text-white">
      <div className="flex items-center justify-between pt-4 pb-2">
        <button onClick={() => setCollapsed((v) => !v)} className="ml-6 flex items-center gap-1 text-[19px] font-bold">
          Список происшествий {collapsed ? <IcChevronDown size={20} /> : <IcChevronUp size={20} />}
        </button>
        <div className="flex items-center gap-5 text-[13px]">
          <span className="flex items-center gap-1.5 text-[#eef1f3]">
            <IcInfo size={16} className={unread ? 'text-arm-orange' : 'text-[#dfe3e6]'} />
            уведомления
            {unread > 0 && <span className="bg-arm-orange px-1.5 text-[11px] font-bold text-white">{unread}</span>}
          </span>
          <div className="flex h-7 w-[200px] items-center justify-between border border-[#c3c9cd] px-2 text-[12px] text-[#eef1f3]">
            выберите что показать <IcChevronUp size={14} />
          </div>
        </div>
      </div>

      {!collapsed && (
        <>
          <div className={cx(GRID, 'items-end px-0 pb-1 text-[12px] text-[#e7ebee]')}>
            <span />
            <span className="col-span-2 text-center">Связи</span>
            <span className="col-span-2 text-center">ЧС</span>
            <span className="text-center">Опер.</span>
            <span className="text-center">АРМ</span>
            <span className="text-center">Номер</span>
            <span className="flex items-center justify-center gap-0.5">
              Дата <IcChevronDown size={14} />
            </span>
            <span className="text-center">Время</span>
            <span className="pl-1">Тип происшествия</span>
            <span className="text-center">Постр.</span>
            <span className="pl-1">Адрес</span>
            <span className="pl-1">Статус службы</span>
            <span />
          </div>

          {sorted.length === 0 && <div className="py-10 text-center text-[13px] text-[#e7ebee]">Карточек нет</div>}

          <div className="flex flex-col gap-2.5">
            {sorted.map((inc) => {
              const own = inc.services.find((s) => s.serviceId === serviceId);
              const st = own ? currentStatus(own.history) : '—';
              const isNew = st === 'Добавлена';
              const addr = journalAddress(inc.address);
              const desc = inc.descriptions[inc.descriptions.length - 1];
              const open = expanded === inc.id;
              const isCurrent = inc.id === currentId;
              return (
                <div key={inc.id} className={cx(isNew && 'row-arrive')}>
                  <div
                    className={cx(GRID, 'h-[31px] cursor-pointer items-stretch bg-arm-dark text-[12px] hover:brightness-110')}
                    onClick={() => onOpen(inc.id)}
                    data-step={isCurrent ? 'row-current' : undefined}
                  >
                    <Cell>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpanded(open ? null : inc.id);
                        }}
                        aria-label="Предпросмотр"
                        className="flex h-full w-full items-center justify-center"
                      >
                        {open ? <IcChevronUp size={18} /> : <IcChevronDown size={18} />}
                      </button>
                    </Cell>
                    <Cell>{inc.linkedIds.length > 0 && <IcLink size={16} />}</Cell>
                    <Cell>
                      <IcBookmark size={16} className="text-[#6c757c]" />
                    </Cell>
                    <Cell>
                      <IcBolt size={16} className={inc.flags.important ? 'text-arm-orange' : 'text-[#d7dcdf]'} />
                    </Cell>
                    <Cell>
                      <IcTimer size={16} className="text-[#d7dcdf]" />
                    </Cell>
                    <Cell className={isNew ? 'bg-arm-oper' : ''}>{inc.operator?.num ?? '0'}</Cell>
                    <Cell>{inc.operator?.arm ?? ''}</Cell>
                    <Cell>{inc.id}</Cell>
                    <Cell>{ddmmyy(inc.createdAt)}</Cell>
                    <Cell className="justify-start pl-1 text-[16px] font-bold">
                      {hhmm(inc.createdAt)}
                      <sup className="ml-px text-[10px]">{ss(inc.createdAt)}</sup>
                    </Cell>
                    <Cell className="justify-start truncate pl-1.5 text-[15px] font-bold">{inc.type.card}</Cell>
                    <Cell>{inc.flags.victims ? 'Есть' : 'Нет'}</Cell>
                    <Cell className="justify-between gap-2 pl-1.5">
                      <span className="truncate text-[13px]">
                        <b>{addr.strong}</b>
                        <span className="text-[#dfe3e6]">{addr.rest}</span>
                      </span>
                      <IcMapOff size={16} className="shrink-0 text-arm-orange" />
                    </Cell>
                    <Cell className={cx('justify-start pl-2 text-[12px]', isNew ? 'text-white' : 'text-[#cfd5d9]')}>{st}</Cell>
                    <Cell>
                      <IcClipboard size={18} />
                    </Cell>
                  </div>
                  {desc && (
                    <div className="flex h-[29px] items-center gap-3 bg-arm-sub px-2 text-[12px]">
                      <span className="w-[80px] shrink-0 text-[#e1e6e9]">Описание:</span>
                      <span className="truncate">
                        <span className="text-[#dde2e5]">
                          {dateTime(desc.at)} {desc.author} -{' '}
                        </span>
                        <b className="text-[13px]">{desc.text}</b>
                      </span>
                    </div>
                  )}
                  {open && <Preview inc={inc} />}
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-end gap-4 text-[12px] text-[#eef1f3]">
            <span>
              Страница: <b>1</b> ▾
            </span>
            <span>
              Записей на странице: <b>10</b> ▾
            </span>
            <b>
              1-{sorted.length} из {sorted.length}
            </b>
            <IcChevronLeft size={18} />
            <IcChevronRight size={18} />
          </div>
        </>
      )}
    </div>
  );
}

function Cell({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={cx('flex min-w-0 items-center justify-center border-r border-[#48525a] last:border-r-0', className)}>{children}</div>;
}

function Preview({ inc }: { inc: Incident }) {
  const line = 'flex gap-3 border-t border-[#5b666e] bg-arm-sub px-2 py-1.5 text-[12px]';
  return (
    <div>
      <div className={line}>
        <span className="w-[80px] shrink-0 text-[#e1e6e9]">Службы:</span>
        <span className="flex flex-wrap gap-x-3">
          {inc.services.map((s) => {
            const last = s.history[s.history.length - 1];
            return (
              <span key={s.serviceId}>
                <b className="text-[14px]">{s.name}</b>
                {last && (
                  <span className="text-[#dde2e5]">
                    {' '}
                    – {hhmmss(last.at)} {last.status}
                  </span>
                )}
              </span>
            );
          })}
        </span>
      </div>
      <div className={line}>
        <span className="w-[80px] shrink-0 text-[#e1e6e9]">Заявитель:</span>
        <span className="flex flex-wrap items-baseline gap-x-3">
          <b className="text-[14px]">{inc.applicant.name || '—'}</b>
          <span className="text-[#dde2e5]">АОН {inc.phones.aon || '—'}</span>
          <span className="text-[#dde2e5]">предоставленный телефон {inc.phones.provided || '—'}</span>
          {inc.channel && (
            <span className="text-[#dde2e5]">
              Канал связи: <b className="text-white">{inc.channel}</b>
            </span>
          )}
        </span>
      </div>
      <div className={line}>
        <span className="w-[80px] shrink-0 text-[#e1e6e9]">Информация:</span>
        <b className="text-[13px]">{[...inc.type.signs, inc.type.finalType].filter(Boolean).join('. ')}.</b>
      </div>
    </div>
  );
}
