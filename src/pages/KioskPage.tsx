import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { ArrowLeft, Expand, WifiOff } from 'lucide-react';
import { useSettings } from '@/hooks/useSettings';
import { useNow } from '@/hooks/useNow';
import { clockUrl, fetchKioskToken, QrError, seedDemoLocation, type KioskToken } from '@/services/qr';
import { clockTime, shortDay } from '@/utils/tz';
import { Brand } from '@/components/app/Brand';

/**
 * "/kiosk/:locationId": full-screen rotating QR for a tablet at the door
 * (PLAN.md section 7). A new code every 30 s, each valid 60 s. The screen
 * stays awake; if the network drops, the last code keeps working for a minute.
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
  const left = tok ? Math.max(0, tok.expires_at - serverNow) : 0;
  const stale = tok ? serverNow > tok.expires_at + tok.period : false; // older than 60 s: no longer valid

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
            <li><b>1</b> Open your phone camera</li>
            <li><b>2</b> Point it at the code</li>
            <li><b>3</b> Tap the link: you're clocked in or out</li>
          </ol>
        </div>

        <div className="kiosk-qr-wrap">
          {error ? (
            <div className="kiosk-msg"><b>Can't show a code</b><span>{error}</span></div>
          ) : img && !stale ? (
            <img className="kiosk-qr" src={img} alt="Clock-in QR code. Scan it with your phone camera." />
          ) : (
            <div className="kiosk-msg"><span className="sc-spin" style={{ width: 36, height: 36 }} /><span>{offline ? 'Waiting for connection…' : 'Making a code…'}</span></div>
          )}
          <div className="kiosk-bar" aria-hidden="true"><i style={{ width: `${tok ? (left / tok.period) * 100 : 0}%` }} /></div>
          <p className="kiosk-note tnum">{offline ? <><WifiOff size={16} /> Offline · last code works for up to a minute</> : tok ? `New code in ${Math.ceil(left)} s` : ' '}</p>
        </div>
      </main>
    </div>
  );
}
