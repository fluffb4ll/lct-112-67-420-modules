import { useEffect, useState } from 'react';
import { useRun } from '../store/training';

/*
 * Подсветка элемента интерфейса для текущего шага «делай как я».
 * Ищет элемент по data-step и рисует поверх него пульсирующую рамку с подписью.
 */

export function StepOverlay() {
  const run = useRun();
  const step = run.mode === 'demo' && run.current && !run.current.finishedAt ? run.demo[run.demoStep] : undefined;
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!step) return;
    let raf = 0;
    let last = '';
    const tick = () => {
      const el = document.querySelector(`[data-step="${step.target}"]`);
      const r = el?.getBoundingClientRect() ?? null;
      const key = r ? `${r.x}|${r.y}|${r.width}|${r.height}` : '';
      if (key !== last) {
        last = key;
        setRect(r && r.width > 0 ? r : null);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  if (!step || !rect) return null;
  // узкий элемент — подпись справа от него (не перекрывает раскрывающиеся под ним окна, например софтфон);
  // широкий — сверху или снизу
  const side = rect.right + 380 < window.innerWidth && rect.width < 500;
  const below = rect.top < 140;
  const pos = side
    ? { left: rect.right + 12, top: Math.max(8, rect.top) }
    : { left: Math.min(Math.max(8, rect.left), window.innerWidth - 370), top: below ? rect.bottom + 10 : undefined, bottom: below ? undefined : window.innerHeight - rect.top + 10 };
  return (
    <>
      <div
        className="step-ring pointer-events-none fixed z-40"
        style={{ left: rect.left - 3, top: rect.top - 3, width: rect.width + 6, height: rect.height + 6 }}
      />
      <div
        className="pointer-events-none fixed z-40 max-w-[360px] border-l-4 border-arm-orange bg-arm-dark px-2.5 py-1.5 text-[12px] leading-snug text-white shadow-[0_2px_8px_rgba(0,0,0,0.4)]"
        style={pos}
      >
        <b>шаг {run.demoStep + 1}:</b> {step.text}
      </div>
    </>
  );
}
