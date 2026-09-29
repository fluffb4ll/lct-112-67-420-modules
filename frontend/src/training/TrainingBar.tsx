import { useNow } from '../app/hooks';
import { IcMonitor, IcRun } from '../arm/icons';
import { useRun } from '../store/training';
import { cx } from '../ui/cx';
import { MODE_LABELS } from './labels';

/*
 * Учебная полоса над эмулятором — в визуальном языке самого АРМ-112:
 * тёмная шапка #2f353a, синий блок активного раздела (как вкладка «журнал»),
 * таймеры как в карточке 112 (тёмный блок «минут / секунд», красный при превышении норматива),
 * квадратные кнопки с тонкой рамкой и подписями строчными буквами.
 */

const pad = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, '0');

function ArmTimer({ label, sec, norm }: { label: string; sec: number; norm: number }) {
  const over = sec > norm;
  return (
    <div className="flex h-full items-stretch">
      <div className={cx('flex w-[74px] flex-col items-center justify-center', over ? 'bg-[#ff0000]' : 'bg-arm-dark')}>
        <span className="text-[26px] leading-none font-bold text-white tabular-nums">
          {pad(sec / 60)}:{pad(sec % 60)}
        </span>
        <span className="mt-1 flex w-full justify-around text-[9px] text-white">
          <span>минут</span>
          <span>секунд</span>
        </span>
      </div>
      <div className="flex flex-col justify-center pl-2 text-[11px] leading-tight text-[#dfe3e6]">
        <span>{label}</span>
        <span className="text-[#aab4ba]">
          норма {pad(norm / 60)}:{pad(norm % 60)}
        </span>
      </div>
    </div>
  );
}

const btn = 'flex h-9 items-center border border-[#aab4ba] px-3 text-[12px] text-white hover:bg-arm-sub disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent';

export function TrainingBar({
  panelOpen,
  onTogglePanel,
  onFinish,
  onExit,
}: {
  panelOpen: boolean;
  onTogglePanel: () => void;
  onFinish: () => void;
  onExit: () => void;
}) {
  const run = useRun();
  const now = useNow(250);
  const cur = run.current;
  const end = cur?.finishedAt ?? now;
  const opened = run.events.find((e) => e.kind === 'opened');
  const openSec = cur ? (opened ? opened.t : end - cur.arrivedAt) / 1000 : 0;
  const totalSec = cur ? (end - cur.arrivedAt) / 1000 : 0;
  const isRecord = run.kind === 'record';
  const active = !!cur && !cur.finishedAt;
  // завершить можно только открытую карточку — иначе оценивать нечего
  const canFinish = active && !!opened;

  return (
    <div className="flex h-[56px] shrink-0 items-stretch border-b border-arm-sub bg-arm-dark text-white select-none">
      <div className="flex w-[92px] shrink-0 flex-col items-center justify-center gap-0.5 bg-arm-blue">
        <IcMonitor size={20} />
        <span className="text-[11px] font-bold">{isRecord ? 'запись' : 'обучение'}</span>
      </div>

      <div className="flex min-w-0 flex-col justify-center px-3">
        <div className="truncate text-[15px] font-bold">{run.title}</div>
        <div className="truncate text-[12px] text-[#dfe3e6]">
          {isRecord ? 'запись демонстрации «делай как я»' : `режим: ${MODE_LABELS[run.mode].toLowerCase()}`} · {run.service.short} · карточка{' '}
          {Math.min(run.index + 1, run.queue.length)} из {run.queue.length}
        </div>
      </div>

      <div className="ml-auto flex items-stretch gap-4 py-1.5 pr-4">
        {cur ? (
          <>
            <ArmTimer label="открытие карточки" sec={openSec} norm={run.norms.openSec} />
            <ArmTimer label="отработка" sec={totalSec} norm={run.norms.totalSec} />
          </>
        ) : (
          <span className="self-center text-[12px] text-[#dfe3e6]">{run.finishedAll ? 'занятие завершено' : 'ожидание поступления карточки…'}</span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-l border-arm-sub px-3">
        {run.mode !== 'exam' && !isRecord && (
          <button onClick={run.requestHint} disabled={!active} className={btn}>
            подсказка
          </button>
        )}
        <button onClick={onTogglePanel} className={cx(btn, panelOpen && 'bg-arm-sub')}>
          панель
        </button>
        <button
          data-step="finish-card"
          onClick={onFinish}
          disabled={!canFinish}
          title={active && !opened ? 'Сначала откройте карточку' : undefined}
          className="flex h-9 items-center border border-white px-4 text-[15px] font-bold text-white hover:bg-arm-sub disabled:cursor-default disabled:border-[#aab4ba] disabled:opacity-40 disabled:hover:bg-transparent"
        >
          {isRecord ? 'сохранить запись' : 'завершить карточку'}
        </button>
        <button onClick={onExit} className={cx(btn, 'gap-1.5')} title="Выйти из занятия">
          <IcRun size={15} />
          выйти
        </button>
      </div>
    </div>
  );
}
