import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CircleAlert, CircleCheck, LogOut, MapPin, RotateCw, TimerOff } from 'lucide-react';
import { useSettings } from '@/hooks/useSettings';
import { currentPosition, fetchLocation, QrError, scanCode, seedDemoLocation, type ScanResult } from '@/services/qr';
import { WButton } from '@/components/app/ui';
import { Brand } from '@/components/app/Brand';
import { formatHours } from '@/utils/labels';
import { notify } from '@/utils/notify';
import { clockTime } from '@/utils/tz';

type State =
  | { kind: 'working'; text: string }
  | { kind: 'done'; r: ScanResult }
  | { kind: 'error'; code: string; message: string };

/**
 * "/clock?loc=…&t=…": opened by the phone camera from the QR code. Goes
 * straight to a big result (PLAN.md 10c). Works after the login redirect.
 */
export function ClockScanPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const settings = useSettings();
  const tz = settings?.timezone ?? 'Europe/Warsaw';
  const loc = params.get('loc') ?? '';
  const t = params.get('t') ?? '';
  const [state, setState] = useState<State>({ kind: 'working', text: 'Checking the code…' });
  const started = useRef(false);

  const run = useCallback(async () => {
    if (!loc || !t) { setState({ kind: 'error', code: 'bad_request', message: 'This link is missing its code. Scan the code on the screen again.' }); return; }
    setState({ kind: 'working', text: 'Checking the code…' });
    seedDemoLocation();
    try {
      const place = await fetchLocation(loc).catch(() => null);
      let pos: { lat: number; lng: number; accuracy: number } | undefined;
      if (place?.radius_m) {
        setState({ kind: 'working', text: 'Checking you are at work…' });
        pos = await currentPosition();
      }
      setState({ kind: 'working', text: 'Clocking you…' });
      const r = await scanCode(loc, t, pos);
      setState({ kind: 'done', r });
      buzz(r.result === 'in' ? 30 : [30, 60, 30]);
      if (!r.repeat) notify.success(r.result === 'in' ? `Clocked in at ${clockTime(r.at, tz)}` : `Clocked out at ${clockTime(r.at, tz)}`);
      // the code is used up: don't re-send it if the page is reloaded
      window.history.replaceState(null, '', '/clock?done=1');
    } catch (e) {
      const err = e instanceof QrError ? e : new QrError('Something went wrong. Try again.', 'unknown');
      setState({ kind: 'error', code: err.code, message: err.message });
      buzz([80, 40, 80]);
    }
  }, [loc, t, tz]);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice in dev: scan once
    started.current = true;
    if (params.get('done')) { navigate('/', { replace: true }); return; }
    void run();
  }, [run, params, navigate]);

  return (
    <div className="scan">
      <header className="m-topbar" style={{ position: 'static', background: 'transparent' }}>
        <Brand company={settings?.company_name} />
      </header>

      <main className="scan-main" aria-live="polite">
        {state.kind === 'working' && (
          <div className="scan-card">
            <span className="sc-spin" style={{ width: 56, height: 56, borderWidth: 4 }} />
            <h1>{state.text}</h1>
          </div>
        )}

        {state.kind === 'done' && (
          <div className={`scan-card ${state.r.result}`}>
            <span className="scan-ic">{state.r.result === 'in' ? <CircleCheck size={64} strokeWidth={1.8} /> : <LogOut size={60} strokeWidth={1.8} />}</span>
            <h1>{state.r.result === 'in' ? 'Clocked in' : 'Clocked out'}</h1>
            <p className="scan-time tnum">{clockTime(state.r.at, tz)}</p>
            <p className="scan-sub">
              {state.r.result === 'out' && state.r.minutes !== undefined ? <>Shift {formatHours(state.r.minutes)} · </> : null}
              {state.r.location}
              {state.r.repeat ? ' · already done' : ''}
            </p>
          </div>
        )}

        {state.kind === 'error' && (
          <div className="scan-card error" role="alert">
            <span className="scan-ic">{state.code === 'expired' ? <TimerOff size={60} strokeWidth={1.8} /> : state.code === 'need_location' || state.code === 'too_far' || state.code === 'no_gps' ? <MapPin size={60} strokeWidth={1.8} /> : <CircleAlert size={60} strokeWidth={1.8} />}</span>
            <h1>{state.code === 'expired' ? 'Code expired' : state.code === 'too_far' ? 'Not at work?' : state.code === 'need_location' || state.code === 'no_gps' ? 'Location needed' : 'Not clocked'}</h1>
            <p className="scan-sub">{state.message}</p>
          </div>
        )}
      </main>

      <footer className="scan-foot">
        {state.kind === 'error' && ['need_location', 'too_far', 'no_gps', 'offline', 'unknown', 'server', 'busy'].includes(state.code) && (
          <WButton size="lg" block onClick={() => void run()}><RotateCw size={18} /> Try again</WButton>
        )}
        <WButton size="lg" tone={state.kind === 'error' && state.code !== 'expired' ? 'secondary' : 'primary'} block onClick={() => navigate('/', { replace: true })} disabled={state.kind === 'working'}>
          Go to Home
        </WButton>
      </footer>
    </div>
  );
}

/** Vibrate only after the person has touched the page (browsers block it before, and log an error). */
function buzz(pattern: number | number[]) {
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  if (ua?.hasBeenActive) navigator.vibrate?.(pattern);
}
