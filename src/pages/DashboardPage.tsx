import { CalendarPlus, Download, Plane } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/hooks/useSettings';
import { useTodayBoard } from '@/hooks/useTodayBoard';
import { WButton, WPageHeader } from '@/components/app/ui';
import { HoursChart, LabourCostCard } from '@/components/dashboard/Insights';
import { HistoryLinkCard, MyShiftCard, NextShiftCard, PayrollCountdown, PendingApprovalsCard } from '@/components/dashboard/SummaryCards';
import { TodaySchedule } from '@/components/dashboard/TodaySchedule';
import { timeToMin } from '@/components/dashboard/statusMeta';
import { firstName, greeting } from '@/utils/labels';
import { isAdminRole } from '@/utils/roles';

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Home "/": greeting + status line, then role-specific cards. Built for 390px first.
 * Managers / owner: the insight cards (labour cost, hours chart, approvals,
 * payroll countdown) come first, then the Today board.
 */
export function DashboardPage() {
  const { profile } = useAuth();
  const settings = useSettings();
  const navigate = useNavigate();
  const { rows, loading } = useTodayBoard();

  if (!profile) return null;
  const isAdmin = isAdminRole(profile.role);
  const currency = settings?.currency ?? 'PLN';
  const count = (fn: (s: string) => boolean) => rows.filter((r) => fn(r.status)).length;
  const deadline = `${DOW[settings?.schedule_deadline_dow ?? 4]} ${(settings?.schedule_deadline_time ?? '18:00').slice(0, 5)}`;
  const tz = settings?.timezone ?? 'Europe/Warsaw';
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });

  const status = [
    <>{today}</>,
    <><i className="sc-live" aria-hidden="true" />{loading ? '…' : count((s) => s === 'working')} working now</>,
    <>{loading ? '…' : count((s) => s === 'finished')} finished</>,
    <>{loading ? '…' : count((s) => s === 'off' || s === 'on_leave')} off today</>,
  ];

  const board = (
    <TodaySchedule
      rows={rows}
      loading={loading}
      dayStart={timeToMin(settings?.day_start, 6 * 60)}
      dayEnd={timeToMin(settings?.day_end, 24 * 60)}
      timeZone={settings?.timezone}
      title="Today"
    />
  );

  return (
    <>
      <WPageHeader
        title={`${greeting(new Date(), tz)}, ${firstName(profile.full_name)}`}
        status={status}
        actionsWideOnly={!isAdmin}
        actions={isAdmin ? (
          <>
            <WButton tone="secondary" onClick={() => navigate('/admin/reports')}><Download size={17} /> Weekly report</WButton>
            <WButton onClick={() => navigate('/admin/schedule')}><CalendarPlus size={17} /> Schedule</WButton>
          </>
        ) : (
          <>
            <WButton tone="secondary" onClick={() => navigate('/leave')}><Plane size={17} /> Leave</WButton>
            <WButton onClick={() => navigate('/schedule')}><CalendarPlus size={17} /> Plan week</WButton>
          </>
        )}
      />

      {isAdmin ? (
        <div className="sc-grid sc-stagger">
          <div className="sc-grid sc-grid-dash">
            <LabourCostCard currency={currency} canEdit={profile.role === 'owner'} />
            <HoursChart subtitle="Everyone on the team, this period vs last" />
          </div>
          <div className="sc-grid sc-grid-tab2 sc-grid-dash">
            <PendingApprovalsCard />
            <PayrollCountdown label="Pay period · Weekly" title="Payroll closes in" />
          </div>
          {profile.role === 'manager' && (
            <div className="sc-grid sc-grid-dash">
              <MyShiftCard currency={currency} rate={profile.hourly_rate} overtimeAfterHours={profile.overtime_after_hours} overtimeMultiplier={profile.overtime_multiplier} />
              <HistoryLinkCard />
            </div>
          )}
          {board}
        </div>
      ) : (
        <div className="sc-grid sc-stagger">
          <div className="sc-grid sc-grid-dash">
            {/* clock card first on phones: Start shift lands in the thumb zone */}
            <MyShiftCard currency={currency} rate={profile.hourly_rate} overtimeAfterHours={profile.overtime_after_hours} overtimeMultiplier={profile.overtime_multiplier} buttonAllowed={settings?.allow_button_clock ?? true} />
            <NextShiftCard deadline={deadline} />
          </div>
          <div className="sc-grid sc-grid-tab2 sc-grid-dash">
            <HoursChart subtitle="Your hours, this period vs last" />
            <PayrollCountdown label="Pay period · Weekly" title="Payday in" />
          </div>
          {board}
        </div>
      )}
    </>
  );
}
