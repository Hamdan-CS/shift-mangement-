import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getDashboardPath } from '@/utils/roles';
import { LoopLoader } from '@/components/shared/ui/LoopLoader';
import type { Role } from '@/types';

interface RoleRouteProps {
  /** Roles allowed in. Omit to allow any signed-in user. */
  allowed?: Role[];
  children: React.ReactNode;
}

/** Signed-in only, optionally limited to some roles. RLS enforces the same rules server-side. */
export function RoleRoute({ allowed, children }: RoleRouteProps) {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <LoopLoader size={28} />
      </div>
    );
  }

  if (!user || !profile) {
    // keep the query (e.g. /clock?loc=…&t=…) so a QR scan still works after signing in
    return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  }

  if (allowed && !allowed.includes(profile.role)) {
    // They cannot open another role's pages: send them to their own dashboard.
    return <Navigate to={getDashboardPath(profile.role)} replace />;
  }

  return <>{children}</>;
}
