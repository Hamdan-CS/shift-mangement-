import { CalendarDays, CalendarRange, CheckSquare, Clock3, History, House, MessageSquare, Plane, Receipt, Settings, Users, Wallet, BarChart3, QrCode, type LucideIcon } from 'lucide-react';
import type { Role } from '@/types';

export interface NavItem { label: string; to: string; roles: Role[]; icon: LucideIcon; dot?: boolean }

const ALL: Role[] = ['owner', 'manager', 'employee'];
const ADMIN: Role[] = ['owner', 'manager'];
const EMPLOYEE: Role[] = ['employee'];

/** Every page a role can reach, in nav order (PLAN.md sections 10, 10c, 11). */
export const NAV: NavItem[] = [
  { label: 'Home', to: '/', roles: ALL, icon: House },
  { label: 'Today', to: '/today', roles: ALL, icon: Clock3 },
  { label: 'Schedule', to: '/schedule', roles: EMPLOYEE, icon: CalendarDays },
  { label: 'Pay', to: '/pay', roles: ['employee', 'manager'], icon: Wallet },
  { label: 'History', to: '/history', roles: ['employee', 'manager'], icon: History },
  { label: 'Leave', to: '/leave', roles: ['employee', 'manager'], icon: Plane },
  { label: 'Schedule', to: '/admin/schedule', roles: ADMIN, icon: CalendarRange },
  { label: 'Timesheets', to: '/admin/timesheets', roles: ADMIN, icon: Clock3 },
  { label: 'Approvals', to: '/admin/approvals', roles: ADMIN, icon: CheckSquare },
  { label: 'People', to: '/admin/people', roles: ADMIN, icon: Users },
  { label: 'Payroll', to: '/admin/payroll', roles: ADMIN, icon: Receipt },
  { label: 'Reports', to: '/admin/reports', roles: ADMIN, icon: BarChart3 },
  { label: 'Messages', to: '/messages', roles: ALL, icon: MessageSquare },
  { label: 'Locations & QR', to: '/admin/locations', roles: ADMIN, icon: QrCode },
  { label: 'Settings', to: '/admin/settings', roles: ['owner'], icon: Settings },
];

const byRole = (role: Role) => NAV.filter((n) => n.roles.includes(role));

/** Desktop top pill nav (≥1024px). Settings lives in the user menu. */
export const topNavFor = (role: Role) => byRole(role).filter((n) => n.to !== '/admin/settings' && n.to !== '/admin/locations' && !(role !== 'employee' && (n.to === '/history' || n.to === '/leave' || n.to === '/pay'))).map((n) => (n.to === '/' ? { ...n, label: 'Overview' } : n));

/** Bottom tab bar (<1024px): 4 tabs + More (PLAN.md 10c). */
const TAB_PATHS: Record<Role, string[]> = {
  employee: ['/', '/today', '/schedule', '/pay'],
  manager: ['/', '/today', '/admin/schedule', '/admin/approvals'],
  owner: ['/', '/today', '/admin/schedule', '/admin/approvals'],
};
export const tabsFor = (role: Role) => TAB_PATHS[role].map((p) => NAV.find((n) => n.to === p && n.roles.includes(role))!).filter(Boolean);

/** Everything else, shown in the "More" sheet. */
export const moreFor = (role: Role) => byRole(role).filter((n) => !TAB_PATHS[role].includes(n.to));
