import { NavLink, useLocation } from 'react-router-dom';
import { Ellipsis } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { NavItem } from '@/components/app/nav';

/**
 * Fixed bottom tab bar for phones and tablets (<1024px), ported from Webloop's
 * MobileTabBar: floating pill above the home indicator, 4 tabs + "More".
 */
export function MobileTabBar({ items, moreActive, onMore, badge, moreBadge = 0 }: { items: NavItem[]; moreActive: boolean; onMore(): void; badge?: Record<string, number>; /** unread messages, shown on More */ moreBadge?: number }) {
  const { pathname } = useLocation();
  return (
    <nav className="mtab" style={{ gridTemplateColumns: `repeat(${items.length + 1}, minmax(0, 1fr))` }} aria-label="Primary">
      {items.map((item) => {
        const Icon = item.icon;
        const n = badge?.[item.to] ?? 0;
        return (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => cn('mtab-i', isActive && 'active')}>
            <span className="mtab-ic">
              <Icon size={22} strokeWidth={1.9} />
              {n > 0 && <i className="mtab-badge">{n > 9 ? '9+' : n}</i>}
            </span>
            {item.label}
          </NavLink>
        );
      })}
      <button type="button" className={cn('mtab-i', (moreActive || !items.some((i) => matches(i.to, pathname))) && 'active')} onClick={onMore} aria-haspopup="dialog">
        <span className="mtab-ic"><Ellipsis size={22} strokeWidth={1.9} />{moreBadge > 0 && <i className="mtab-badge" aria-label={`${moreBadge} unread messages`}>{moreBadge > 9 ? '9+' : moreBadge}</i>}</span>
        More
      </button>
    </nav>
  );
}

const matches = (to: string, pathname: string) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`));
