import type { ReactNode } from 'react';
import { WChip, type WChipTone } from '@/components/app/ui';

interface BadgeProps {
  children: ReactNode;
  className?: string;
  tone?: WChipTone;
  dot?: boolean;
}

/** Pill badge. Same look as the status chips (Working · Late · Off …). */
export function Badge({ children, className, tone = 'default', dot = false }: BadgeProps) {
  return <WChip tone={tone} dot={dot} className={className}>{children}</WChip>;
}
