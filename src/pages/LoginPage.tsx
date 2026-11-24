import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { demoAuth, supabaseConfigured } from '@/integrations/supabase/client';
import { DEMO_PROFILES } from '@/services/demo';
import { WButton, WInput } from '@/components/app/ui';
import { Brand } from '@/components/app/Brand';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { AuthErrorBanner } from '@/components/auth/AuthErrorBanner';
import { roleLabel } from '@/utils/roles';

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: err } = await signIn(username, password);
    setBusy(false);
    if (err) { setError(err); return; }
    navigate(from === '/login' ? '/' : from, { replace: true });
  };

  return (
    <div className="sc-auth">
      <div className="sc-wrap">
        <header className="m-topbar">
          <Brand />
          <ThemeToggle />
        </header>
      </div>
      <AuthErrorBanner />
      <div className="sc-auth-body sc-wrap">
        <div className="sc-auth-card">
          <h1>Sign in</h1>
          <p>Use the username and password your manager gave you.</p>

          <form className="sc-auth-form" onSubmit={submit} noValidate>
            <WInput
              label="Username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. ali"
              enterKeyHint="next"
              required
            />
            <div className="w-field">
              <label className="w-label" htmlFor="login-password">Password</label>
              <div className="sc-pw">
                <input
                  id="login-password"
                  className="w-input"
                  type={show ? 'text' : 'password'}
                  autoComplete="current-password"
                  enterKeyHint="go"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && <div className="sc-alert danger" role="alert"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
            {!supabaseConfigured && !demoAuth && (
              <div className="sc-alert info"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>No Supabase project set. Add it to .env, or set VITE_DEMO_AUTH=1 to try the app locally.</span></div>
            )}

            <div className="sc-sticky-submit">
              <WButton type="submit" size="lg" block disabled={busy}>
                {busy ? <Loader2 size={18} className="animate-spin" /> : 'Sign in'}
              </WButton>
            </div>
          </form>

          <p className="mt-4 text-center text-[14px] text-ink-3">Forgot your password? Ask your manager to reset it.</p>

          {demoAuth && (
            <div className="sc-demo">
              <small>Demo mode (dev only): pick someone, any password works.</small>
              <div className="sc-demo-row">
                {DEMO_PROFILES.map((p) => (
                  <WButton key={p.id} tone="secondary" size="sm" onClick={() => { setUsername(p.username); setPassword('demo'); }} aria-label={`Fill in ${p.full_name}, ${roleLabel[p.role]}`}>
                    {p.full_name.split(' ')[0]} · {roleLabel[p.role]}
                  </WButton>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
