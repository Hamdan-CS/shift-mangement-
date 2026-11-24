import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { WButton, WInput } from '@/components/app/ui';
import { LoopLoader } from '@/components/shared/ui/LoopLoader';

/**
 * Ported from Webloop. Signed-in users change their password here; it also
 * handles a recovery link the owner sends from Supabase.
 */
export function ResetPasswordPage() {
  const { user, loading: authLoading, updatePassword } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    setLoading(true);
    const { error: err } = await updatePassword(password);
    setLoading(false);
    if (err) setError(err); else setDone(true);
  };

  return (
    <div className="sc-auth-body">
      <div className="sc-auth-card">
        <h1>Set a new password</h1>
        <p>Choose a new password for your account.</p>

        {authLoading ? (
          <div className="flex items-center justify-center py-6"><LoopLoader size={24} /></div>
        ) : !user ? (
          <div className="sc-alert danger"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>This reset link is invalid or has expired. Ask your manager for a new one.</span></div>
        ) : done ? (
          <div className="sc-auth-form">
            <div className="sc-alert ok"><CheckCircle2 size={16} className="mt-0.5 shrink-0" /><span>Your password has been updated.</span></div>
            <WButton size="lg" block onClick={() => navigate('/', { replace: true })}>Continue</WButton>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="sc-auth-form">
            <WInput label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" required />
            <WInput label="Confirm new password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
            {error && <div className="sc-alert danger" role="alert"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
            <div className="sc-sticky-submit">
              <WButton type="submit" size="lg" block disabled={loading}>
                {loading ? <Loader2 size={18} className="animate-spin" /> : 'Update password'}
              </WButton>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
