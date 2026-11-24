import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  label?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

export function Select({ label, value, options, onChange, className, disabled, size = 'md' }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    // open upward when the menu would run off the bottom of the screen
    const want = Math.min(240, options.length * 40 + 10);
    const below = window.innerHeight - rect.bottom - 12, above = rect.top - 12;
    if (below < want && above > below) {
      setPosition({ bottom: window.innerHeight - rect.top + 6, left: rect.left, width: rect.width, maxHeight: Math.min(240, above) });
    } else {
      setPosition({ top: rect.bottom + 6, left: rect.left, width: rect.width, maxHeight: Math.min(240, Math.max(120, below)) });
    }
  }, [open, options.length]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={cn('block', className)} ref={rootRef}>
      {label && (
        <span className="w-label block mb-1.5">
          {label}
        </span>
      )}
      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            'wl-select-btn flex w-full items-center justify-between gap-2 rounded-ctl border bg-surface text-left text-ink transition-[border-color,box-shadow] disabled:opacity-50 disabled:cursor-not-allowed',
            size === 'sm' ? 'h-8 px-3 text-[12.5px]' : 'h-[42px] px-3.5 text-sm',
            open ? 'border-accent' : 'border-line-strong hover:border-ink-3',
          )}
        >
          <span className="truncate">{current?.label ?? 'Select…'}</span>
          <ChevronDown
            size={size === 'sm' ? 12 : 14}
            className={cn('shrink-0 text-ink-3 transition-transform', open && 'rotate-180')}
          />
        </button>
        {open &&
          position &&
          createPortal(
            <div
              ref={panelRef}
              role="listbox"
              data-wl-select-portal=""
              style={{ position: 'fixed', top: position.top, bottom: position.bottom, left: position.left, width: position.width, maxHeight: position.maxHeight }}
              className="z-[90] max-h-60 overflow-auto rounded-ctl border border-line bg-surface p-1 shadow-pop"
            >
              {options.map((o) => {
                const isSelected = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                      isSelected ? 'bg-surface-2 text-ink font-medium' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                    )}
                  >
                    <span className="truncate">{o.label}</span>
                    {isSelected && <Check size={14} className="shrink-0" />}
                  </button>
                );
              })}
            </div>,
            document.body,
          )}
      </div>
    </div>
  );
}
