import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { CameraOff, Loader2, X } from 'lucide-react';

/**
 * Full-screen camera inside the app for the clock-in QR (QR-only mode).
 * Staff stay signed in (an iPhone home-screen app would otherwise open the
 * link in Safari, signed out). Reads the code with the phone's built-in QR
 * reader (BarcodeDetector) when there is one, otherwise with a small decoder
 * loaded on demand. A ShiftClock code opens /clock?loc=…&t=… here.
 */
type Detect = (video: HTMLVideoElement, canvas: HTMLCanvasElement) => Promise<string | null>;

async function makeDetector(): Promise<Detect | null> {
  const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
  if (BD) {
    try {
      const d = new BD({ formats: ['qr_code'] });
      return async (video) => (await d.detect(video))[0]?.rawValue ?? null;
    } catch { /* fall back */ }
  }
  try {
    const { default: jsQR } = await import('jsqr');
    return async (video, canvas) => {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return null;
      const scale = Math.min(1, 720 / Math.max(w, h));
      canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
    };
  } catch {
    return null;
  }
}

/** Our clock link → in-app path, or null for any other code. */
function clockPathFrom(text: string): string | null {
  try {
    const u = new URL(text, window.location.origin);
    const loc = u.searchParams.get('loc'), t = u.searchParams.get('t');
    if (u.pathname.replace(/\/$/, '') !== '/clock' || !loc || !t) return null;
    return `/clock?loc=${encodeURIComponent(loc)}&t=${encodeURIComponent(t)}`;
  } catch { return null; }
}

export function QrScanner({ open, onClose }: { open: boolean; onClose(): void }) {
  const navigate = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'starting' | 'scanning' | 'denied' | 'nocamera' | 'unsupported' | 'wrong'>('starting');

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let alive = true;
    setState('starting');
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setState('nocamera'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch (e) {
        setState(e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'nocamera');
        return;
      }
      if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
      const v = video.current!;
      v.srcObject = stream;
      await v.play().catch(() => undefined);
      const detect = await makeDetector();
      if (!alive) return;
      if (!detect) { setState('unsupported'); return; }
      setState('scanning');
      const tick = async () => {
        if (!alive) return;
        try {
          const text = await detect(v, canvas.current!);
          if (text) {
            const path = clockPathFrom(text);
            if (path) { navigator.vibrate?.(30); onClose(); navigate(path); return; }
            setState('wrong');
          }
        } catch { /* keep trying */ }
        timer = window.setTimeout(tick, 250);
      };
      tick();
    })();
    return () => { alive = false; window.clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [open, navigate, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [open, onClose]);

  if (!open) return null;
  const problem = state === 'denied' || state === 'nocamera' || state === 'unsupported';
  return createPortal(
    <div className="qrs" role="dialog" aria-modal="true" aria-label="Scan the QR code">
      <video ref={video} className="qrs-video" playsInline muted autoPlay />
      <canvas ref={canvas} hidden />
      <div className="qrs-top">
        <b>Scan the code at work</b>
        <button type="button" className="qrs-close" onClick={onClose} aria-label="Close camera"><X size={22} /></button>
      </div>
      {!problem && (
        <div className="qrs-frame" aria-hidden="true"><i /><i /><i /><i />{state === 'scanning' && <span className="qrs-line" />}</div>
      )}
      <div className="qrs-bottom">
        {state === 'starting' && <p><Loader2 size={16} className="animate-spin" /> Opening the camera…</p>}
        {state === 'scanning' && <p>Point at the QR code on the screen by the counter.</p>}
        {state === 'wrong' && <p className="warn">That's not the ShiftClock code. Point at the code on the work screen.</p>}
        {problem && (
          <div className="qrs-problem">
            <CameraOff size={28} />
            <b>{state === 'denied' ? 'Camera is blocked' : state === 'unsupported' ? "This phone can't read codes here" : 'No camera found'}</b>
            <p>{state === 'denied'
              ? 'Allow the camera for ShiftClock in your phone or browser settings, then try again.'
              : 'Open your phone’s Camera app and point it at the code instead.'}</p>
            <button type="button" className="sc-btn sc-btn-secondary" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
