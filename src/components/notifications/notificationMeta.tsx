import type { ReactNode } from 'react';
import { Bell, CalendarClock, CalendarX2, CheckCircle2, Clock4, Plane, TimerOff, XCircle } from 'lucide-react';
import type { Notification, NotificationType } from '@/types';

/** Icon, text, destination and main-button label for each notification type. */

const str = (v: unknown, fallback: string) => (typeof v === 'string' && v ? v : fallback);

export const NOTIFICATION_ICONS: Record<NotificationType, ReactNode> = {
  'correction.requested': <Clock4 size={15} />,
  'leave.requested': <Plane size={15} />,
  'request.approved': <CheckCircle2 size={15} />,
  'request.declined': <XCircle size={15} />,
  'schedule.missing': <CalendarX2 size={15} />,
  'schedule.changed': <CalendarClock size={15} />,
  'shift.auto_closed': <TimerOff size={15} />,
};

export const iconFor = (n: Notification): ReactNode => NOTIFICATION_ICONS[n.type] ?? <Bell size={15} />;

export function describe(n: Notification): string {
  const p = n.payload;
  const kind = p.kind === 'leave' ? 'leave request' : 'time correction';
  switch (n.type) {
    case 'correction.requested':
      return `${str(p.employee_name, 'Someone')} asked to correct a clock time`;
    case 'leave.requested':
      return `${str(p.employee_name, 'Someone')} requested leave`;
    case 'request.approved':
      return `${str(p.reviewer_name, 'Your manager')} approved your ${kind}`;
    case 'request.declined':
      return `${str(p.reviewer_name, 'Your manager')} declined your ${kind}`;
    case 'schedule.missing':
      return typeof p.count === 'number' ? `${p.count} people haven't submitted next week` : "You haven't submitted next week's schedule";
    case 'schedule.changed': {
      const day = typeof p.date === 'string' ? new Date(`${p.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : 'a day';
      const what = p.change === 'delete' ? 'removed your shift' : p.change === 'insert' ? 'added a shift' : 'changed your shift';
      return `${str(p.editor_name, 'A manager')} ${what} on ${day}${p.change !== 'delete' && p.start ? ` (${p.start}–${p.end})` : ''}`;
    }
    case 'shift.auto_closed':
      return `Your shift was closed automatically after ${typeof p.hours === 'number' ? p.hours : 'too many'} hours`;
    default:
      return 'New notification';
  }
}

/** Where the main button goes. `null` = no page; the row shows details inline instead. */
export function destinationFor(n: Notification, isAdmin: boolean): string | null {
  switch (n.type) {
    case 'correction.requested':
    case 'leave.requested':
      return '/admin/approvals';
    case 'request.approved':
    case 'request.declined':
      return n.payload.kind === 'leave' ? '/leave' : '/history';
    case 'schedule.missing':
      return isAdmin ? '/admin/schedule' : '/schedule';
    case 'schedule.changed':
      return '/schedule';
    case 'shift.auto_closed':
      return '/history';
    default:
      return null;
  }
}

/** Label of the main button. */
export function actionFor(n: Notification): string {
  switch (n.type) {
    case 'correction.requested':
    case 'leave.requested': return 'Review';
    case 'schedule.missing': return 'Open schedule';
    case 'schedule.changed': return 'View shift';
    case 'shift.auto_closed': return 'Fix the time';
    default: return 'Open';
  }
}

/** Inline detail text (a manager's note on a decision). */
export function detailsFor(n: Notification): string | null {
  const note = n.payload.review_note;
  return typeof note === 'string' && note ? `Note: ${note}` : null;
}
