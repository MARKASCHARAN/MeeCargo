import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import type { UserRole } from '../../types/api';
import { Button } from '../ui/Button';
import { LoadingState, UnauthorizedState } from '../ui/StateViews';

export function RoleGuard({
  allowedRole,
  children,
}: {
  allowedRole: UserRole;
  children: ReactNode;
}) {
  const { user, isInitialized, logout } = useAuthStore();
  const location = useLocation();

  if (!isInitialized) {
    return (
      <div className="p-6">
        <LoadingState title="Verifying session..." />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (user.role !== allowedRole) {
    const ownPortal =
      user.role === 'SHIPPER'
        ? '/shipper'
        : user.role === 'PLATFORM_OWNER'
          ? '/owner'
          : '/driver';
    const ownLabel =
      user.role === 'SHIPPER'
        ? 'Shipper Portal'
        : user.role === 'PLATFORM_OWNER'
          ? 'Platform Owner Portal'
          : 'Driver PWA';
    return (
      <div className="flex min-h-[70vh] items-center justify-center p-4">
        <UnauthorizedState
          title="Role authorization required"
          description={`You are signed in as ${user.role}, which cannot access ${allowedRole} routes.`}
          action={
            <>
              <Link to={ownPortal}>
                <Button variant="primary" size="sm">
                  Go to {ownLabel}
                </Button>
              </Link>
              <Button variant="outline" size="sm" onClick={logout}>
                Switch account
              </Button>
            </>
          }
        />
      </div>
    );
  }

  return <>{children}</>;
}
