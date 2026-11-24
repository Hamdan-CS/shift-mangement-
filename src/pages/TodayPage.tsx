import { useSettings } from '@/hooks/useSettings';
import { useTodayBoard } from '@/hooks/useTodayBoard';
import { WPageHeader } from '@/components/app/ui';
import { TodaySchedule } from '@/components/dashboard/TodaySchedule';
import { timeToMin } from '@/components/dashboard/statusMeta';

/** "/today": the full Today schedule table for everyone (bottom-tab "Today"). */
export function TodayPage() {
  const settings = useSettings();
  const { rows, loading } = useTodayBoard();
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: settings?.timezone ?? 'Europe/Warsaw' });
  return (
    <>
      <WPageHeader title="Today" subtitle={`${date} · who is working, who is off`} />
      <TodaySchedule
        rows={rows}
        loading={loading}
        dayStart={timeToMin(settings?.day_start, 6 * 60)}
        dayEnd={timeToMin(settings?.day_end, 24 * 60)}
        timeZone={settings?.timezone}
        title="Team schedule"
      />
    </>
  );
}
