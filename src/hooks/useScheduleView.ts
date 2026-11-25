import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { updatePerson } from '@/services/pay';

export type ScheduleView = 'day' | 'week' | 'month';

/**
 * Day / Week / Month on the schedule pages. Starts from the person's saved
 * choice (My settings) and saves it again when they switch, so the page opens
 * the way they left it, on every device.
 */
export function useScheduleView(fallback: ScheduleView = 'week') {
  const { profile } = useAuth();
  const [value, setValue] = useState<ScheduleView>(profile?.schedule_view ?? fallback);
  useEffect(() => { if (profile?.schedule_view) setValue(profile.schedule_view); }, [profile?.schedule_view]);
  const set = useCallback((v: ScheduleView) => {
    setValue(v);
    if (profile && profile.schedule_view !== v) {
      profile.schedule_view = v; // keep the cached profile in step without a reload
      void updatePerson(profile.id, { schedule_view: v }).catch(() => { /* offline: still switches */ });
    }
  }, [profile]);
  return { value, set };
}
