import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/design-system/ThemeProvider';
import { cn } from '@/utils/cn';

/** Sun / moon icon button for the top bar (Amplo shows the moon in light mode, the sun in dark). */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
      className={cn('sc-iconbtn', className)}
    >
      <span className="relative block h-4 w-4">
        <Moon size={16} className={cn('absolute inset-0 transition-[transform,opacity] duration-300 ease-out', theme === 'dark' ? '-rotate-90 scale-95 opacity-0' : 'rotate-0 scale-100 opacity-100')} />
        <Sun size={16} className={cn('absolute inset-0 transition-[transform,opacity] duration-300 ease-out', theme === 'dark' ? 'rotate-0 scale-100 opacity-100' : 'rotate-90 scale-95 opacity-0')} />
      </span>
    </button>
  );
}
