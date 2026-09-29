import { useEffect, useState } from 'react';

/** Текущее время, обновляется с заданным шагом (часы АРМ, таймеры нормативов) */
export function useNow(stepMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now;
}
