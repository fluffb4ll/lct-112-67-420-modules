import { useMemo, useRef, useState, type ReactNode } from 'react';
import { addressLine, dateTime, hhmm } from '../domain/format';
import { COMMENT_REQUIRED, currentStatus, isClosed, nextStatuses } from '../domain/statusMachine';
import { TypingTracker } from '../domain/text';
import type { Incident, ResponseStatus, ServiceNotification } from '../domain/types';
import { cx } from '../ui/cx';
import {
  IcBolt,
  IcChevronDown,
  IcChevronRight,
  IcChevronUp,
  IcClose,
  IcCollapse,
  IcExpand,
  IcGlobe,
  IcHangup,
  IcHelp,
  IcMap,
  IcPencil,
  IcPhone,
  IcPrint,
  IcReport,
  IcSms,
  IcWarn,
  IcCheck,
} from './icons';

/*
 * Карточка происшествия на АРМ-112 в режиме ДДС (скриншоты учебного стенда и Памятки, стр. 16, 23–25):
 * сверху телефоны и номер карточки, слева заявитель/адрес/описание, справа тип происшествия,
 * снизу — панель «Службы» с историей статусов и формой проставления статуса своей службы.
 */

export interface StatusSubmit {
  status: ResponseStatus;
  orderNo: string;
  comment: string;
  typedChars: number;
  typingMs: number;
}

export function IncidentCard({
  incident,
  serviceId,
  phoneLabel,
  inCall,
  onPhone,
  onClose,
  onStatusForm,
  onStatus,
}: {
  incident: Incident;
  serviceId: string;
  phoneLabel: string;
  inCall: boolean;
  onPhone: () => void;
  onClose: () => void;
  onStatusForm: () => void;
  onStatus: (s: StatusSubmit) => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const own = incident.services.find((s) => s.serviceId === serviceId);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-arm-card text-arm-text">
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-2">
        <TopBar incident={incident} phoneLabel={phoneLabel} inCall={inCall} onPhone={onPhone} />
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,47%)_minmax(0,1fr)] gap-2">
          <div className="flex min-h-0 flex-col gap-2">
            <Block className="flex h-[42px] items-center">
              {incident.applicant.name ? (
                <span>
                  <b className="text-[14px]">{incident.applicant.name}</b>
                  <span className="ml-2 text-[12px] text-arm-muted">{incident.applicant.status}</span>
                </span>
              ) : (
                <span className="text-[11px] text-arm-muted">ФИО заявителя</span>
              )}
            </Block>
            <Block>
              <div className="flex items-start justify-between gap-2">
                <b className="text-[13px] leading-snug">{addressLine({ ...incident.address, descriptive: undefined })}</b>
                <IcMap size={18} className="shrink-0 text-arm-text" />
              </div>
              {incident.address.descriptive && <div className="mt-1 text-[13px]">{incident.address.descriptive}</div>}
            </Block>
            <Block className="min-h-[300px] flex-1">
              {incident.descriptions.map((d, i) => (
                <div key={i} className="mb-2 px-1 text-[13px]">
                  <div className="font-bold">
                    {dateTime(d.at)} <span className="ml-3">{d.author}</span>
                  </div>
                  <div>{d.text}</div>
                </div>
              ))}
            </Block>
          </div>
          <div className="flex min-h-0 flex-col gap-2">
            <div className="flex gap-2">
              <Block className="flex h-[42px] flex-1 items-center gap-3 text-[13px]">
                <span>Пострадавшие: {incident.flags.victims ? `есть${incident.flags.victimsCount ? ` (${incident.flags.victimsCount})` : ''}` : 'нет'}</span>
                <span>Отказ от скорой: {incident.flags.ambulanceRefused ? 'да' : 'нет'}</span>
                <span>Заблокированные: {incident.flags.blocked ? 'да' : 'нет'}</span>
              </Block>
              <Block className="flex h-[42px] items-center gap-2">
                <span className={cx('flex h-7 items-center gap-1 border px-2 text-[12px] font-bold', incident.flags.chs ? 'border-arm-orange bg-arm-orange text-white' : 'border-arm-line')}>
                  ЧС <IcBolt size={14} />
                </span>
                <span className={cx('flex h-7 items-center gap-1 border px-2 text-[12px] font-bold', incident.flags.chp ? 'border-arm-orange bg-arm-orange text-white' : 'border-arm-line')}>
                  ЧП <IcWarn size={14} />
                </span>
                <span className="ml-1 flex h-7 w-7 items-center justify-center rounded-full border border-arm-line text-arm-muted" title="Редактирование доступно специалисту 112">
                  <IcPencil size={14} />
                </span>
                <span className="ml-3 text-arm-muted">
                  <IcPrint size={18} />
                </span>
              </Block>
            </div>
            <div>
              <div className="bg-arm-type px-3 py-1.5 text-[13px] font-bold text-white">
                <span className="border-b border-dashed border-white">{/^\d+$/.test(incident.type.card) ? `Происшествие ${incident.type.card}` : incident.type.card}</span>
              </div>
              <div className="bg-arm-block px-3 py-2 text-[13px] font-bold">{incident.type.signs.length ? `${incident.type.signs.join('. ')}.` : ''}</div>
            </div>
            <Block className="text-[13px]">
              Класс.: <b>{incident.type.finalType}</b> ;
            </Block>
            <Block className="text-[13px]">[ВИС] Класс.: {incident.type.visClass ?? ''}</Block>
            {incident.source === 'VIS' && <Block className="text-[12px] text-arm-muted">Источник: {incident.sourceName}</Block>}
          </div>
        </div>
      </div>

      {formOpen && <div className="absolute inset-0 z-10 bg-[rgba(40,44,48,0.38)]" onClick={() => setFormOpen(false)} />}

      <ServicesBar
        services={incident.services}
        ownId={serviceId}
        formOpen={formOpen}
        onOpenForm={() => {
          setFormOpen(true);
          onStatusForm();
        }}
        onCloseForm={() => setFormOpen(false)}
        onSubmit={(s) => {
          setFormOpen(false);
          onStatus(s);
        }}
        ownClosed={own ? isClosed(own.history) : true}
        onClose={onClose}
      />
    </div>
  );
}

function Block({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('bg-arm-block px-2 py-2', className)}>{children}</div>;
}

function TopBar({ incident, phoneLabel, inCall, onPhone }: { incident: Incident; phoneLabel: string; inCall: boolean; onPhone: () => void }) {
  const phoneField = (label: string, value: string, extraIcons: ReactNode, aonBtn = false) => (
    <>
      <div className="flex w-9 shrink-0 flex-col items-center justify-center gap-3 text-[#5f676d]">
        <IcPhone size={20} />
        <IcSms size={15} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between bg-arm-block px-2 py-1">
        <div className="flex items-center justify-between text-[11px] text-arm-muted">
          {label}
          <span className="flex gap-1.5">{extraIcons}</span>
        </div>
        <div className="flex items-end justify-between gap-2">
          <span className="truncate text-[20px] leading-7 text-[#3e4449]">{value || <span className="text-[#9aa1a6]">&nbsp;</span>}</span>
          {aonBtn && <span className="mb-1 border border-arm-line bg-white px-1.5 text-[10px] text-arm-muted">АОН</span>}
        </div>
      </div>
    </>
  );
  return (
    <div className="flex h-[66px] shrink-0 gap-0">
      <button
        onClick={onPhone}
        data-step="softphone"
        className={cx('flex w-[280px] shrink-0 bg-arm-block text-left hover:brightness-[0.97]', inCall && 'ring-2 ring-[#3aa35c] ring-inset')}
        title="Телефон (учебный софтфон)"
      >
        <span className={cx('flex w-16 items-center justify-center', inCall ? 'text-[#2e8b4e]' : 'text-arm-text')}>
          {inCall ? <IcPhone size={26} /> : <IcHangup size={30} />}
        </span>
        <span className="flex flex-1 flex-col justify-center gap-1.5">
          <span className="text-[13px]">{phoneLabel}</span>
          <span className="flex gap-2">
            <span className="bg-[#c4c8cb] px-3 py-0.5 text-[10px] text-[#6d7378]">записи звонков</span>
            <span className="border border-[#9aa1a6] bg-white px-3 py-0.5 text-[10px]">список SMS</span>
          </span>
        </span>
      </button>
      {phoneField(
        'АОН',
        incident.phones.aon,
        <>
          <IcHelp size={13} />
          <IcGlobe size={13} />
        </>,
      )}
      {phoneField('предоставленный', incident.phones.provided, <IcGlobe size={13} />, true)}
      {phoneField('телефон на место', incident.phones.onSite, <IcGlobe size={13} />, true)}
      <div className="ml-2 flex w-[210px] shrink-0 flex-col justify-center bg-arm-block px-2">
        <b className="text-[16px]">Происшествие {incident.id}</b>
        <span className="text-[12px]">
          Сохр. {dateTime(incident.createdAt).replace(' ', ' в ')}
        </span>
        <span className="truncate text-[12px]">
          Опер. {incident.operator?.num ?? ''}, АРМ {incident.operator?.arm ?? ''}, {incident.operator?.name ?? incident.sourceName ?? ''}
        </span>
      </div>
      <div className="ml-2 flex w-[96px] shrink-0 flex-col gap-1.5">
        <span className="flex h-[30px] items-center justify-center bg-arm-blue text-[11px] text-white">просмотр</span>
        <span className="flex h-[30px] items-center justify-center bg-arm-dark text-[11px] text-white">дополнение</span>
      </div>
    </div>
  );
}

const TABS_PER_ROW = 8;

function ServicesBar({
  services,
  ownId,
  formOpen,
  onOpenForm,
  onCloseForm,
  onSubmit,
  ownClosed,
  onClose,
}: {
  services: ServiceNotification[];
  ownId: string;
  formOpen: boolean;
  onOpenForm: () => void;
  onCloseForm: () => void;
  onSubmit: (s: StatusSubmit) => void;
  ownClosed: boolean;
  onClose: () => void;
}) {
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const main = services.slice(0, TABS_PER_ROW);
  const extra = services.slice(TABS_PER_ROW);
  const own = services.find((s) => s.serviceId === ownId);
  const shown = historyOf ? services.find((s) => s.serviceId === historyOf) : null;

  const tab = (s: ServiceNotification) => {
    const last = s.history[s.history.length - 1];
    const isOwn = s.serviceId === ownId;
    return (
      <div key={s.serviceId} className={cx('relative flex h-[64px] w-[108px] shrink-0 flex-col items-center border-r border-[#5d6a73] pt-0.5 text-white', historyOf === s.serviceId && 'bg-[#5d6a73]')}>
        <button onClick={() => setHistoryOf(historyOf === s.serviceId ? null : s.serviceId)} aria-label={`История статусов: ${s.name}`} className="text-[#d9dfe3] hover:text-white">
          {historyOf === s.serviceId ? <IcChevronDown size={14} /> : <IcChevronUp size={14} />}
        </button>
        {isOwn && !ownClosed && (
          <button
            data-step="service-pencil"
            onClick={() => {
              setHistoryOf(null);
              onOpenForm();
            }}
            aria-label="Проставить статус"
            className="absolute top-1 right-1.5 text-white hover:text-arm-orange"
          >
            <IcPencil size={13} />
          </button>
        )}
        <span className={cx('max-w-full truncate px-1 text-[13px] font-bold', s.main && 'underline underline-offset-2')}>
          {s.name}
          {s.via === 'VIS' && <sup className="ml-0.5 text-[8px] font-normal">ВИС</sup>}
        </span>
        {last && (
          <span className="max-w-full truncate px-1 text-[11px] text-[#e3e8eb]">
            {hhmm(last.at)} {last.status}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="relative z-20 shrink-0">
      {shown && (
        <div className="absolute bottom-full left-[72px] mb-0 w-[600px] max-w-[80vw] bg-arm-blue text-[12px] text-white shadow-lg">
          <div className="flex items-center justify-between px-2 py-1.5">
            <b>{shown.name}</b>
            <button onClick={() => setHistoryOf(null)} aria-label="Закрыть">
              <IcClose size={16} />
            </button>
          </div>
          <div className="max-h-[220px] overflow-y-auto pb-2">
            {shown.history.map((h, i) => (
              <div key={i} className="grid grid-cols-[60px_16px_1fr_16px_1.2fr] items-start px-2 py-0.5">
                <span>{h.operator}</span>
                <IcChevronRight size={14} />
                <span>
                  {dateTime(h.at)} {h.status}
                  {h.orderNo && <span className="text-[#cfe3f1]"> · наряд {h.orderNo}</span>}
                </span>
                {h.comment ? <IcChevronRight size={14} /> : <span />}
                <span className="whitespace-pre-wrap">{h.comment}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {formOpen && own && <StatusForm own={own} onCancel={onCloseForm} onSubmit={onSubmit} />}
      {expanded && extra.length > 0 && <div className="flex bg-arm-sub pl-[72px]">{extra.map(tab)}</div>}
      <div className="flex h-[64px] items-stretch bg-arm-sub">
        <span className="flex w-[72px] shrink-0 items-center pl-2 text-[13px] text-[#e7ebee]">Службы:</span>
        <div className="flex min-w-0 flex-1 overflow-hidden">
          {main.map(tab)}
          {extra.length > 0 && (
            <button onClick={() => setExpanded((v) => !v)} className="mx-3 my-3 flex w-10 items-center justify-center border border-[#aab4ba] text-white" aria-label="Показать все службы">
              {expanded ? <IcCollapse size={20} /> : <IcExpand size={20} />}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 pr-2">
          <span className="flex h-10 w-10 items-center justify-center border border-[#aab4ba] text-white" title="Сообщить о проблеме">
            <IcReport size={20} />
          </span>
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center border border-[#aab4ba] text-white hover:bg-[#5d6a73]" aria-label="Закрыть карточку">
            <IcClose size={22} />
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusForm({ own, onCancel, onSubmit }: { own: ServiceNotification; onCancel: () => void; onSubmit: (s: StatusSubmit) => void }) {
  const options = useMemo(() => nextStatuses(own.history), [own.history]);
  const [status, setStatus] = useState<ResponseStatus | ''>('');
  const [open, setOpen] = useState(false);
  const [orderNo, setOrderNo] = useState(() => [...own.history].reverse().find((h) => h.orderNo)?.orderNo ?? '');
  const [comment, setComment] = useState('');
  const tracker = useRef(new TypingTracker());
  const current = currentStatus(own.history);

  const submit = () => {
    if (!status) return;
    onSubmit({ status, orderNo, comment, typedChars: tracker.current.chars, typingMs: tracker.current.activeMs });
  };

  return (
    <div data-step="status-form" className="absolute bottom-full left-[72px] mb-2 flex w-[1040px] max-w-[calc(100vw-120px)] items-center gap-3 bg-white px-2 py-1.5 shadow-[0_2px_10px_rgba(0,0,0,0.35)]">
      <div className="relative w-[300px] shrink-0">
        <button onClick={() => setOpen((v) => !v)} className="flex h-8 w-full items-center justify-between border-b border-[#555] px-1 text-[13px]">
          <span className={status ? 'text-arm-text' : 'text-arm-muted'}>{status || 'Статус'}</span>
          <IcChevronDown size={18} />
        </button>
        {open && (
          <div className="absolute bottom-full left-0 mb-0.5 w-full border border-arm-line bg-white shadow-md">
            {options.length === 0 && <div className="px-2 py-1.5 text-[13px] text-arm-muted">Нет доступных статусов (текущий: {current})</div>}
            {options.map((o) => (
              <button
                key={o}
                onClick={() => {
                  setStatus(o);
                  setOpen(false);
                }}
                className={cx('block w-full px-2 py-1.5 text-left text-[13px] hover:bg-arm-blue hover:text-white', status === o && 'bg-arm-blue text-white')}
              >
                {o}
              </button>
            ))}
          </div>
        )}
      </div>
      <input
        value={orderNo}
        onChange={(e) => setOrderNo(e.target.value)}
        placeholder="Номер наряда"
        className="h-8 w-[300px] shrink-0 border-b border-[#555] px-1 text-[13px] outline-none placeholder:text-arm-muted"
      />
      <input
        autoFocus
        value={comment}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') onCancel();
        }}
        onChange={(e) => {
          tracker.current.added(e.target.value.length - comment.length);
          setComment(e.target.value);
        }}
        placeholder={status && COMMENT_REQUIRED.includes(status) ? 'Комментарий (обязательно)' : 'Комментарий'}
        className="h-8 min-w-0 flex-1 border-b border-[#555] px-1 text-[13px] outline-none placeholder:text-arm-muted"
      />
      <button
        onClick={submit}
        disabled={!status}
        aria-label="Сохранить статус"
        className={cx('flex h-8 w-8 items-center justify-center border', status ? 'border-arm-orange text-arm-orange hover:bg-[#fff1ec]' : 'border-arm-line text-[#b3b9bd]')}
      >
        <IcCheck size={20} />
      </button>
      <button onClick={onCancel} aria-label="Отмена" className="flex h-8 w-8 items-center justify-center border border-arm-line text-arm-muted hover:bg-arm-block">
        <IcClose size={18} />
      </button>
    </div>
  );
}
