import { useSyncExternalStore } from 'react';

/** Live `matchMedia` result, e.g. useMediaQuery('(min-width: 1024px)'). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Desktop = top pill nav and popovers; below it = bottom tabs and sheets (PLAN.md 10c). */
export const DESKTOP = '(min-width: 1024px)';
