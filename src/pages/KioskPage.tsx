import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { ArrowLeft, Expand, LogIn, LogOut, WifiOff } from 'lucide-react';
import { useSettings } from '@/hooks/useSettings';
import { useNow } from '@/hooks/useNow';
import { clockUrl, fetchKioskToken, QrError, seedDemoLocation, type KioskToken } from '@/services/qr';
import { clockTime, minutesOfDay, shortDay } from '@/utils/tz';
import { Brand } from '@/components/app/Brand';
import { WAvatar } from '@/components/app/ui';
import { useTodayBoard } from '@/hooks/useTodayBoard';
import { hhmm } from '@/components/dashboard/statusMeta';

/**
 * "/kiosk/:locationId": full-screen QR for a tablet at the door (PLAN.md 7).
 * One code per working day (it changes at the "working day starts" time, so a
 * 21:00–04:00 shift uses one code). Shows who is working now, and a big
 * message each time someone clocks in or out, so people see it worked. The
 * screen stays awake.
 */
export function KioskPage() {
  const { locationId = '' } = useParams();
  const settings = useSettings();
  const tz = settings?.timezone ?? 'Europe/Warsaw';
  const now = useNow(1000);
  const [tok, setTok] = useState<KioskToken | null>(null);
  const [img, setImg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const skew = useRef(0); // server clock minus this tablet's clock, seconds
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (timer.current) window.clearTimeout(timer.current);
    try {
      const t = await fetchKioskToken(locationId);
      skew.current = t.server_time - Date.now() / 1000;
      setTok(t);
      setError(null);
      setOffline(false);
      setImg(await QRCode.toDataURL(clockUrl(locationId, t.token), { margin: 1, width: 720, errorCorrectionLevel: 'M', color: { dark: '#0f1115', light: '#ffffff' } }));
      const msUntil = (t.expires_at - (Date.now() / 1000 + skew.current)) * 1000;
      timer.current = window.setTimeout(load, Math.max(1000, msUntil + 300));
    } catch (e) {
      if (e instanceof QrError && e.code !== 'offline') { setError(e.message); return; }
      setOffline(true);
      timer.current = window.setTimeout(load, 5000);
    }
  }, [locationId]);

  useEffect(() => { seedDemoLocation(); void load(); return () => { if (timer.current) window.clearTimeout(timer.current); }; }, [load]);

  // keep the tablet awake while the kiosk is open
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const ask = async () => {
      try { lock = await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen') ?? null; } catch { /* not supported */ }
    };
    void ask();
    const onVis = () => { if (document.visibilityState === 'visible') { void ask(); void load(); } };
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); void lock?.release().catch(() => {}); };
  }, [load]);

  const serverNow = Date.now() / 1000 + skew.current;
  const stale = tok ? serverNow > tok.expires_at + tok.period : false; // past its grace time: no longer valid
  const nextAt = settings?.day_start ? settings.day_start.slice(0, 5) : '06:00';

  // who is working now, and a message when someone clocks in or out
  const board = useTodayBoard();
  // longest on shift first; a start later than now was yesterday (night shifts)
  const nowMin = minutesOfDay(now, tz);
  const since = (m: number | null) => (m === null ? 0 : m > nowMin ? m - 1440 : m);
  const working = board.rows.filter((r) => r.status === 'working').sort((a, b) => since(a.clockIn) - since(b.clockIn));
  const [events, setEvents] = useState<{ id: string; name: string; kind: 'in' | 'out'; at: string; key: number }[]>([]);
  const seen = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (board.loading) return;
    const next = new Map(board.rows.map((r) => [r.person.id, r.status === 'working' ? `in:${r.clockIn}` : `out:${r.clockOut ?? ''}`]));
    const prev = seen.current;
    seen.current = next;
    if (!prev) return; // first load: nothing to announce
    const fresh: typeof events = [];
    for (const r of board.rows) {
      const was = prev.get(r.person.id), is = next.get(r.person.id);
      if (!was || was === is) continue;
      const first = r.person.full_name.split(' ')[0];
      if (is!.startsWith('in:')) fresh.push({ id: r.person.id, name: first, kind: 'in', at: hhmm(r.clockIn), key: Date.now() + fresh.length });
      else if (was.startsWith('in:') && r.clockOut !== null) fresh.push({ id: r.person.id, name: first, kind: 'out', at: hhmm(r.clockOut), key: Date.now() + fresh.length });
    }
    if (fresh.length) {
      setEvents((e) => [...fresh, ...e].slice(0, 3));
      for (const f of fresh) window.setTimeout(() => setEvents((e) => e.filter((x) => x.key !== f.key)), 6000);
    }
  }, [board.rows, board.loading]);

  return (
    <div className="kiosk">
      <header className="kiosk-top">
        <Brand company={settings?.company_name} />
        <div className="flex items-center gap-2">
          <button type="button" className="sc-iconbtn" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})} aria-label="Full screen"><Expand size={18} /></button>
          <Link to="/admin/locations" className="sc-iconbtn" aria-label="Exit kiosk"><ArrowLeft size={18} /></Link>
        </div>
      </header>

      <main className="kiosk-main">
        <div className="kiosk-info">
          <p className="kiosk-place">{tok?.name ?? 'Loading…'}</p>
          <p className="kiosk-time tnum">{clockTime(now, tz)}</p>
          <p className="kiosk-date">{shortDay(now, tz, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <ol className="kiosk-steps">
            <li><b>1</b> Open ShiftClock and tap Scan</li>
            <li><b>2</b> Point your phone at the code</li>
            <li><b>3</b> You're clocked in or out</li>
          </ol>
          <section className="kiosk-now" aria-live="polite">
            <h2><span className="dot" />Working now <b className="tnum">{board.loading ? '–' : working.length}</b></h2>
            {working.length ? (
              <ul>{working.slice(0, 8).map((r) => (
                <li key={r.person.id}><WAvatar name={r.person.full_name} src={r.person.avatar_url} size={26} /><span>{r.person.full_name.split(' ')[0]}</span><small className="tnum">since {hhmm(r.clockIn)}</small></li>
              ))}{working.length > 8 && <li className="more">+{working.length - 8}</li>}</ul>
            ) : !board.loading ? <p>Nobody yet.</p> : null}
          </section>
        </div>

        <div className="kiosk-qr-wrap">
          {error ? (
            <div className="kiosk-msg"><b>Can't show a code</b><span>{error}</span></div>
          ) : img && !stale ? (
            <img className="kiosk-qr" src={img} alt="Clock-in QR code. Scan it with your phone camera." />
          ) : (
            <div className="kiosk-msg"><span className="sc-spin" style={{ width: 36, height: 36 }} /><span>{offline ? 'Waiting for connection…' : 'Making a code…'}</span></div>
          )}
          <p className="kiosk-note tnum">{offline ? <><WifiOff size={16} /> Offline · today's code keeps working</> : tok ? `Today's code · a new one at ${nextAt}` : ' '}</p>
        </div>
      </main>

      {/* big, short-lived message when someone clocks in or out */}
      <div className="kiosk-events" aria-live="assertive">
        {events.map((e) => (
          <div key={e.key} className={`kiosk-event ${e.kind}`}>
            {e.kind === 'in' ? <LogIn size={22} /> : <LogOut size={22} />}
            <span><b>{e.name}</b> {e.kind === 'in' ? 'clocked in' : 'clocked out'}</span>
            <span className="tnum at">{e.at}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
