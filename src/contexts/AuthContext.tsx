import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, demoAuth, supabaseConfigured } from '@/integrations/supabase/client';
import { fetchProfileByUserId, fetchUnreadNotificationCount, subscribeNotifications } from '@/services/api';
import { DEMO_PROFILES, demoSession } from '@/services/demo';
import { closeUserChannel } from '@/services/userChannel';
import { normaliseUsername, usernameToEmail } from '@/utils/roles';
import type { Profile } from '@/types';

/*
 * Ported from Webloop's AuthContext. Changes: username + password login
 * (mapped to `<username>@shiftclock.local`), roles owner / manager / employee,
 * no sign-up or OAuth (the owner adds people), and a dev-only demo mode.
 */

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  /** The most recent Supabase auth event (e.g. 'SIGNED_IN', 'PASSWORD_RECOVERY'). */
  authEvent: string | null;
  unreadNotifications: number;
  signIn: (username: string, password: string) => Promise<{ error: string | null; profile: Profile | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshCounts: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Hook lives next to its provider (Webloop pattern).
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/** A stand-in Supabase user for demo mode, so route guards behave the same. */
const demoUser = (p: Profile) => ({ id: p.id, email: usernameToEmail(p.username) }) as unknown as User;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authEvent, setAuthEvent] = useState<string | null>(null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  // The user the app currently considers signed in, so late responses from a
  // previous user (or after sign-out) never overwrite fresh state.
  const activeUid = useRef<string | null>(null);

  const loadProfile = useCallback(async (uid: string): Promise<Profile | null> => {
    try {
      const p = await fetchProfileByUserId(uid);
      if (activeUid.current !== uid) return null;
      setProfile(p);
      return p;
    } catch (e) {
      console.warn('Failed to load profile:', (e as Error).message);
      return null;
    }
  }, []);

  const loadCounts = useCallback(async (profileId: string) => {
    setUnreadNotifications(await fetchUnreadNotificationCount(profileId));
  }, []);

  useEffect(() => {
    if (demoAuth) {
      const p = demoSession.get();
      if (p) { activeUid.current = p.id; setUser(demoUser(p)); setProfile(p); }
      setLoading(false);
      return;
    }
    if (!supabaseConfigured) { setLoading(false); return; }

    let cancelled = false;

    const hydrate = async (uid: string) => {
      try {
        const p = await loadProfile(uid);
        if (!cancelled && p?.id && activeUid.current === uid) await loadCounts(p.id);
      } catch (e) {
        console.warn('Failed to hydrate auth state:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const apply = (event: string, s: Session | null) => {
      setAuthEvent(event);
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        const sameUser = activeUid.current === s.user.id;
        activeUid.current = s.user.id;
        if (event === 'TOKEN_REFRESHED' && sameUser) { setLoading(false); return; }
        void hydrate(s.user.id);
      } else {
        activeUid.current = null;
        setProfile(null);
        setUnreadNotifications(0);
        setLoading(false);
      }
    };

    // Never await Supabase calls inside onAuthStateChange: the auth client holds
    // a lock while the callback runs, which deadlocks sign-in / sign-out.
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setTimeout(() => { if (!cancelled) apply(event, s); }, 0);
    });

    // Safety net: never leave the app stuck in a loading state.
    const timeout = setTimeout(() => { if (!cancelled) setLoading(false); }, 6000);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      sub.subscription.unsubscribe();
    };
  }, [loadProfile, loadCounts]);

  // live bell: a new notification for me → refresh the unread count
  const profileId = profile?.id;
  useEffect(() => {
    if (!profileId) return;
    void loadCounts(profileId);
    return subscribeNotifications(profileId, () => { void loadCounts(profileId); });
  }, [profileId, loadCounts]);

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user.id);
  }, [user, loadProfile]);

  const refreshCounts = useCallback(async () => {
    if (profile?.id) await loadCounts(profile.id);
  }, [profile, loadCounts]);

  const signIn = useCallback(async (username: string, password: string) => {
    const uname = normaliseUsername(username);
    if (!uname || !password) return { error: 'Enter your username and password.', profile: null };

    if (demoAuth) {
      const p = DEMO_PROFILES.find((x) => x.username === uname);
      if (!p) return { error: 'Wrong username or password.', profile: null };
      demoSession.set(p.id);
      activeUid.current = p.id;
      setUser(demoUser(p));
      setProfile(p);
      return { error: null, profile: p };
    }
    if (!supabaseConfigured) return { error: 'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.', profile: null };

    const { data, error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(uname), password });
    if (error) {
      // Don't reveal whether the username exists.
      const msg = /invalid login credentials/i.test(error.message) ? 'Wrong username or password.' : error.message;
      return { error: msg, profile: null };
    }
    if (data.user) {
      activeUid.current = data.user.id;
      const p = await loadProfile(data.user.id);
      if (p && !p.active) {
        await supabase.auth.signOut({ scope: 'local' });
        activeUid.current = null;
        setProfile(null);
        return { error: 'This account has been switched off. Ask the owner.', profile: null };
      }
      return { error: null, profile: p };
    }
    return { error: null, profile: null };
  }, [loadProfile]);

  const updatePassword = useCallback(async (newPassword: string) => {
    if (demoAuth) return { error: null };
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return { error: error?.message ?? null };
  }, []);

  const signOut = useCallback(async () => {
    // Clear local state first so the UI never shows a stale user.
    activeUid.current = null;
    setSession(null);
    setUser(null);
    setProfile(null);
    setUnreadNotifications(0);
    closeUserChannel();
    if (demoAuth) { demoSession.set(null); return; }
    try {
      await Promise.race([
        supabase.auth.signOut({ scope: 'local' }),
        new Promise((r) => setTimeout(r, 4000)),
      ]);
    } catch (e) {
      console.warn('signOut failed, clearing local session anyway:', e);
    }
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
        .forEach((k) => localStorage.removeItem(k));
    } catch { /* storage unavailable */ }
    // Drop the PWA's cached Supabase answers so the next person on this phone can't see them.
    try { if ('caches' in window) await caches.delete('supabase-rest'); } catch { /* no cache storage */ }
  }, []);

  return (
    <AuthContext.Provider
      value={{ session, user, profile, loading, authEvent, unreadNotifications, signIn, updatePassword, signOut, refreshProfile, refreshCounts }}
    >
      {children}
    </AuthContext.Provider>
  );
}
