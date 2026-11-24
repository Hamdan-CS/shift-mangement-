import { useCallback, useEffect, useState } from 'react';
import { fetchConversations, onNewMessage } from '@/services/messages';

/** Total unread messages across my chats, live (Phase 6). */
export function useUnreadMessages(userId: string | undefined) {
  const [n, setN] = useState(0);
  const load = useCallback(async () => {
    try { setN((await fetchConversations()).filter((c) => !c.muted).reduce((s, c) => s + c.unread, 0)); } catch { /* offline */ }
  }, []);
  useEffect(() => {
    if (!userId) return;
    void load();
    const off = onNewMessage(userId, () => { void load(); });
    const h = () => { void load(); };
    window.addEventListener('shiftclock-read', h);
    return () => { off(); window.removeEventListener('shiftclock-read', h); };
  }, [userId, load]);
  return { unread: n, refresh: load };
}
