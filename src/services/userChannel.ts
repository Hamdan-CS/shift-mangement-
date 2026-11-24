/**
 * One private Realtime channel per signed-in person ("user:<id>"). The
 * database sends data-free pings on it: 'notification' (migration 008) and
 * 'message' (migration 010). Every listener shares the one channel.
 */
import { supabase, demoAuth } from '@/integrations/supabase/client';

type Event = 'notification' | 'message';
type Listener = (payload: Record<string, unknown>) => void;

let current: { userId: string; channel: ReturnType<typeof supabase.channel> | null; listeners: Map<Event, Set<Listener>> } | null = null;

function ensure(userId: string) {
  if (current && current.userId === userId) return current;
  if (current?.channel) void supabase.removeChannel(current.channel);
  const state: NonNullable<typeof current> = { userId, channel: null, listeners: new Map() };
  current = state;
  void (async () => {
    await supabase.realtime.setAuth();
    if (current !== state) return;
    const ch = supabase.channel(`user:${userId}`, { config: { private: true } });
    for (const ev of ['notification', 'message'] as Event[]) {
      ch.on('broadcast', { event: ev }, (msg) => state.listeners.get(ev)?.forEach((fn) => fn((msg.payload ?? {}) as Record<string, unknown>)));
    }
    state.channel = ch.subscribe();
  })();
  return state;
}

/** Listen for an event on your own channel. Returns unsubscribe. */
export function onUserEvent(userId: string, event: Event, fn: Listener): () => void {
  if (demoAuth) {
    const name = event === 'notification' ? 'shiftclock-notify' : 'shiftclock-message';
    const h = (e: Event | globalThis.Event) => fn(((e as CustomEvent).detail ?? {}) as Record<string, unknown>);
    window.addEventListener(name, h as EventListener);
    return () => window.removeEventListener(name, h as EventListener);
  }
  const state = ensure(userId);
  if (!state.listeners.has(event)) state.listeners.set(event, new Set());
  state.listeners.get(event)!.add(fn);
  return () => { state.listeners.get(event)?.delete(fn); };
}

/** On sign-out. */
export function closeUserChannel() {
  if (current?.channel) void supabase.removeChannel(current.channel);
  current = null;
}
