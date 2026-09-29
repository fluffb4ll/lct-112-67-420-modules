import type { ReactNode } from 'react';
import { markRead } from '../api';
import { useDb } from '../api/db';
import { liveHints } from '../api/tutor';
import { useNow } from '../app/hooks';
import { IcCheck, IcChevronRight } from '../arm/icons';
import { hhmmss } from '../domain/format';
import { useRun } from '../store/training';
import { cx } from '../ui/cx';

/*
 * Правая панель учебного слоя — в стиле блоков карточки АРМ:
 * тёмная полоса-заголовок раздела, светлые блоки, вводные — синими строками,
 * как панель истории статусов службы. Подсказки в режиме аттестации отключены.
 */

export function SidePanel() {
  const run = useRun();
  const now = useNow(1000);
  const messages = useDb((s) => s.db.messages);
  const users = useDb((s) => s.db.users);
  const cur = run.current;
  const mine = run.user ? messages.filter((m) => m.to === run.user!.id && !m.read) : [];

  const hints = cur
    ? liveHints({
        mode: run.mode,
        events: run.events,
        elapsedSec: ((cur.finishedAt ?? now) - cur.arrivedAt) / 1000,
        normOpenSec: run.norms.openSec,
        normTotalSec: run.norms.totalSec,
        finished: !!cur.finishedAt,
      })
    : [];

  return (
    <aside className="flex w-[330px] shrink-0 flex-col gap-2 overflow-y-auto border-l border-arm-line bg-arm-card p-2 text-[13px] text-arm-text">
      {mine.length > 0 && (
        <Section title="сообщение преподавателя">
          {mine.map((m) => (
            <div key={m.id} className="border-l-4 border-arm-orange bg-white px-2 py-1.5">
              <div className="text-[11px] text-arm-muted">
                {users.find((u) => u.id === m.from)?.fullName} · {hhmmss(m.at)}
              </div>
              <div className="leading-snug">{m.text}</div>
            </div>
          ))}
          <button onClick={() => markRead(mine.map((m) => m.id))} className="mt-1 self-start border border-[#8a8f93] bg-white px-2 py-0.5 text-[12px] hover:bg-[#e4e7e9]">
            прочитано
          </button>
        </Section>
      )}

      {run.mode === 'demo' && run.demo.length > 0 && (
        <Section title={`делай как я · шаг ${Math.min(run.demoStep + 1, run.demo.length)} из ${run.demo.length}`}>
          <ol className="flex flex-col gap-1">
            {run.demo.map((s, i) => (
              <li
                key={i}
                className={cx(
                  'flex gap-2 px-2 py-1.5 leading-snug',
                  i === run.demoStep ? 'border-l-4 border-arm-orange bg-white font-medium' : i < run.demoStep ? 'text-arm-muted' : 'bg-[#e4e7e9]',
                )}
              >
                <span className="w-4 shrink-0 text-center">{i < run.demoStep ? <IcCheck size={14} className="mt-0.5 text-arm-blue" /> : `${i + 1}.`}</span>
                <span>{s.text}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <Section title="вводные">
        {!cur && <Muted>{run.finishedAll ? 'Занятие завершено.' : 'Карточка ещё не поступила. Следите за журналом.'}</Muted>}
        {cur && run.inputs.length === 0 && <Muted>Информация от бригады и ответы по телефону будут появляться здесь по ходу отработки.</Muted>}
        {run.inputs.length > 0 && (
          <div className="bg-arm-blue py-1 text-[12px] text-white">
            {run.inputs.map((x, i) => (
              <div key={i} className="px-2 py-1">
                <div className="flex items-center gap-1 text-[#d6e6f2]">
                  <IcChevronRight size={14} />
                  {hhmmss(new Date(x.at))} · {x.from}
                </div>
                <div className="pl-[18px] leading-snug">{x.text}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="подсказки">
        {run.mode === 'exam' ? (
          <Muted>В режиме аттестации подсказки отключены.</Muted>
        ) : (
          <>
            {hints.length === 0 && run.manualHints.length === 0 && <Muted>Замечаний нет. Нужна помощь — кнопка «подсказка» сверху.</Muted>}
            {hints.map((h) => (
              <div key={h.id} className={cx('border-l-4 bg-white px-2 py-1.5 leading-snug', h.tone === 'warn' ? 'border-arm-orange' : 'border-arm-blue')}>
                {h.text}
              </div>
            ))}
            {run.manualHints.map((h, i) => (
              <div key={i} className="border-l-4 border-arm-blue bg-white px-2 py-1.5 leading-snug">
                <div className="text-[11px] text-arm-muted">подсказка · {hhmmss(new Date(h.at))}</div>
                {h.text}
              </div>
            ))}
          </>
        )}
      </Section>

      {run.history.length > 0 && (
        <Section title="результаты занятия">
          {run.history.map((h, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <span className="truncate">
                {i + 1}. {h.title}
              </span>
              <b className={cx('shrink-0 tabular-nums', h.passed ? 'text-[#1f5a23]' : 'text-c-bad')}>{h.score}</b>
            </div>
          ))}
        </Section>
      )}
    </aside>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="bg-arm-type px-2 py-1 text-[12px] font-bold text-white">
        <span className="border-b border-dashed border-white">{title}</span>
      </h3>
      <div className="flex flex-col gap-1.5 bg-arm-block p-2">{children}</div>
    </section>
  );
}

const Muted = ({ children }: { children: ReactNode }) => <p className="leading-snug text-arm-muted">{children}</p>;
