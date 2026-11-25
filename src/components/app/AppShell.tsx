import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, ChevronRight, KeyRound, LogOut, Plus, QrCode, Search, Settings as SettingsIcon, Moon, Sun, UserCog } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/design-system/ThemeProvider';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { MobileTabBar } from '@/components/navigation/MobileTabBar';
import { BottomSheet } from '@/components/shared/sheet/BottomSheet';
import { LoopLoader } from '@/components/shared/ui/LoopLoader';
import { PageErrorBoundary } from '@/components/shared/PageErrorBoundary';
import { useSettings } from '@/hooks/useSettings';
import { useUnreadMessages } from '@/hooks/useUnreadMessages';
import { DESKTOP, useMediaQuery } from '@/hooks/useMediaQuery';
import { isAdminRole, roleLabel } from '@/utils/roles';
import { CommandPalette, type Command } from './CommandPalette';
import { NotificationsMenu, NotificationsPanel } from './NotificationsMenu';
import { Brand } from './Brand';
import { moreFor, tabsFor, topNavFor } from './nav';
import { WAvatar } from './ui';

/**
 * App shell (Webloop's AppShell, rebuilt mobile-first, PLAN.md 10c):
 * - under 1024px: slim top bar (brand, bell, avatar) + bottom tab bar, menus as bottom sheets
 * - from 1024px: Amplo top bar with pill nav, ⌘K search, theme, bell, "+ New", user chip
 */
export function AppShell() {
  const { profile, signOut, unreadNotifications } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // a chat thread swaps inside Messages without replaying the page animation
  const pageKey = pathname.startsWith('/messages') ? '/messages' : pathname;
  useEffect(() => { window.scrollTo({ top: 0 }); }, [pageKey]);
  const desktop = useMediaQuery(DESKTOP);
  const settings = useSettings(Boolean(profile));
  const [cmdk, setCmdk] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [menu, setMenu] = useState<'user' | 'new' | null>(null);
  const [sheet, setSheet] = useState<'more' | 'user' | 'bell' | null>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const newRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);

  const { unread: unreadMessages } = useUnreadMessages(profile?.id);
  const role = profile?.role ?? 'employee';
  const isAdmin = isAdminRole(role);
  const top = useMemo(() => topNavFor(role), [role]);
  const tabs = useMemo(() => tabsFor(role), [role]);
  const more = useMemo(() => moreFor(role), [role]);

  // close every menu / sheet on navigation
  useEffect(() => { setSheet(null); setMenu(null); setBellOpen(false); }, [pathname]);
  // switching between phone and desktop layouts closes the other layout's menus
  useEffect(() => { setSheet(null); setMenu(null); setBellOpen(false); }, [desktop]);

  const doSignOut = useCallback(async () => {
    await signOut();
    navigate('/login', { replace: true });
  }, [signOut, navigate]);

  const newActions = useMemo(() => {
    if (!isAdmin) {
      return [
        { label: 'Plan next week', to: '/schedule' },
        { label: 'Request leave', to: '/leave' },
        { label: 'Fix a clock time', to: '/history' },
      ];
    }
    return [
      ...(role === 'owner' ? [{ label: 'Add employee', to: '/admin/people' }] : []),
      { label: 'Edit a shift', to: '/admin/schedule' },
      { label: 'Add time entry', to: '/admin/timesheets' },
    ];
  }, [isAdmin, role]);

  const commands = useMemo<Command[]>(() => [
    ...top.map((n) => ({ label: n.label, hint: n.to, run: () => navigate(n.to) })),
    ...(role === 'owner' ? [{ label: 'Settings', hint: '/admin/settings', run: () => navigate('/admin/settings') }] : []),
    ...newActions.map((a) => ({ label: a.label, hint: 'Action', run: () => navigate(a.to) })),
    { label: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', hint: 'Theme', run: toggleTheme },
    { label: 'My settings (email)', hint: 'Account', run: () => navigate('/account') },
    { label: 'Change password', hint: 'Account', run: () => navigate('/reset-password') },
    { label: 'Sign out', hint: 'Account', run: () => { void doSignOut(); } },
  ], [top, role, newActions, theme, toggleTheme, navigate, doSignOut]);

  // ⌘K / Ctrl+K opens the palette (desktop)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdk((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // close the desktop user / new menus on outside click or Escape
  useEffect(() => {
    if (!menu) return;
    const ref = menu === 'user' ? userRef : newRef;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [menu]);

  // keep the active pill visible if the desktop nav ever scrolls sideways
  useEffect(() => {
    const nav = navRef.current;
    const a = nav?.querySelector<HTMLElement>('a.active');
    if (!nav || !a) return;
    nav.scrollTo({ left: Math.max(0, a.offsetLeft - (nav.clientWidth - a.offsetWidth) / 2) });
  }, [pathname, desktop]);

  const closeBell = useCallback(() => setBellOpen(false), []);
  const closeSheet = useCallback(() => setSheet(null), []);
  const go = (to: string) => { setSheet(null); setMenu(null); navigate(to); };

  if (!profile) return null;
  const first = profile.full_name.split(' ')[0];

  const accountRows = (
    <>
      <button type="button" className="sheet-row" onClick={() => { toggleTheme(); }}>
        {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}<span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
      </button>
      <button type="button" className="sheet-row" onClick={() => go('/account')}><UserCog size={20} /><span>My settings</span><small className="end">Email</small></button>
      <button type="button" className="sheet-row" onClick={() => go('/reset-password')}><KeyRound size={20} /><span>Change password</span><ChevronRight size={18} className="end" /></button>
      <button type="button" className="sheet-row danger" onClick={() => { setSheet(null); void doSignOut(); }}><LogOut size={20} /><span>Sign out</span></button>
    </>
  );

  return (
    <div className="app">
      <div className="sc-wrap">
        {desktop ? (
          <header className="sc-topbar">
            <Brand company={settings?.company_name} />

            <nav ref={navRef} className="sc-nav" aria-label="Main">
              {top.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : undefined)}>
                  {n.label}
                  {(n.dot || (n.to === '/messages' && unreadMessages > 0)) && <i className="dot" aria-label={n.to === '/messages' ? `${unreadMessages} unread` : undefined} />}
                </NavLink>
              ))}
            </nav>

            <div className="sc-tools">
              <button type="button" className="sc-iconbtn sc-search" onClick={() => setCmdk(true)} aria-label="Search (Ctrl+K)">
                <Search size={16} />
                <span className="sc-kbd" aria-hidden="true">⌘K</span>
              </button>
              <ThemeToggle />
              <button ref={bellRef} type="button" className="sc-iconbtn" aria-label="Notifications" aria-expanded={bellOpen} onClick={() => setBellOpen((v) => !v)}>
                <Bell size={16} />
                {unreadNotifications > 0 && <span className="sc-count">{unreadNotifications > 9 ? '9+' : unreadNotifications}</span>}
              </button>

              <div ref={newRef} className="relative">
                <button type="button" className="sc-btn sc-btn-primary" aria-haspopup="menu" aria-expanded={menu === 'new'} onClick={() => setMenu((m) => (m === 'new' ? null : 'new'))}>
                  <Plus size={16} strokeWidth={2.2} />New
                </button>
                {menu === 'new' && (
                  <div className="sc-menu" role="menu" style={{ right: 0, top: 46 }}>
                    {newActions.map((a) => (
                      <button key={a.label} type="button" role="menuitem" onClick={() => go(a.to)}>{a.label}</button>
                    ))}
                  </div>
                )}
              </div>

              <div ref={userRef} className="relative">
                <button type="button" className="sc-user" aria-haspopup="menu" aria-expanded={menu === 'user'} onClick={() => setMenu((m) => (m === 'user' ? null : 'user'))}>
                  <span className="av-wrap"><WAvatar name={profile.full_name} src={profile.avatar_url} size={34} /></span>
                  <span>
                    <b>{first}</b>
                    <small>{profile.job_title || roleLabel[profile.role]}</small>
                  </span>
                  <ChevronDown size={14} className="text-ink-3" />
                </button>
                {menu === 'user' && (
                  <div className="sc-menu" role="menu" style={{ right: 0, top: 48 }}>
                    <div className="sc-menu-h">
                      <b>{profile.full_name}</b>
                      <small>@{profile.username} · {roleLabel[profile.role]}</small>
                    </div>
                    {role === 'owner' && (
                      <button type="button" role="menuitem" onClick={() => go('/admin/settings')}><SettingsIcon size={15} /> Settings</button>
                    )}
                    {isAdmin && (
                      <button type="button" role="menuitem" onClick={() => go('/admin/locations')}><QrCode size={15} /> Locations &amp; QR</button>
                    )}
                    <button type="button" role="menuitem" onClick={() => { setMenu(null); toggleTheme(); }}>
                      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />} {theme === 'dark' ? 'Light mode' : 'Dark mode'}
                    </button>
                    <button type="button" role="menuitem" onClick={() => go('/account')}><UserCog size={15} /> My settings</button>
                    <button type="button" role="menuitem" onClick={() => go('/reset-password')}><KeyRound size={15} /> Change password</button>
                    <button type="button" role="menuitem" onClick={() => { setMenu(null); void doSignOut(); }}><LogOut size={15} /> Sign out</button>
                  </div>
                )}
              </div>
            </div>
          </header>
        ) : (
          <header className="m-topbar">
            <Brand company={settings?.company_name} />
            <div className="m-tools">
              <button type="button" className="sc-iconbtn" aria-label="Notifications" onClick={() => setSheet('bell')}>
                <Bell size={20} />
                {unreadNotifications > 0 && <span className="sc-count">{unreadNotifications > 9 ? '9+' : unreadNotifications}</span>}
              </button>
              <button type="button" className="m-avatar" aria-label={`Account: ${profile.full_name}`} onClick={() => setSheet('user')}>
                <span className="av-wrap"><WAvatar name={profile.full_name} src={profile.avatar_url} size={36} /></span>
              </button>
            </div>
          </header>
        )}

        <main className="app-main">
          {/* a page that fails to load shows a Reload card, never an empty screen */}
          <PageErrorBoundary resetKey={pageKey}>
            <Suspense fallback={<div className="grid min-h-[40dvh] place-items-center"><LoopLoader size={28} /></div>}>
              {/* keyed by page: each route change replays the enter animation (motion.css) */}
              <div key={pageKey} className="sc-page">
                <Outlet />
              </div>
            </Suspense>
          </PageErrorBoundary>
        </main>
      </div>

      {desktop && bellOpen && <NotificationsMenu anchorRef={bellRef} onClose={closeBell} />}
      {desktop && <CommandPalette open={cmdk} onClose={() => setCmdk(false)} commands={commands} />}

      {!desktop && (
        <>
          <MobileTabBar items={tabs} moreActive={sheet === 'more'} onMore={() => setSheet('more')} moreBadge={unreadMessages} />

          <BottomSheet open={sheet === 'more'} onClose={closeSheet} title="More">
            <div className="sheet-group">
              {more.map((n) => {
                const Icon = n.icon;
                return (
                  <button key={n.to} type="button" className={pathname === n.to ? 'sheet-row on' : 'sheet-row'} onClick={() => go(n.to)}>
                    <Icon size={20} /><span>{n.label}</span>
                    {n.to === '/messages' && unreadMessages > 0 && <i className="msg-unread" style={{ marginLeft: 'auto' }}>{unreadMessages > 9 ? '9+' : unreadMessages}</i>}
                    <ChevronRight size={18} className={n.to === '/messages' && unreadMessages > 0 ? undefined : 'end'} />
                  </button>
                );
              })}
            </div>
            <p className="sheet-label">Quick actions</p>
            <div className="sheet-group">
              {newActions.map((a) => (
                <button key={a.label} type="button" className="sheet-row" onClick={() => go(a.to)}><Plus size={20} /><span>{a.label}</span></button>
              ))}
            </div>
            <div className="sheet-group">{accountRows}</div>
          </BottomSheet>

          <BottomSheet open={sheet === 'user'} onClose={closeSheet} title={profile.full_name}>
            <p className="sheet-sub">@{profile.username} · {profile.job_title ? `${profile.job_title} · ` : ''}{roleLabel[profile.role]}</p>
            {role === 'owner' && (
              <div className="sheet-group">
                <button type="button" className="sheet-row" onClick={() => go('/admin/settings')}><SettingsIcon size={20} /><span>Settings</span><ChevronRight size={18} className="end" /></button>
              </div>
            )}
            <div className="sheet-group">{accountRows}</div>
          </BottomSheet>

          <BottomSheet open={sheet === 'bell'} onClose={closeSheet} title="Notifications">
            <div className="sheet-nt"><NotificationsPanel onClose={closeSheet} hideTitle /></div>
          </BottomSheet>
        </>
      )}
    </div>
  );
}
