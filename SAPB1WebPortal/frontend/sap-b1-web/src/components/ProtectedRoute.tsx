import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import AccessDenied from './AccessDenied';
import { useAuth } from '../context/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactElement;
  /** If set, the route also requires this permission (e.g. "Administration.View") —
   *  UX only, the backend independently rejects any API call the user isn't
   *  actually authorized for regardless of this check. */
  requiredPermission?: string;
  /** Requires this action (e.g. "Create") on whichever module/page the current URL resolves to
   *  through the navigation registry — no module names at the call site. */
  requiredAction?: string;
}

export default function ProtectedRoute({ children, requiredPermission, requiredAction }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, can, canAccessPath } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg text-ink-secondary text-sm">
        <Loader2 className="h-4 w-4 animate-spin mr-2 text-brand-600 dark:text-brand-400" />
        Loading…
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if ((requiredPermission && !can(requiredPermission)) || (requiredAction && !canAccessPath(location.pathname, requiredAction))) {
    return <AccessDenied />;
  }

  return children;
}
