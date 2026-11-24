import { cn } from '@/utils/cn';
import { initialsOf, toneStyle } from '@/components/app/ui/tone';

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  style?: React.CSSProperties;
}

const sizeClass = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-base',
  xl: 'h-20 w-20 text-lg',
};

export function Avatar({ src, name, size = 'md', className, style }: AvatarProps) {
  return (
    <div
      className={cn('relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold', sizeClass[size], className)}
      style={{ ...(src ? {} : toneStyle(name)), ...style }}
    >
      {src ? <img src={src} alt={name} className="h-full w-full object-cover" loading="lazy" /> : <span>{initialsOf(name)}</span>}
    </div>
  );
}
