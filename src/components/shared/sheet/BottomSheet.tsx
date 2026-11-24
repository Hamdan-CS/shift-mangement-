import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Bottom sheet for phones (PLAN.md 10c: sheets, not modals). Slides up from the
 * bottom, safe-area aware, Esc / backdrop / swipe-down to close, focus trapped.
 * From 1024px it shows as a centred dialog card, or a right-side drawer (side="right").
 */
export function BottomSheet({ open, onClose, title, children, footer, side }: { open: boolean; onClose(): void; title?: ReactNode; children: ReactNode; footer?: ReactNode; /** 'right' = a right-side drawer from 1024px (Veyla ref 09) */ side?: 'right' }) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const startY = useRef<number | null>(null);
  // stay mounted for the exit animation after `open` turns false
  const [shown, setShown] = useState(open);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (open) { setShown(true); setLeaving(false); return; }
    if (!shown) return;
    setLeaving(true);
    const t = window.setTimeout(() => { setShown(false); setLeaving(false); }, 200);
    return () => window.clearTimeout(t);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const body = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = window.setTimeout(() => panel.current?.querySelector<HTMLElement>('button, a, input, select, textarea')?.focus(), 40);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && panel.current) {
        const f = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, select, textarea')];
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { window.clearTimeout(t); document.removeEventListener('keydown', key); document.body.style.overflow = body; prev?.focus?.(); };
  }, [open, onClose]);

  if (!shown) return null;
  return createPortal(
    <div className={`${side === 'right' ? 'sheet-root drawer' : 'sheet-root'}${leaving ? ' out' : ''}`} onClick={(e) => { if (e.target === e.currentTarget && !leaving) onClose(); }}>
      <div
        ref={panel}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        onTouchStart={(e) => { startY.current = e.touches[0].clientY; }}
        onTouchEnd={(e) => { if (startY.current !== null && e.changedTouches[0].clientY - startY.current > 80 && panel.current && panel.current.scrollTop <= 0) onClose(); startY.current = null; }}
      >
        <span className="sheet-grab" aria-hidden="true" />
        {title && (
          <div className="sheet-h">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="sc-iconbtn" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>
        )}
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
