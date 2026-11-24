import type { Profile, Role } from '@/types';

export const ROLES: Role[] = ['owner', 'manager', 'employee'];

/** Roles that can open /admin/* (the "authorized person" and the owner). */
export const ADMIN_ROLES: Role[] = ['owner', 'manager'];

export const roleLabel: Record<Role, string> = {
  owner: 'Owner',
  manager: 'Manager',
  employee: 'Employee',
};

export const isAdminRole = (role: Role | undefined | null) => role === 'owner' || role === 'manager';

/** Everyone lands on the dashboard at "/"; it adapts to the role. */
export function getDashboardPath(_role: Role): string {
  return '/';
}

export function getDashboardLabel(role: Role): string {
  return isAdminRole(role) ? 'Team overview' : 'My day';
}

export function isAllowedRole(profile: Profile | null, allowed: Role[]): boolean {
  if (!profile) return false;
  return allowed.includes(profile.role);
}

/** Supabase Auth needs an email, so a username maps to an internal address (PLAN.md section 2). */
export const INTERNAL_EMAIL_DOMAIN = 'shiftclock.local';
export const normaliseUsername = (u: string) => u.trim().toLowerCase();
export const usernameToEmail = (u: string) => `${normaliseUsername(u)}@${INTERNAL_EMAIL_DOMAIN}`;
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
