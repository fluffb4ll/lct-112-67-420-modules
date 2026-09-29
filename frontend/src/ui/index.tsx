import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cx } from './cx';

/*
 * Примитивы кабинетов в визуальном языке АРМ-112:
 * прямые углы, без теней; блоки #efefef на фоне экрана карточки #c9ced1;
 * заголовок блока — тёмная полоса, как «Происшествие 101» в карточке;
 * кнопки как «просмотр» (синяя), «дополнение» (тёмная), «сбросить» (с рамкой);
 * поля ввода с подчёркиванием, как в форме статуса и карточке 112.
 */

type BtnVariant = 'primary' | 'secondary' | 'dark' | 'ghost' | 'danger' | 'success' | 'accent';

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' }) {
  const v: Record<BtnVariant, string> = {
    primary: 'bg-arm-blue text-white border-arm-blue hover:bg-arm-blue-hover',
    dark: 'bg-arm-dark text-white border-arm-dark hover:bg-arm-sub',
    secondary: 'bg-white text-arm-text border-[#8a8f93] hover:bg-[#e4e7e9]',
    ghost: 'bg-transparent text-arm-blue border-transparent hover:underline',
    danger: 'bg-white text-c-bad border-c-bad hover:bg-c-bad-soft',
    success: 'bg-white text-arm-orange border-arm-orange hover:bg-[#fbe6de]',
    accent: 'bg-arm-orange text-white border-arm-orange hover:brightness-110',
  };
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 border whitespace-nowrap disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-9 px-4 text-[13px]',
        v[variant],
        className,
      )}
    />
  );
}

/** Блок с тёмной полосой-заголовком, как блок типа происшествия в карточке АРМ */
export function Panel({ title, actions, children, className, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx('bg-c-surface', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 bg-arm-type px-3 py-1.5">
          <h2 className="text-[13px] font-bold text-white">
            <span className="border-b border-dashed border-white">{title}</span>
          </h2>
          {actions && <div className="flex flex-wrap items-center gap-2 [&_button]:border-[#aab4ba]">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'p-3' : ''}>{children}</div>
    </section>
  );
}

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <span className="block text-[11px] text-arm-muted">
      {children}
      {hint && <span className="ml-1 text-[#8a9096]">({hint})</span>}
    </span>
  );
}

const lineField =
  'w-full border-0 border-b border-[#8a8f93] bg-transparent px-1 text-[14px] text-arm-text outline-none focus:border-b-2 focus:border-arm-blue disabled:text-arm-muted';

export function Input({ label, hint, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; hint?: ReactNode }) {
  return (
    <label className={cx('block', className)}>
      {label && <Label hint={hint}>{label}</Label>}
      <input {...rest} className={cx(lineField, 'h-8')} />
    </label>
  );
}

export function Select({ label, hint, className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label?: ReactNode; hint?: ReactNode }) {
  return (
    <label className={cx('block', className)}>
      {label && <Label hint={hint}>{label}</Label>}
      <select {...rest} className={cx(lineField, 'h-8 pr-6')}>
        {children}
      </select>
    </label>
  );
}

export function Textarea({ label, hint, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; hint?: ReactNode }) {
  return (
    <label className={cx('block', className)}>
      {label && <Label hint={hint}>{label}</Label>}
      <textarea
        {...rest}
        className="mt-0.5 min-h-16 w-full border border-[#b9bfc3] bg-white px-2 py-1.5 text-[14px] leading-snug text-arm-text outline-none focus:border-arm-blue"
      />
    </label>
  );
}

export function Checkbox({ checked, onChange, children, disabled }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('flex cursor-pointer items-start gap-2 text-[13px]', disabled && 'cursor-default opacity-60')}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#157dbd]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad';

/** Метка статуса — плоская, как ячейка «Статус службы» / «Добавлена» в АРМ */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  const t: Record<Tone, string> = {
    neutral: 'bg-[#dfe2e4] text-arm-text',
    accent: 'bg-arm-blue text-white',
    ok: 'bg-[#dcebdd] text-[#1f5a23]',
    warn: 'bg-[#fbe6de] text-[#9c3a17]',
    bad: 'bg-arm-oper text-white',
  };
  return <span className={cx('inline-flex items-center px-1.5 py-0.5 text-[11px] whitespace-nowrap', t[tone])}>{children}</span>;
}

/** Вкладки внутри блока — как переключатели в тёмной полосе АРМ */
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode }[] }) {
  return (
    <div className="flex overflow-x-auto overflow-y-hidden bg-arm-sub" role="tablist">
      {items.map((it) => (
        <button
          key={it.id}
          role="tab"
          aria-selected={value === it.id}
          onClick={() => onChange(it.id)}
          className={cx('border-r border-[#5d6a73] px-3 py-2 text-[12px] whitespace-nowrap text-white', value === it.id ? 'bg-arm-blue font-bold' : 'hover:bg-[#5d6a73]')}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Модальное окно в стиле окон АРМ («Список оповещаемых служб», «Добавьте службы») */
export function Modal({ title, onClose, children, footer, width = 560 }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(40,44,48,0.5)] p-4 sm:items-center" onMouseDown={onClose}>
      <div className="w-full bg-white shadow-[0_2px_12px_rgba(0,0,0,0.35)]" style={{ maxWidth: width }} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
          <h3 className="text-[22px] font-bold text-arm-text">{title}</h3>
          <button onClick={onClose} aria-label="Закрыть" className="mt-1 text-arm-text hover:text-arm-blue">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-3">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-3 px-5 pt-2 pb-4">{footer}</footer>}
      </div>
    </div>
  );
}

/** Подтверждение действия — вместо системного window.confirm (он блокируется встроенными браузерами) */
export function ConfirmModal({
  title,
  text,
  confirm,
  cancel = 'вернуться',
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  text?: ReactNode;
  confirm: string;
  cancel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      width={520}
      footer={
        <>
          <Button variant="success" onClick={onCancel} className="h-10 px-4 text-[15px]">
            {cancel}
          </Button>
          <Button variant={danger ? 'danger' : 'success'} onClick={onConfirm} className="h-10 px-4 text-[15px] font-bold">
            {confirm}
          </Button>
        </>
      }
    >
      {text && <div className="text-[14px] leading-snug text-arm-text">{text}</div>}
    </Modal>
  );
}

/** Показатель — как информационный блок карточки: подпись мелко, значение крупно */
export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  const color = tone === 'ok' ? 'text-[#1f5a23]' : tone === 'bad' ? 'text-c-bad' : tone === 'warn' ? 'text-[#9c3a17]' : 'text-arm-text';
  return (
    <div className="bg-c-surface px-3 py-2">
      <div className="text-[11px] text-arm-muted">{label}</div>
      <div className={cx('text-[26px] leading-tight font-bold', color)}>{value}</div>
      {sub && <div className="text-[11px] text-arm-muted">{sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="border border-dashed border-[#b9bfc3] px-4 py-6 text-center text-[13px] text-arm-muted">{children}</div>;
}

/** Уведомление — полоса с цветной кромкой слева, без скруглений */
export function Notice({ tone = 'accent', children }: { tone?: Tone; children: ReactNode }) {
  const t: Record<Tone, string> = {
    neutral: 'border-[#8a8f93] bg-[#e4e7e9]',
    accent: 'border-arm-blue bg-[#dde9f3]',
    ok: 'border-c-ok bg-[#dcebdd]',
    warn: 'border-arm-orange bg-[#fbe6de]',
    bad: 'border-c-bad bg-[#f3d9d9]',
  };
  return <div className={cx('border-l-4 px-3 py-2 text-[13px] leading-snug text-arm-text', t[tone])}>{children}</div>;
}

/** Таблица в стиле списков АРМ: мелкие серые заголовки, строки с тонкими разделителями */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px] [&_td]:border-t [&_td]:border-[#d3d7da] [&_td]:px-3 [&_td]:py-1.5 [&_td]:align-top [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-normal [&_th]:whitespace-nowrap [&_th]:text-arm-muted [&_tbody_tr:hover]:bg-[#e2e5e7]">
        {children}
      </table>
    </div>
  );
}
