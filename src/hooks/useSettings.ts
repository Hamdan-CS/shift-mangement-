import { useEffect, useState } from 'react';
import { fetchSettings } from '@/services/api';
import type { Settings } from '@/types';

/** The single settings row (company name, currency, timezone…). */
export function useSettings(enabled = true) {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetchSettings().then((s) => { if (alive) setSettings(s); }).catch(() => { /* RLS / offline: brand falls back */ });
    return () => { alive = false; };
  }, [enabled]);
  return settings;
}
