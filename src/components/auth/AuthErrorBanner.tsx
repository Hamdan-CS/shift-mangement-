import { useEffect, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { consumeAuthErrorFromUrl } from '@/utils/authRedirect';

export function AuthErrorBanner() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const msg = consumeAuthErrorFromUrl();
    if (msg) setMessage(msg);
  }, []);

  if (!message) return null;

  return (
    <div className="sc-wrap" style={{ paddingTop: 16 }}>
      <div className="sc-alert danger">
        <AlertCircle size={16} className="mt-0.5 shrink-0" />
        <span className="flex-1">{message}</span>
        <button type="button" onClick={() => setMessage(null)} aria-label="Dismiss" className="shrink-0" style={{ color: 'inherit', background: 'none', border: 0, cursor: 'pointer' }}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
