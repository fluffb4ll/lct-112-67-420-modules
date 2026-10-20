/** Число из поля занятия нормализуем только после завершения ввода. */
export function normalizeSessionNumber(raw: string, min: number, max?: number): number {
  const parsed = Number(raw.trim());
  if (!raw.trim() || !Number.isFinite(parsed)) return min;
  const bounded = Math.max(min, Math.trunc(parsed));
  return max === undefined ? bounded : Math.min(max, bounded);
}
