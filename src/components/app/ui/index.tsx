import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/utils/cn';
import { toneStyle, initialsOf } from './tone';

/*
 * Workspace UI primitives, ported from Webloop's `W*` set and restyled to
 * Amplo (styles in design-system/styles/amplo.css). Thin, presentational
 * wrappers that take normal HTML props.
 */

/* ---------- buttons ---------- */
export type WButtonTone = 'primary' | 'secondary' | 'solid' | 'ghost' | 'danger';
export function WButton({ tone = 'primary', size, block, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: WButtonTone; size?: 'sm' | 'lg'; block?: boolean }) {
  return <button type="button" className={cn('sc-btn', `sc-btn-${tone}`, size && `sc-btn-${size}`, block && 'sc-btn-block', className)} {...props} />;
}

/* ---------- status chip ---------- */
export type WChipTone = 'default' | 'ok' | 'warn' | 'danger' | 'accent' | 'violet';
export function WChip({ tone = 'default', dot = true, className, children }: { tone?: WChipTone; dot?: boolean; className?: string; children: ReactNode }) {
  return <span className={cn('sc-chip', tone !== 'default' && tone, !dot && 'nodot', className)}>{children}</span>;
}

/* ---------- card with optional title / subtitle / right-side actions ---------- */
export function WBox({ title, meta, actions, children, className, inset }: { title?: ReactNode; meta?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; inset?: boolean }) {
  return (
    <section className={cn(inset ? 'sc-inset' : 'sc-card', className)}>
      {(title || meta || actions) && (
        <div className="sc-card-h">
          <div>
            {title && <h2>{title}</h2>}
            {meta && <small>{meta}</small>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/* ---------- page header: big title, grey line under it, actions right ---------- */
export function WPageHeader({ title, subtitle, status, actions, actionsWideOnly }: { title: ReactNode; subtitle?: ReactNode; status?: ReactNode[]; actions?: ReactNode; /** hide the actions under 768px (the page shows them in a card instead) */ actionsWideOnly?: boolean }) {
  return (
    <header className="sc-hero">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
        {status && status.length > 0 && (
          <div className="sc-status">{status.map((s, i) => <span key={i} className={i === 0 ? 'date' : undefined}>{s}</span>)}</div>
        )}
      </div>
      {actions && <div className={cn('acts', actionsWideOnly && 'wide-only')}>{actions}</div>}
    </header>
  );
}

/* ---------- avatar (tinted initials or image) ---------- */
export function WAvatar({ name, src, size = 32, square, className }: { name: string; src?: string | null; size?: number; square?: boolean; className?: string }) {
  return (
    <span
      className={cn('sc-av', square && 'sq', className)}
      style={{ width: size, height: size, fontSize: Math.max(12, Math.round(size * 0.34)), ...(src ? {} : toneStyle(name)) }}
      title={name}
    >
      {src ? <img src={src} alt={name} loading="lazy" /> : initialsOf(name)}
    </span>
  );
}

/* ---------- KPI row: small grey label, bold number ---------- */
export function WKpis({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <div className="sc-stats">
      {items.map((k) => (
        <div key={k.label} className="sc-stat"><small>{k.label}</small><b>{k.value}</b></div>
      ))}
    </div>
  );
}

/* ---------- form fields ---------- */
type FieldShell = { label?: ReactNode; hint?: ReactNode; className?: string };
function Field({ label, hint, className, id, children }: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className={cn('w-field', className)}>
      {label && <label className="w-label" htmlFor={id}>{label}</label>}
      {children}
      {hint && <span className="w-hint">{hint}</span>}
    </div>
  );
}
export function WInput({ label, hint, className, id, ...props }: FieldShell & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId(); const fid = id ?? auto;
  return <Field label={label} hint={hint} className={className} id={fid}><input id={fid} className="w-input" {...props} /></Field>;
}
export function WTextarea({ label, hint, className, id, ...props }: FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId(); const fid = id ?? auto;
  return <Field label={label} hint={hint} className={className} id={fid}><textarea id={fid} className="w-input" {...props} /></Field>;
}
export function WSelect({ label, hint, className, id, children, ...props }: FieldShell & SelectHTMLAttributes<HTMLSelectElement>) {
  const auto = useId(); const fid = id ?? auto;
  return <Field label={label} hint={hint} className={className} id={fid}><select id={fid} className="w-input" {...props}>{children}</select></Field>;
}

/* ---------- segmented control (24h · Week · Month) ---------- */
export function WSegmented<T extends string>({ value, options, onChange, ariaLabel }: { value: T; options: { value: T; label: string }[]; onChange(v: T): void; ariaLabel?: string }) {
  return (
    <div className="sc-seg" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}
