import { useEffect, useState } from 'react';

/** Re-renders every `ms` with the current time (the moving "now" line, timers). */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}
