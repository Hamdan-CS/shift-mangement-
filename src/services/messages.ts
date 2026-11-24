/**
 * Messaging data layer (Phase 6, migration 010): the Team chat and 1-to-1 chats.
 * Same idea as Webloop's messaging (conversations, members, messages, unread
 * counts, live updates), on ShiftClock's own tables.
 */
import { supabase, demoAuth } from '@/integrations/supabase/client';
import { DEMO_PROFILES, demoSession } from './demo';
import { onUserEvent } from './userChannel';

export interface ConversationSummary {
  conversation_id: string;
  kind: 'team' | 'direct';
  title: string | null;
  other_id: string | null;
  member_count: number;
  last_body: string | null;
  last_sender_id: string | null;
  last_at: string | null;
  unread: number;
  muted: boolean;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  body: string;
  created_at: string;
}

export class MessageError extends Error {}

/* ---------------- demo store (dev only) ---------------- */
const CK = 'shiftclock-demo-convos', MK = 'shiftclock-demo-messages', RK = 'shiftclock-demo-reads';
const rd = <T,>(k: string, d: T): T => { try { return (JSON.parse(localStorage.getItem(k) || 'null') as T) ?? d; } catch { return d; } };
const wr = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };
type DemoConvo = { id: string; kind: 'team' | 'direct'; title: string | null; members: string[] };
const DEMO_TEAM = 'demo-team-chat';
function demoConvos(): DemoConvo[] {
  const list = rd<DemoConvo[]>(CK, []);
  if (!list.some((c) => c.kind === 'team')) list.unshift({ id: DEMO_TEAM, kind: 'team', title: 'Team', members: DEMO_PROFILES.map((p) => p.id) });
  return list;
}

/* ---------------- conversations ---------------- */

export async function fetchConversations(): Promise<ConversationSummary[]> {
  let list: ConversationSummary[];
  if (demoAuth) {
    const me = demoSession.get()?.id ?? '';
    const msgs = rd<Message[]>(MK, []);
    const reads = rd<Record<string, string>>(RK, {});
    list = demoConvos().filter((c) => c.members.includes(me)).map((c) => {
      const mine = msgs.filter((m) => m.conversation_id === c.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
      const read = reads[`${c.id}:${me}`] ?? '';
      return {
        conversation_id: c.id, kind: c.kind, title: c.title, other_id: c.kind === 'direct' ? c.members.find((m) => m !== me) ?? null : null,
        member_count: c.members.length, last_body: mine[0]?.body ?? null, last_sender_id: mine[0]?.sender_id ?? null, last_at: mine[0]?.created_at ?? null,
        unread: mine.filter((m) => m.sender_id !== me && m.created_at > read).length, muted: false,
      };
    });
  } else {
    const { data, error } = await supabase.from('my_conversations').select('*');
    if (error) throw error;
    list = (data ?? []) as ConversationSummary[];
  }
  // Team first, then newest activity
  return list.sort((a, b) => (a.kind === 'team' ? -1 : b.kind === 'team' ? 1 : (b.last_at ?? '').localeCompare(a.last_at ?? '')));
}

/** Opens (or creates) the 1-to-1 chat with someone. */
export async function startDirect(otherId: string): Promise<string> {
  if (demoAuth) {
    const me = demoSession.get()?.id ?? '';
    const all = demoConvos();
    const hit = all.find((c) => c.kind === 'direct' && c.members.includes(me) && c.members.includes(otherId));
    if (hit) return hit.id;
    const c: DemoConvo = { id: crypto.randomUUID(), kind: 'direct', title: null, members: [me, otherId] };
    wr(CK, [...all, c]);
    return c.id;
  }
  const { data, error } = await supabase.rpc('start_direct_chat', { p_other: otherId });
  if (error) throw new MessageError(error.code === '22023' ? 'Pick someone on the team.' : 'Could not open the chat.');
  return data as string;
}

/* ---------------- messages ---------------- */

export async function fetchMessages(conversationId: string, limit = 200): Promise<Message[]> {
  if (demoAuth) return rd<Message[]>(MK, []).filter((m) => m.conversation_id === conversationId).sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(-limit);
  const { data, error } = await supabase.from('messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return ((data ?? []) as Message[]).reverse();
}

export async function sendMessage(conversationId: string, userId: string, body: string): Promise<Message> {
  const text = body.trim();
  if (!text) throw new MessageError('Write something first.');
  if (text.length > 2000) throw new MessageError('That message is too long (2000 characters max).');
  if (demoAuth) {
    const m: Message = { id: crypto.randomUUID(), conversation_id: conversationId, sender_id: userId, body: text, created_at: new Date().toISOString() };
    wr(MK, [...rd<Message[]>(MK, []), m]);
    window.dispatchEvent(new CustomEvent('shiftclock-message', { detail: { conversation_id: conversationId } }));
    return m;
  }
  const { data, error } = await supabase.from('messages').insert({ conversation_id: conversationId, sender_id: userId, body: text }).select('*').single();
  if (error) throw new MessageError('Could not send. Check your connection and try again.');
  return data as Message;
}

export async function deleteMessage(id: string): Promise<void> {
  if (demoAuth) { wr(MK, rd<Message[]>(MK, []).filter((m) => m.id !== id)); return; }
  const { error } = await supabase.from('messages').delete().eq('id', id);
  if (error) throw new MessageError('Could not delete.');
}

export async function markRead(conversationId: string, userId: string): Promise<void> {
  if (demoAuth) { const r = rd<Record<string, string>>(RK, {}); r[`${conversationId}:${userId}`] = new Date().toISOString(); wr(RK, r); window.dispatchEvent(new Event('shiftclock-read')); return; }
  await supabase.from('conversation_members').update({ last_read_at: new Date().toISOString() }).eq('conversation_id', conversationId).eq('user_id', userId);
}

/** New message in any of my chats → callback with its conversation id. */
export function onNewMessage(userId: string, fn: (conversationId: string) => void): () => void {
  return onUserEvent(userId, 'message', (p) => fn(String(p.conversation_id ?? '')));
}
