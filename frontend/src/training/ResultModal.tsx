import { useState, type ReactNode } from 'react';
import { useDb } from '../api/db';
import { SKILL_LABELS } from '../domain/skills';
import type { CardResult } from '../store/training';
import { cx } from '../ui/cx';

/*
 * Разбор после карточки — в стиле модальных окон АРМ («Список оповещаемых служб»):
 * белое окно без скруглений, крупный жирный заголовок, кнопки с оранжевой рамкой.
 * Балл — в тёмном блоке, как таймер карточки 112; незачёт — красным.
 */

const orangeBtn = 'h-10 border border-arm-orange bg-white px-4 text-[15px] text-arm-orange hover:bg-[#fbe6de]';

export function ResultModal({ result, isLast, onNext }: { result: CardResult; isLast: boolean; onNext: () => void }) {
  const [showRef, setShowRef] = useState(false);
  const scenarios = useDb((s) => s.db.scenarios);
  const ev = result.evaluation;
  const sc = result.scenario;

  if (!ev) {
    return (
      <Overlay width={560}>
        <div className="px-6 pt-5 pb-5">
          <h3 className="text-[24px] font-bold">Демонстрация записана</h3>
          <p className="mt-2 text-[14px]">
            Сохранено шагов: <b>{result.recordedSteps}</b>. Сценарий «{sc.title}» теперь проходит в режиме «делай как я» по вашей записи.
          </p>
          <div className="mt-5 flex justify-end">
            <button className={cx(orangeBtn, 'font-bold')} onClick={onNext}>
              вернуться к сценариям
            </button>
          </div>
        </div>
      </Overlay>
    );
  }

  const next = ev.recommendation.nextScenarioId ? scenarios.find((s) => s.id === ev.recommendation.nextScenarioId) : undefined;
  const sec = (v: number | null) => (v === null ? '—' : `${Math.round(v)} с`);

  return (
    <Overlay width={900}>
      <header className="flex items-stretch justify-between gap-4 px-6 pt-5">
        <div className="min-w-0">
          <div className="text-[12px] text-arm-muted">Разбор карточки</div>
          <h3 className="text-[24px] leading-tight font-bold">{sc.title}</h3>
          <p className="mt-1 text-[14px]">{ev.summary}</p>
        </div>
        <div className={cx('flex w-[110px] shrink-0 flex-col items-center justify-center text-white', ev.passed ? 'bg-arm-dark' : 'bg-[#ff0000]')}>
          <span className="text-[36px] leading-none font-bold">{ev.score}</span>
          <span className="mt-1 text-[11px]">{ev.passed ? 'зачёт' : 'незачёт'} · из 100</span>
        </div>
      </header>

      <div className="max-h-[62vh] overflow-y-auto px-6 py-4">
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-5">
          <Metric label="открытие" value={sec(ev.openSec)} sub="норматив 30 с" bad={ev.openSec === null || ev.openSec > 30} />
          <Metric label="первичный статус" value={sec(ev.primarySec)} sub="после поступления" />
          <Metric label="отработка" value={sec(ev.totalSec)} sub="норматив 180 с" bad={ev.totalSec > 180} />
          <Metric label="скорость набора" value={ev.cpm === null ? '—' : `${ev.cpm}`} sub="знаков в минуту" />
          <Metric label="прогноз до попытки" value={`${Math.round(ev.predicted * 100)}%`} sub={ev.passed === ev.predicted >= 0.5 ? 'сбылся' : 'не сбылся'} />
        </div>

        <table className="mt-3 w-full text-[13px]">
          <thead>
            <tr className="bg-arm-type text-left text-[12px] text-white">
              <th className="w-5 px-2 py-1" />
              <th className="px-2 py-1 font-bold">проверка</th>
              <th className="px-2 py-1 font-normal">основание</th>
              <th className="px-2 py-1 text-right font-bold">баллы</th>
            </tr>
          </thead>
          <tbody>
            {ev.checks.map((c) => (
              <tr key={c.id} className="border-b border-[#d3d7da] align-top odd:bg-arm-block">
                <td className="px-2 py-1.5">
                  <span className={cx('mt-1 inline-block h-2.5 w-2.5', c.ok ? 'bg-[#2e7d32]' : c.points > 0 ? 'bg-arm-orange' : 'bg-[#ff0000]')} />
                </td>
                <td className="px-2 py-1.5">
                  <div className="font-bold">{c.title}</div>
                  <div className="text-arm-muted">{c.detail}</div>
                </td>
                <td className="px-2 py-1.5 text-[12px] whitespace-nowrap text-arm-muted">{c.ref}</td>
                <td className="px-2 py-1.5 text-right font-bold whitespace-nowrap tabular-nums">
                  {c.points} / {c.max}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-3 bg-arm-blue px-3 py-2 text-[13px] text-white">
          <div className="text-[11px] text-[#d6e6f2]">рекомендация · навык «{SKILL_LABELS[ev.recommendation.skill]}»</div>
          <p className="leading-snug">{ev.recommendation.text}</p>
          {next && (
            <p className="mt-1 text-[#d6e6f2]">
              следующее задание: <b className="text-white">{next.title}</b> (сложность {next.difficulty})
            </p>
          )}
        </div>

        <button onClick={() => setShowRef((v) => !v)} className="mt-3 border border-[#8a8f93] bg-white px-3 py-1 text-[12px] hover:bg-[#e4e7e9]">
          {showRef ? 'скрыть эталон' : 'показать эталон'}
        </button>
        {showRef && (
          <div className="mt-2 bg-arm-block px-3 py-2 text-[13px] leading-relaxed">
            <div>
              <b>Статусы:</b> {sc.expected.path.map((s) => `«${s}»`).join(' → ')}
            </div>
            {Object.entries(sc.expected.sample).map(([st, text]) => (
              <div key={st}>
                <b>{st}:</b> {text}
              </div>
            ))}
            {sc.expected.callRequired && (
              <div>
                <b>Доклад:</b> {sc.expected.sampleReport}
              </div>
            )}
            <div className="mt-1 text-arm-muted">{sc.expected.explanation}</div>
          </div>
        )}
      </div>

      <footer className="flex justify-end gap-3 px-6 pt-1 pb-5">
        <button className={cx(orangeBtn, 'font-bold')} onClick={onNext}>
          {isLast ? 'завершить занятие' : 'следующая карточка'}
        </button>
      </footer>
    </Overlay>
  );
}

function Overlay({ children, width }: { children: ReactNode; width: number }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(40,44,48,0.5)] p-4">
      <div className="w-full bg-white text-arm-text shadow-[0_2px_12px_rgba(0,0,0,0.35)]" style={{ maxWidth: width }} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

function Metric({ label, value, sub, bad }: { label: string; value: string; sub: string; bad?: boolean }) {
  return (
    <div className="bg-arm-block px-3 py-2">
      <div className="text-[11px] text-arm-muted">{label}</div>
      <div className={cx('text-[20px] font-bold tabular-nums', bad && 'text-[#ff0000]')}>{value}</div>
      <div className="text-[11px] text-arm-muted">{sub}</div>
    </div>
  );
}
