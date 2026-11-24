import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/hooks/useSettings';
import { clockIn, clockOut, ClockError, fetchEntries, fetchOpenEntry } from '@/services/api';
import { addDays, startOfDay, startOfWeek } from '@/utils/tz';
import type { TimeEntry } from '@/types';

/**
 * The signed-in person's clock: open entry + this week's entries, with
 * Start / Finish. Shared so the shift card, Today board and History stay in step.
 */
interface ClockValue {
  open: TimeEntry | null;
  week: TimeEntry[];
  loading: boolean;
  busy: boolean;
  timeZone: string;
  weekStart: Date;
  todayStart: Date;
  /** Bumps after every clock action, so other lists can reload. */
  version: number;
  start(): Promise<TimeEntry>;
  finish(): Promise<TimeEntry>;
  refresh(): Promise<void>;
}

const ClockContext = createContext<ClockValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useClock() {
  const ctx = useContext(ClockContext);
  if (!ctx) throw new Error('useClock must be used within ClockProvider');
  return ctx;
}

export function ClockProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const settings = useSettings(Boolean(profile));
  const timeZone = settings?.timezone ?? 'Europe/Warsaw';
  const [open, setOpen] = useState<TimeEntry | null>(null);
  const [week, setWeek] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  // recomputed on each load so a new day / week rolls over
  const [anchor, setAnchor] = useState(() => new Date());
  const weekStart = useMemo(() => startOfWeek(anchor, timeZone), [anchor, timeZone]);
  const todayStart = useMemo(() => startOfDay(anchor, timeZone), [anchor, timeZone]);
  const uid = profile?.id;

  const refresh = useCallback(async () => {
    if (!uid) return;
    const now = new Date();
    setAnchor(now);
    const ws = startOfWeek(now, timeZone);
    try {
      const [o, w] = await Promise.all([fetchOpenEntry(uid), fetchEntries(uid, ws, addDays(ws, 7, timeZone))]);
      setOpen(o);
      setWeek(w);
    } catch (e) {
      console.warn('Could not load clock:', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [uid, timeZone]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Coming back to the app (phone unlocked, tab focused): reload.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refresh]);

  const start = useCallback(async () => {
    if (!uid) throw new ClockError('Not signed in.');
    setBusy(true);
    try {
      const e = await clockIn(uid);
      setOpen(e);
      setWeek((w) => [e, ...w.filter((x) => x.id !== e.id)]);
      setVersion((v) => v + 1);
      return e;
    } catch (err) {
      await refresh();
      throw err;
    } finally {
      setBusy(false);
    }
  }, [uid, refresh]);

  const finish = useCallback(async () => {
    if (!open) throw new ClockError("You're not clocked in.");
    setBusy(true);
    try {
      const e = await clockOut(open);
      setOpen(null);
      setWeek((w) => w.map((x) => (x.id === e.id ? e : x)));
      setVersion((v) => v + 1);
      return e;
    } catch (err) {
      await refresh();
      throw err;
    } finally {
      setBusy(false);
    }
  }, [open, refresh]);

  const value = useMemo<ClockValue>(
    () => ({ open, week, loading, busy, timeZone, weekStart, todayStart, version, start, finish, refresh }),
    [open, week, loading, busy, timeZone, weekStart, todayStart, version, start, finish, refresh],
  );
  return <ClockContext.Provider value={value}>{children}</ClockContext.Provider>;
}
