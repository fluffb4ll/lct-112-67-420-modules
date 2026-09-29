import { useState, type ReactNode } from 'react';

/*
 * Лёгкие SVG/HTML-графики без сторонних библиотек (закрытый контур, офлайн).
 * Правила: тонкие марки, скруглённый конец столбца, волосяная сетка, подписи — цветом текста,
 * легенда при двух и более рядах, подсказка при наведении, значения доступны и без графика (таблицы рядом).
 * Цвета рядов проверены валидатором палитры на различимость при цветовой слепоте.
 */

// Ряды — синий и оранжевый самого АРМ-112 (пара прошла проверку на различимость при цветовой слепоте)
const SERIES = ['#157dbd', '#ec653b', '#1baf7a', '#eda100'];
const SEQ = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281'];
const GRID = '#d3d7da';
const INK = '#222629';
const MUTED = '#5f676d';

/** Горизонтальные столбцы одного ряда: значение у конца столбца */
export function HBars({ items, max = 100, unit = '', format }: { items: { label: ReactNode; value: number; hint?: string }[]; max?: number; unit?: string; format?: (v: number) => string }) {
  const f = format ?? ((v: number) => `${Math.round(v)}${unit}`);
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((it, i) => (
        <div key={i} className="grid grid-cols-[minmax(110px,190px)_1fr] items-center gap-3 text-[13px]" title={it.hint ?? `${f(it.value)}`}>
          <span className="truncate text-c-text">{it.label}</span>
          <span className="flex items-center gap-2">
            <span className="relative h-3 flex-1 bg-[#dfe2e4]">
              <span className="absolute inset-y-0 left-0 bg-arm-blue" style={{ width: `${Math.max(0, Math.min(100, (it.value / max) * 100))}%` }} />
            </span>
            <span className="w-12 text-right font-medium text-c-text tabular-nums">{f(it.value)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Тепловая карта: одна последовательная шкала (синий), значение в ячейке, подсказка при наведении */
export function Heatmap({
  rows,
  cols,
  value,
  format = (v) => `${Math.round(v)}%`,
  detail,
  legend,
}: {
  rows: string[];
  cols: string[];
  value: (r: string, c: string) => number | null;
  format?: (v: number) => string;
  detail?: (r: string, c: string) => string;
  legend: string;
}) {
  const [hover, setHover] = useState<{ r: string; c: string } | null>(null);
  const all = rows.flatMap((r) => cols.map((c) => value(r, c))).filter((v): v is number => v !== null);
  const hi = Math.max(1, ...all);
  const colorOf = (v: number) => SEQ[Math.min(SEQ.length - 1, Math.floor((v / hi) * (SEQ.length - 1)))];
  const inkOn = (v: number) => (v / hi > 0.55 ? '#ffffff' : INK);
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-[2px] text-[12px]">
          <thead>
            <tr>
              <th />
              {cols.map((c) => (
                <th key={c} className="max-w-[110px] px-1 pb-1 text-left align-bottom font-normal text-c-muted">
                  <span className="line-clamp-2">{c}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r}>
                <th className="pr-2 text-left font-normal text-c-text">
                  <span className="block max-w-[230px] truncate" title={r}>
                    {r}
                  </span>
                </th>
                {cols.map((c) => {
                  const v = value(r, c);
                  const on = hover?.r === r && hover?.c === c;
                  return (
                    <td
                      key={c}
                      tabIndex={0}
                      onMouseEnter={() => setHover({ r, c })}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover({ r, c })}
                      onBlur={() => setHover(null)}
                      className="h-9 min-w-[72px] text-center font-medium tabular-nums outline-none"
                      style={{ background: v === null ? '#e4e7e9' : colorOf(v), color: v === null ? MUTED : inkOn(v), boxShadow: on ? `0 0 0 2px ${INK}` : undefined }}
                    >
                      {v === null ? '—' : format(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-c-muted">
        <span className="flex items-center gap-1">
          0
          <span className="flex">
            {SEQ.map((c) => (
              <span key={c} className="h-2.5 w-4" style={{ background: c }} />
            ))}
          </span>
          {format(hi)}
        </span>
        <span>{legend}</span>
        {hover && detail && <span className="text-c-text">{detail(hover.r, hover.c)}</span>}
      </div>
    </div>
  );
}

/** Линии по дням (не больше 4 рядов): легенда, подписи у концов, перекрестие и подсказка */
export function LineChart({ series, xLabels, height = 220, yMax = 100 }: { series: { name: string; values: (number | null)[] }[]; xLabels: string[]; height?: number; yMax?: number }) {
  const [hi, setHi] = useState<number | null>(null);
  // широкая система координат — чтобы подписи при растяжении на ширину блока оставались размером с обычный текст
  const W = 1040;
  const H = height;
  const pad = { l: 36, r: 150, t: 12, b: 26 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (xLabels.length <= 1 ? iw / 2 : (i / (xLabels.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / yMax) * ih;
  const ticks = [0, 25, 50, 75, 100].filter((t) => t <= yMax);
  // подписи у концов линий — только если они не сталкиваются; иначе идентификацию несёт легенда
  const ends = series
    .map((s) => {
      const i = s.values.map((v, k) => (v === null ? -1 : k)).filter((k) => k >= 0).pop();
      return i === undefined ? null : y(s.values[i]!);
    })
    .filter((v): v is number => v !== null);
  const endLabels = ends.every((a, i) => ends.every((b, j) => i === j || Math.abs(a - b) >= 14));
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-4 text-[12px] text-c-muted">
        {series.map((s, i) => (
          <span key={s.name} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4" style={{ background: SERIES[i] }} />
            {s.name}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" onMouseLeave={() => setHi(null)} role="img" aria-label="Динамика среднего балла">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill={MUTED}>
              {t}
            </text>
          </g>
        ))}
        {xLabels.map((l, i) =>
          i % Math.ceil(xLabels.length / 8) === 0 || i === xLabels.length - 1 ? (
            <text key={l + i} x={x(i)} y={H - 6} textAnchor="middle" fontSize={11} fill={MUTED}>
              {l}
            </text>
          ) : null,
        )}
        {hi !== null && <line x1={x(hi)} x2={x(hi)} y1={pad.t} y2={pad.t + ih} stroke="#b9c1c8" strokeWidth={1} />}
        {series.map((s, si) => {
          const pts = s.values.map((v, i) => (v === null ? null : ([x(i), y(v)] as const)));
          const segs: string[] = [];
          let cur = '';
          pts.forEach((p) => {
            if (!p) {
              if (cur) segs.push(cur);
              cur = '';
            } else cur += `${cur ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
          });
          if (cur) segs.push(cur);
          const lastIdx = s.values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop();
          return (
            <g key={s.name}>
              {segs.map((d, k) => (
                <path key={k} d={d} fill="none" stroke={SERIES[si]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {lastIdx !== undefined && (
                <>
                  <circle cx={x(lastIdx)} cy={y(s.values[lastIdx]!)} r={4} fill={SERIES[si]} stroke="#fff" strokeWidth={2} />
                  {endLabels && (
                    <text x={x(lastIdx) + 8} y={y(s.values[lastIdx]!) + 4} fontSize={11} fill={INK}>
                      {s.name.length > 14 ? `${s.name.slice(0, 13)}…` : s.name}: {Math.round(s.values[lastIdx]!)}
                    </text>
                  )}
                </>
              )}
              {hi !== null && s.values[hi] !== null && <circle cx={x(hi)} cy={y(s.values[hi]!)} r={4} fill={SERIES[si]} stroke="#fff" strokeWidth={2} />}
            </g>
          );
        })}
        {xLabels.map((_, i) => (
          <rect key={i} x={x(i) - iw / Math.max(1, xLabels.length - 1) / 2} y={pad.t} width={iw / Math.max(1, xLabels.length - 1)} height={ih} fill="transparent" onMouseEnter={() => setHi(i)} />
        ))}
      </svg>
      {hi !== null && (
        <div className="mt-1 text-[12px] text-c-text">
          <b>{xLabels[hi]}</b>
          {series.map((s, i) => (
            <span key={s.name} className="ml-3 inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: SERIES[i] }} />
              {s.name}: {s.values[hi] === null ? 'нет данных' : Math.round(s.values[hi]!)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Надёжность прогноза: предсказанная вероятность (корзины) против фактической доли зачётов */
export function Calibration({ bins }: { bins: { from: number; to: number; predicted: number; actual: number; n: number }[] }) {
  const [hi, setHi] = useState<number | null>(null);
  const S = 220;
  const p = 28;
  const pos = (v: number) => p + v * (S - p - 8);
  const ypos = (v: number) => S - p - v * (S - p - 8);
  return (
    <div className="flex flex-wrap items-start gap-4">
      <svg viewBox={`0 0 ${S} ${S}`} className="w-[240px] max-w-full" role="img" aria-label="Калибровка прогноза">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={pos(0)} x2={pos(1)} y1={ypos(t)} y2={ypos(t)} stroke={GRID} />
            <text x={p - 5} y={ypos(t) + 4} textAnchor="end" fontSize={10} fill={MUTED}>
              {t * 100}
            </text>
            <text x={pos(t)} y={S - 10} textAnchor="middle" fontSize={10} fill={MUTED}>
              {t * 100}
            </text>
          </g>
        ))}
        <line x1={pos(0)} y1={ypos(0)} x2={pos(1)} y2={ypos(1)} stroke="#b9c1c8" strokeWidth={1} />
        {bins.map((b, i) =>
          b.n > 0 ? (
            <circle
              key={i}
              cx={pos(b.predicted)}
              cy={ypos(b.actual)}
              r={Math.min(9, 4 + Math.sqrt(b.n))}
              fill={SERIES[0]}
              stroke="#fff"
              strokeWidth={2}
              onMouseEnter={() => setHi(i)}
              onMouseLeave={() => setHi(null)}
            />
          ) : null,
        )}
      </svg>
      <div className="min-w-[200px] flex-1 text-[12px] text-c-muted">
        <p>
          По горизонтали — вероятность зачёта, предсказанная моделью <b>до</b> попытки; по вертикали — фактическая доля зачётов. Чем ближе точки к диагонали, тем достовернее прогноз. Размер точки — число
          попыток.
        </p>
        {hi !== null && (
          <p className="mt-2 text-c-text">
            Прогноз {Math.round(bins[hi].from * 100)}–{Math.round(bins[hi].to * 100)}%: в среднем {Math.round(bins[hi].predicted * 100)}%, фактически {Math.round(bins[hi].actual * 100)}% ({bins[hi].n}{' '}
            попыток)
          </p>
        )}
      </div>
    </div>
  );
}
