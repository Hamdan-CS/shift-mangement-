import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/contexts/AuthContext';
import { ClockProvider } from '@/contexts/ClockContext';
import { ThemeProvider, useTheme } from '@/design-system/ThemeProvider';
import { AppShell } from '@/components/app/AppShell';
import { RoleRoute } from '@/components/auth/RoleRoute';
import { GuestOnlyRoute } from '@/components/auth/GuestOnlyRoute';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { DESKTOP, useMediaQuery } from '@/hooks/useMediaQuery';

// Home and login load first; everything else is split out (PLAN.md 10c: lazy-load admin pages).
const HistoryPage = lazy(() => import('@/pages/HistoryPage').then((m) => ({ default: m.HistoryPage })));
const SchedulePage = lazy(() => import('@/pages/SchedulePage').then((m) => ({ default: m.SchedulePage })));
const AdminSchedulePage = lazy(() => import('@/pages/AdminSchedulePage').then((m) => ({ default: m.AdminSchedulePage })));
const KioskPage = lazy(() => import('@/pages/KioskPage').then((m) => ({ default: m.KioskPage })));
const ClockScanPage = lazy(() => import('@/pages/ClockScanPage').then((m) => ({ default: m.ClockScanPage })));
const LocationsPage = lazy(() => import('@/pages/LocationsPage').then((m) => ({ default: m.LocationsPage })));
const LeavePage = lazy(() => import('@/pages/LeavePage').then((m) => ({ default: m.LeavePage })));
const ApprovalsPage = lazy(() => import('@/pages/ApprovalsPage').then((m) => ({ default: m.ApprovalsPage })));
const MessagesPage = lazy(() => import('@/pages/MessagesPage').then((m) => ({ default: m.MessagesPage })));
const PayPage = lazy(() => import('@/pages/PayPage').then((m) => ({ default: m.PayPage })));
const PayrollPage = lazy(() => import('@/pages/PayrollPage').then((m) => ({ default: m.PayrollPage })));
const PeoplePage = lazy(() => import('@/pages/PeoplePage').then((m) => ({ default: m.PeoplePage })));
const PersonPage = lazy(() => import('@/pages/PersonPage').then((m) => ({ default: m.PersonPage })));
const TimesheetsPage = lazy(() => import('@/pages/TimesheetsPage').then((m) => ({ default: m.TimesheetsPage })));
const ReportsPage = lazy(() => import('@/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const AccountPage = lazy(() => import('@/pages/AccountPage').then((m) => ({ default: m.AccountPage })));
const TodayPage = lazy(() => import('@/pages/TodayPage').then((m) => ({ default: m.TodayPage })));
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })));

function ThemedToaster() {
  const { theme } = useTheme();
  const desktop = useMediaQuery(DESKTOP);
  // keep toasts above the bottom tab bar on phones and tablets
  const bottom = desktop ? 24 : 'calc(96px + env(safe-area-inset-bottom, 0px))';
  return <Toaster position="bottom-center" theme={theme} offset={{ bottom }} mobileOffset={{ bottom, left: 12, right: 12 }} />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<GuestOnlyRoute><LoginPage /></GuestOnlyRoute>} />
            {/* full-screen pages, outside the app shell */}
            <Route path="/kiosk/:locationId" element={<RoleRoute allowed={['owner', 'manager']}><Suspense fallback={null}><KioskPage /></Suspense></RoleRoute>} />
            <Route path="/clock" element={<RoleRoute><Suspense fallback={null}><ClockScanPage /></Suspense></RoleRoute>} />
            <Route element={<RoleRoute><ClockProvider><AppShell /></ClockProvider></RoleRoute>}>
              <Route index element={<DashboardPage />} />
              <Route path="/today" element={<TodayPage />} />
              <Route path="/schedule" element={<RoleRoute allowed={['employee']}><SchedulePage /></RoleRoute>} />
              <Route path="/admin/schedule" element={<RoleRoute allowed={['owner', 'manager']}><AdminSchedulePage /></RoleRoute>} />
              <Route path="/messages" element={<MessagesPage />} />
              <Route path="/messages/:id" element={<MessagesPage />} />
              <Route path="/leave" element={<RoleRoute allowed={['employee', 'manager']}><LeavePage /></RoleRoute>} />
              <Route path="/admin/approvals" element={<RoleRoute allowed={['owner', 'manager']}><ApprovalsPage /></RoleRoute>} />
              <Route path="/admin/locations" element={<RoleRoute allowed={['owner', 'manager']}><LocationsPage /></RoleRoute>} />
              <Route path="/pay" element={<RoleRoute allowed={['employee', 'manager']}><PayPage /></RoleRoute>} />
              <Route path="/admin/payroll" element={<RoleRoute allowed={['owner', 'manager']}><PayrollPage /></RoleRoute>} />
              <Route path="/admin/people" element={<RoleRoute allowed={['owner', 'manager']}><PeoplePage /></RoleRoute>} />
              <Route path="/admin/people/:id" element={<RoleRoute allowed={['owner', 'manager']}><PersonPage /></RoleRoute>} />
              <Route path="/admin/timesheets" element={<RoleRoute allowed={['owner', 'manager']}><TimesheetsPage /></RoleRoute>} />
              <Route path="/admin/reports" element={<RoleRoute allowed={['owner', 'manager']}><ReportsPage /></RoleRoute>} />
              <Route path="/admin/settings" element={<RoleRoute allowed={['owner']}><SettingsPage /></RoleRoute>} />
              <Route path="/history" element={<RoleRoute allowed={['employee', 'manager']}><HistoryPage /></RoleRoute>} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <ThemedToaster />
      </AuthProvider>
    </ThemeProvider>
  );
}
