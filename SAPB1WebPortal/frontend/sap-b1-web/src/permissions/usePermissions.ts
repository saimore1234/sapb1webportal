import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { resolveRoute } from './registry';

/**
 * Action permissions for the page the user is currently on, resolved through the
 * navigation registry — so any page, present or future, can gate its buttons with:
 *
 *   const { canCreate, canEdit, canDelete, canExport, canApprove } = usePermissions();
 *   {canCreate && <button>New</button>}
 *
 * No module or page names at the call site. A path the registry doesn't know gets no
 * action rights (View is not gated here — the route guard does that).
 */
export function usePermissions() {
  const { pathname } = useLocation();
  const { hasPermission } = useAuth();

  return useMemo(() => {
    const resolved = resolveRoute(pathname);
    const check = (action: string) => !!resolved && hasPermission(resolved.module.key, resolved.page?.key, action);
    return {
      moduleKey: resolved?.module.key,
      pageKey: resolved?.page?.key,
      can: check,
      canView: check('View'),
      canCreate: check('Create'),
      canEdit: check('Edit'),
      canDelete: check('Delete'),
      canExport: check('Export'),
      canApprove: check('Approve')
    };
  }, [pathname, hasPermission]);
}
