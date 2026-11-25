/** The three ShiftClock roles (PLAN.md section 4). */
export type Role = 'owner' | 'manager' | 'employee';

/** A row of `profiles`. Pay fields are only returned to the person themself,
 * managers and the owner (RLS + the `profiles_public` view for everyone else). */
export interface Profile {
  id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  notify_email: string | null;
  /** Hours emails this person wants at notify_email (My settings). */
  email_daily: boolean;
  email_weekly: boolean;
  /** Default view on the schedule pages (My settings, migration 017). */
  schedule_view: 'day' | 'week' | 'month';
  role: Role;
  job_title: string | null;
  hourly_rate: number | null;
  overtime_after_hours: number;
  overtime_multiplier: number;
  active: boolean;
  created_at: string;
}

/** What every signed-in user may see about a colleague (never pay). */
export type PublicProfile = Pick<Profile, 'id' | 'username' | 'full_name' | 'avatar_url' | 'role' | 'job_title' | 'active'>;

/** The single `settings` row. */
export interface Settings {
  id: number;
  company_name: string;
  currency: string;
  timezone: string;
  schedule_deadline_dow: number;
  schedule_deadline_time: string;
  daily_email_time: string;
  auto_clockout_hours: number;
  /** Working day shown on the Today timeline, 'HH:MM' (PLAN.md 10b). */
  day_start: string;
  day_end: string;
  report_recipients: string[];
  /** false = staff must scan the QR code to clock in / out (PLAN.md 13, q6). */
  allow_button_clock: boolean;
  /** Phase 8 emails (migration 013), company time. */
  emails_enabled: boolean;
  owner_daily_time: string;
  weekly_email_dow: number;
  weekly_email_time: string;
  reminder_time: string;
}

/** In-app notification types (PLAN.md section 3). The table arrives in Phase 5. */
export type NotificationType =
  | 'correction.requested'
  | 'leave.requested'
  | 'request.approved'
  | 'request.declined'
  | 'schedule.missing'
  | 'schedule.changed'
  | 'shift.auto_closed'
  | 'pay.requested';

export interface Notification {
  id: string;
  recipient_id: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

/** A row of `time_entries` (PLAN.md section 5). */
export interface TimeEntry {
  id: string;
  user_id: string;
  clock_in: string;
  clock_out: string | null;
  method: 'button' | 'qr' | 'manual' | 'auto';
  location_id: string | null;
  break_minutes: number;
  note: string | null;
  edited: boolean;
  /** Who added or approved this entry (a manager, the owner, or 'Auto clock-out'). */
  edited_by_name?: string | null;
  created_at: string;
}

/** A row of `v_today_board` (PLAN.md section 5): today's shift + clock data, no pay. */
export interface TodayBoardRow {
  user_id: string;
  shift_start: string | null;   // 'HH:MM:SS'
  shift_end: string | null;
  shift_note: string | null;
  first_in: string | null;
  last_out: string | null;
  is_open: boolean;
  worked_minutes: number;
  status: 'working' | 'upcoming' | 'late' | 'finished' | 'off' | 'on_leave' | 'absent';
}

export type WeekStatus = 'draft' | 'submitted' | 'locked';

/** A row of `schedule_weeks`: one per person per Monday. */
export interface ScheduleWeek {
  id: string;
  user_id: string;
  week_start: string;           // 'YYYY-MM-DD' (Monday)
  status: WeekStatus;
  submitted_at: string | null;
  locked_by: string | null;
  locked_at: string | null;
}

/** A row of `schedule_shifts`. */
export interface ScheduleShift {
  id: string;
  week_id: string;
  user_id: string;
  date: string;                 // 'YYYY-MM-DD'
  start_time: string;           // 'HH:MM' or 'HH:MM:SS'
  end_time: string;
  note: string | null;
  edited_by: string | null;
}

/** A row of `locations` as the app sees it (the QR secret is never readable). */
export interface Location {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  radius_m: number | null;
  allow_static: boolean;
  active: boolean;
  created_at: string;
}

export type RequestStatus = 'pending' | 'approved' | 'declined';

/** A row of `profile_requests`: an hourly-rate change the owner approves (migration 016). */
export interface PayRequest {
  id: string;
  user_id: string;
  old_rate: number | null;
  new_rate: number;
  reason: string;
  status: RequestStatus;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

/** A row of `corrections`: fix a wrong clock time, or add a shift that was never clocked (entry_id null). */
export interface Correction {
  id: string;
  user_id: string;
  entry_id: string | null;
  old_clock_in: string | null;
  old_clock_out: string | null;
  new_clock_in: string;
  new_clock_out: string;
  reason: string;
  status: RequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  applied_entry_id: string | null;
  created_at: string;
}

export type LeaveType = 'annual' | 'sick' | 'unpaid' | 'other';

/** A row of `leave_requests`. Dates are 'YYYY-MM-DD', end inclusive. */
export interface LeaveRequest {
  id: string;
  user_id: string;
  type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: RequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}
