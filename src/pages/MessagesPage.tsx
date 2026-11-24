import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, MessageSquarePlus, SendHorizonal, Trash2, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useClock } from '@/contexts/ClockContext';
import { useMediaQuery, DESKTOP } from '@/hooks/useMediaQuery';
import { fetchTeam } from '@/services/api';
import { deleteMessage, fetchConversations, fetchMessages, markRead, MessageError, onNewMessage, sendMessage, startDirect, type ConversationSummary, type Message } from '@/services/messages';
import { WAvatar, WButton, WPageHeader } from '@/components/app/ui';
import { BottomSheet } from '@/components/shared/sheet/BottomSheet';
import { roleLabel } from '@/utils/roles';
import { relativeDate } from '@/utils/labels';
import { notify } from '@/utils/notify';
import { cn } from '@/utils/cn';
import { clockTime, dayKey, shortDay } from '@/utils/tz';
import type { PublicProfile } from '@/types';

/**
 * "/messages" and "/messages/:id" (PLAN.md 10, Phase 6): the Team chat and
 * 1-to-1 chats, built on Webloop's messaging pattern (list + thread, unread
 * counts, live updates). Desktop: two panes. Phone: list, then the thread.
 */
export function MessagesPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const desktop = useMediaQuery(DESKTOP);
  const [list, setList] = useState<ConversationSummary[] | null>(null);
  const [people, setPeople] = useState<PublicProfile[]>([]);
  const [picker, setPicker] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, t] = await Promise.all([fetchConversations(), fetchTeam()]);
      setList(c);
      setPeople(t);
    } catch {
      setList((x) => x ?? []);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => (profile ? onNewMessage(profile.id, () => { void load(); }) : undefined), [profile, load]);
  useEffect(() => {
    const h = () => { void load(); };
    window.addEventListener('shiftclock-read', h);
    return () => window.removeEventListener('shiftclock-read', h);
  }, [load]);

  // desktop with no chat open: open the Team chat
  useEffect(() => {
    if (desktop && !id && list?.length) navigate(`/messages/${list[0].conversation_id}`, { replace: true });
  }, [desktop, id, list, navigate]);

  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const titleOf = (c: ConversationSummary) => (c.kind === 'team' ? 'Team' : byId.get(c.other_id ?? '')?.full_name ?? 'Chat');
  const current = list?.find((c) => c.conversation_id === id) ?? null;

  const open = async (otherId: string) => {
    try {
      const cid = await startDirect(otherId);
      setPicker(false);
      await load();
      navigate(`/messages/${cid}`);
    } catch (e) {
      notify.error(e instanceof MessageError ? e.message : 'Could not open the chat.');
    }
  };

  const listPane = (
    <section className="sc-card msg-list" aria-label="Chats">
      <div className="msg-list-h">
        <b>Chats</b>
        <WButton size="sm" onClick={() => setPicker(true)}><MessageSquarePlus size={17} /> New chat</WButton>
      </div>
      {list === null && <div className="p-3"><span className="sc-skel block h-16 w-full" /></div>}
      <ul>
        {(list ?? []).map((c) => {
          const other = byId.get(c.other_id ?? '');
          return (
            <li key={c.conversation_id}>
              <button type="button" className={cn('msg-row', c.conversation_id === id && 'on')} onClick={() => navigate(`/messages/${c.conversation_id}`)}>
                {c.kind === 'team'
                  ? <span className="msg-team-av" aria-hidden="true"><Users size={18} /></span>
                  : <WAvatar name={titleOf(c)} src={other?.avatar_url} size={44} />}
                <span className="min-w-0 flex-1">
                  <span className="msg-row-top">
                    <b className="truncate">{titleOf(c)}</b>
                    <small className="tnum">{c.last_at ? relativeDate(c.last_at) : ''}</small>
                  </span>
                  <span className="msg-row-bottom">
                    <small className="truncate">
                      {c.last_body
                        ? `${c.last_sender_id === profile?.id ? 'You: ' : c.kind === 'team' ? `${byId.get(c.last_sender_id ?? '')?.full_name.split(' ')[0] ?? 'Someone'}: ` : ''}${c.last_body}`
                        : c.kind === 'team' ? `${c.member_count} people · say hi` : `${roleLabel[other?.role ?? 'employee']} · no messages yet`}
                    </small>
                    {c.unread > 0 && <i className="msg-unread" aria-label={`${c.unread} unread`}>{c.unread > 9 ? '9+' : c.unread}</i>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );

  return (
    <>
      {(!id || desktop) && <WPageHeader title="Messages" subtitle="Talk to the whole team, or message your manager directly." />}
      <div className={cn('msg-wrap', id && 'has-thread')}>
        {(!id || desktop) && listPane}
        {id && (
          <Thread
            key={id}
            conversationId={id}
            title={current ? titleOf(current) : '…'}
            convo={current}
            people={byId}
            onBack={desktop ? undefined : () => navigate('/messages')}
            onRead={load}
          />
        )}
      </div>

      <BottomSheet open={picker} onClose={() => setPicker(false)} title="New chat">
        <p className="sheet-sub">Message someone on the team.</p>
        <div className="sheet-group">
          {people
            .filter((p) => p.id !== profile?.id && p.active)
            .sort((a, b) => (a.role === 'employee' ? 1 : 0) - (b.role === 'employee' ? 1 : 0) || a.full_name.localeCompare(b.full_name))
            .map((p) => (
              <button key={p.id} type="button" className="sheet-row" onClick={() => void open(p.id)}>
                <WAvatar name={p.full_name} src={p.avatar_url} size={36} />
                <span className="min-w-0 flex-1"><b className="block text-[16px] font-medium lg:text-[13.5px]">{p.full_name}</b><small className="block text-[14px] text-ink-3 lg:text-[12px]">{p.job_title || roleLabel[p.role]}{p.role !== 'employee' ? ` · ${roleLabel[p.role]}` : ''}</small></span>
              </button>
            ))}
        </div>
      </BottomSheet>
    </>
  );
}

function Thread({ conversationId, title, convo, people, onBack, onRead }: {
  conversationId: string; title: string; convo: ConversationSummary | null; people: Map<string, PublicProfile>; onBack?: () => void; onRead(): void;
}) {
  const { profile } = useAuth();
  const { timeZone: tz } = useClock();
  const [msgs, setMsgs] = useState<Message[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      setMsgs(await fetchMessages(conversationId));
      if (profile) { await markRead(conversationId, profile.id); onRead(); }
    } catch {
      setMsgs((x) => x ?? []);
    }
  }, [conversationId, profile, onRead]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => (profile ? onNewMessage(profile.id, (cid) => { if (cid === conversationId) void load(); }) : undefined), [profile, conversationId, load]);

  // stay at the newest message
  useLayoutEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs]);

  const send = async () => {
    if (!profile || !text.trim()) return;
    setBusy(true);
    try {
      const m = await sendMessage(conversationId, profile.id, text);
      setMsgs((x) => [...(x ?? []), m]);
      setText('');
      onRead();
      input.current?.focus();
    } catch (e) {
      notify.error(e instanceof MessageError ? e.message : 'Could not send.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: Message) => {
    try { await deleteMessage(m.id); setMsgs((x) => (x ?? []).filter((y) => y.id !== m.id)); setMine(null); onRead(); }
    catch { notify.error('Could not delete.'); }
  };

  const other = convo?.other_id ? people.get(convo.other_id) : undefined;
  let lastDay = '';

  return (
    <section className="sc-card msg-thread" aria-label={`Chat with ${title}`}>
      <header className="msg-thread-h">
        {onBack && <button type="button" className="sc-iconbtn" onClick={onBack} aria-label="Back to chats"><ArrowLeft size={18} /></button>}
        {convo?.kind === 'team' ? <span className="msg-team-av" aria-hidden="true"><Users size={18} /></span> : <WAvatar name={title} src={other?.avatar_url} size={40} />}
        <div className="min-w-0">
          <b className="truncate">{title}</b>
          <small>{convo?.kind === 'team' ? `${convo.member_count} people` : other ? (other.job_title || roleLabel[other.role]) : ' '}</small>
        </div>
      </header>

      <div ref={scroller} className="msg-body" aria-live="polite">
        {msgs === null && <div className="grid place-items-center py-10"><Loader2 size={22} className="animate-spin text-ink-3" /></div>}
        {msgs !== null && msgs.length === 0 && <p className="msg-empty">No messages yet. Say hello.</p>}
        {(msgs ?? []).map((m, i) => {
          const day = dayKey(new Date(m.created_at), tz);
          const showDay = day !== lastDay;
          lastDay = day;
          const own = m.sender_id === profile?.id;
          const prev = msgs![i - 1];
          const grouped = prev && prev.sender_id === m.sender_id && !showDay && Date.parse(m.created_at) - Date.parse(prev.created_at) < 5 * 60_000;
          const who = people.get(m.sender_id ?? '');
          return (
            <div key={m.id}>
              {showDay && <p className="msg-day">{shortDay(m.created_at, tz, { weekday: 'long', day: 'numeric', month: 'short' })}</p>}
              <div className={cn('msg-line', own && 'own', grouped && 'grouped')}>
                {!own && convo?.kind === 'team' && !grouped && <WAvatar name={who?.full_name ?? 'Someone'} src={who?.avatar_url} size={30} />}
                <button type="button" className="msg-bubble" onClick={() => own && setMine((x) => (x === m.id ? null : m.id))} aria-label={own ? 'Your message. Tap for options' : undefined} disabled={!own}>
                  {!own && convo?.kind === 'team' && !grouped && <b>{who?.full_name.split(' ')[0] ?? 'Someone'}</b>}
                  <span>{m.body}</span>
                  <small className="tnum">{clockTime(m.created_at, tz)}</small>
                </button>
                {own && mine === m.id && (
                  <WButton tone="danger" size="sm" onClick={() => void remove(m)}><Trash2 size={15} /> Delete</WButton>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <form className="msg-compose" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label className="sr-only" htmlFor="msg-input">Message</label>
        <textarea
          id="msg-input"
          ref={input}
          className="w-input"
          rows={1}
          placeholder={convo?.kind === 'team' ? 'Message the team' : `Message ${title.split(' ')[0]}`}
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia(DESKTOP).matches) { e.preventDefault(); void send(); } }}
          enterKeyHint="send"
        />
        <button type="submit" className="msg-send" disabled={busy || !text.trim()} aria-label="Send">{busy ? <Loader2 size={18} className="animate-spin" /> : <SendHorizonal size={19} />}</button>
      </form>
    </section>
  );
}
