import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, CheckCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from '@/services/api';
import type { Notification } from '@/types';
import { relativeDate } from '@/utils/labels';
import { isAdminRole } from '@/utils/roles';
import { cn } from '@/utils/cn';
import { LoopLoader } from '@/components/shared/ui/LoopLoader';
import { actionFor, describe, destinationFor, detailsFor, iconFor } from '@/components/notifications/notificationMeta';

const REFRESH_MS = 30_000;
const WIDTH = 380;

/**
 * The bell's dropdown, ported from Webloop. Message rows come back in Phase 6
 * when messaging is wired in; for now it lists notifications only.
 */
export function NotificationsMenu({ anchorRef, onClose }: { anchorRef: RefObject<HTMLElement | null>; onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>({ visibility: 'hidden' });

  // place under the bell, right-aligned to it, kept on screen
  useLayoutEffect(() => {
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      if (!a) return;
      const w = Math.min(WIDTH, innerWidth - 24);
      const left = Math.max(12, Math.min(a.right - w, innerWidth - w - 12));
      setPos({ left, width: w, top: a.bottom + 8 });
    };
    place();
    addEventListener('resize', place);
    return () => removeEventListener('resize', place);
  }, [anchorRef]);

  // close on outside click / Escape
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [anchorRef, onClose]);

  return (
    <div ref={menuRef} className="w-nt-menu" role="dialog" aria-label="Notifications" style={pos}>
      <NotificationsPanel onClose={onClose} />
    </div>
  );
}

/** The list itself: used in the desktop dropdown and the mobile bottom sheet. */
export function NotificationsPanel({ onClose, hideTitle }: { onClose: () => void; hideTitle?: boolean }) {
  const { profile, refreshCounts } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [openDetails, setOpenDetails] = useState<string | null>(null);
  const profileId = profile?.id;
  const isAdmin = isAdminRole(profile?.role);

  const load = useCallback(async () => {
    if (!profileId) return;
    try { setItems(await fetchNotifications(profileId, 50)); } catch { setItems((x) => x ?? []); }
  }, [profileId]);

  useEffect(() => {
    void load();
    void refreshCounts();
    const t = setInterval(() => { void load(); void refreshCounts(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load, refreshCounts]);

  const rows = useMemo(() => (items ?? []).filter((n) => filter === 'all' || !n.read_at), [items, filter]);
  const anyUnread = rows.some((n) => !n.read_at);

  const markRead = async (n: Notification) => {
    if (n.read_at) return;
    const now = new Date().toISOString();
    setItems((xs) => xs?.map((x) => (x.id === n.id ? { ...x, read_at: now } : x)) ?? xs);
    try { await markNotificationRead(n.id); } catch { /* the next refresh shows the truth */ }
    void refreshCounts();
  };

  const markAll = async () => {
    if (!profileId) return;
    const now = new Date().toISOString();
    setItems((xs) => xs?.map((x) => (x.read_at ? x : { ...x, read_at: now })) ?? xs);
    await markAllNotificationsRead(profileId).catch(() => {});
    void refreshCounts();
  };

  const main = (n: Notification) => {
    void markRead(n);
    const dest = destinationFor(n, isAdmin);
    if (dest) { onClose(); navigate(dest); return; }
    setOpenDetails((id) => (id === n.id ? null : n.id));
  };

  return (
    <>
      <div className="w-nt-head">
        {!hideTitle && <b>Notifications</b>}
        <button type="button" className="w-nt-all" onClick={markAll} disabled={!anyUnread}><CheckCheck size={14} /> Mark all as read</button>
      </div>
      <div className="w-nt-filter" role="tablist" aria-label="Show">
        {(['all', 'unread'] as const).map((f) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} className={cn(filter === f && 'on')} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : 'Unread'}
          </button>
        ))}
      </div>
      <div className="w-nt-list">
        {items === null ? (
          <div className="w-nt-empty"><LoopLoader size={20} /></div>
        ) : rows.length === 0 ? (
          <div className="w-nt-empty"><Bell size={20} /><span>{filter === 'unread' ? "You're all caught up." : 'No notifications yet.'}</span></div>
        ) : rows.map((n) => (
          <div key={n.id} className={cn('w-nt-row', !n.read_at && 'unread')}>
            <span className="w-nt-ic">{iconFor(n)}</span>
            <div className="w-nt-body">
              <p>{describe(n)}</p>
              <small>{relativeDate(n.created_at)}{!n.read_at && <i className="w-nt-dot" aria-label="Unread" />}</small>
              {openDetails === n.id && detailsFor(n) && <p className="w-nt-detail">{detailsFor(n)}</p>}
              <div className="w-nt-acts">
                <button type="button" className="w-nt-main" onClick={() => main(n)}>
                  {openDetails === n.id ? 'Hide details' : actionFor(n)}
                </button>
              </div>
            </div>
            {!n.read_at && (
              <button type="button" className="w-nt-check" onClick={() => markRead(n)} aria-label="Mark as read" title="Mark as read"><Check size={14} /></button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
