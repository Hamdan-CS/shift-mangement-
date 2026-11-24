import { cn } from '@/utils/cn';
import { initialsOf, toneStyle } from '@/components/app/ui/tone';

/** Overlapping avatars with a "+N" count. */
export function AvatarStack({ people, max = 4, size = 30, className }: { people: { name: string; src?: string | null }[]; max?: number; size?: number; className?: string }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span className={cn('g-avstack', className)} style={{ ['--s' as string]: `${size}px` }}>
      {shown.map((p, i) => (
        <span key={`${p.name}-${i}`} className="g-avstack-i" title={p.name} style={p.src ? undefined : toneStyle(p.name)}>
          {p.src ? <img src={p.src} alt={p.name} loading="lazy" /> : initialsOf(p.name)}
        </span>
      ))}
      {rest > 0 && <span className="g-avstack-i is-more">+{rest}</span>}
    </span>
  );
}
