import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

/** KPI: small grey label, big bold number, optional delta. */
export function KpiTile({ label, value, delta, icon, className }: { label: string; value: ReactNode; delta?: string; icon?: ReactNode; className?: string }) {
  return (
    <div className={cn('g-kpi', className)}>
      <span className="g-kpi-l">{icon}{label}</span>
      <span className="g-kpi-v">{value}</span>
      {delta && <span className="g-kpi-d">{delta}</span>}
    </div>
  );
}
