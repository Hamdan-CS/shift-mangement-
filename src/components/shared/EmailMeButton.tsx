import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Mail } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { WButton } from '@/components/app/ui';
import { AdminError, emailMe, type EmailMeRequest } from '@/services/admin';
import { notify } from '@/utils/notify';
import { cn } from '@/utils/cn';

/**
 * "Email me": sends the signed-in person what is on screen (their pay for the
 * period, or their week's schedule) to the email in My settings.
 * `icon` renders a small square button; otherwise a secondary button.
 */
export function EmailMeButton({ request, icon, disabled, className }: { request: () => EmailMeRequest | null; icon?: boolean; disabled?: boolean; className?: string }) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (!profile) return;
    if (!profile.notify_email) {
      notify.info('Add your email first, then tap Email again.', { action: { label: 'Add email', onClick: () => navigate('/account') } });
      return;
    }
    const req = request();
    if (!req) return;
    setBusy(true);
    try {
      const to = await emailMe(req);
      notify.success(`Sent to ${to || profile.notify_email}`);
    } catch (e) {
      notify.error(e instanceof AdminError ? e.message : 'Could not send the email.');
    } finally { setBusy(false); }
  };

  const ic = busy ? <Loader2 size={icon ? 18 : 17} className="animate-spin" /> : <Mail size={icon ? 18 : 17} />;
  if (icon) {
    return (
      <button type="button" className={cn('sc-iconbtn', className)} onClick={go} disabled={disabled || busy} aria-label="Email this to me" title="Email this to me">{ic}</button>
    );
  }
  return <WButton tone="secondary" className={className} onClick={go} disabled={disabled || busy}>{ic} Email me</WButton>;
}
