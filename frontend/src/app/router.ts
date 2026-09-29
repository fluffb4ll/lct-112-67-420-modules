import { useSyncExternalStore } from 'react';

/*
 * Минимальный hash-роутер. Реальный АРМ тоже работает на hash-маршрутах (#!/incident/36814845),
 * а hash-маршруты не требуют настройки веб-сервера в закрытом контуре.
 */

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

const snapshot = () => window.location.hash.replace(/^#!?/, '') || '/';

export function useRoute(): string[] {
  const path = useSyncExternalStore(subscribe, snapshot);
  return path.split('/').filter(Boolean);
}

export function navigate(path: string) {
  const target = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (window.location.hash !== target) window.location.hash = target;
}
