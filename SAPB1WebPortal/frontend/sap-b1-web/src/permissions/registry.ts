import type { LucideIcon } from 'lucide-react';
import { navItems as defaultNavItems, type NavItem } from '../layouts/navigation';

/**
 * Derives the permission hierarchy (module -> page -> action) from the application
 * navigation registry (src/layouts/navigation.ts). Nothing here knows any module or
 * page name: adding to the navigation tree is all it takes for a module/page to
 * appear in Administration > Roles, the sidebar filter and the route guard.
 */

export const STANDARD_ACTIONS = ['View', 'Create', 'Edit', 'Delete', 'Export', 'Approve'] as const;
export const VIEW_ACTION = 'View';

export interface PermissionPage {
  key: string;
  label: string;
  route: string;
  /** Exact-match only (module root pages such as a dashboard). */
  exact: boolean;
  actions: string[];
}

export interface PermissionModule {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Set for single-route modules (no pages). */
  route?: string;
  /** First path segment shared by this module's routes ('' for the app root). */
  prefix: string;
  actions: string[];
  pages: PermissionPage[];
}

export interface ResolvedRoute {
  module: PermissionModule;
  page?: PermissionPage;
}

const pascal = (s: string) =>
  s
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join('');

const firstSegment = (route: string) => route.split('/').filter(Boolean)[0] ?? '';

/** Page key: explicit, else the route path below the module prefix ("/sales/credit-memos" -> "credit-memos"). */
function derivePageKey(route: string): string {
  const rest = route.split('/').filter(Boolean).slice(1);
  return rest.length ? rest.join('-') : 'index';
}

export function buildPermissionModules(items: NavItem[] = defaultNavItems): PermissionModule[] {
  const modules: PermissionModule[] = [];

  for (const item of items) {
    const actions = item.actions ?? [...STANDARD_ACTIONS];

    if (!item.children) {
      modules.push({
        key: item.permissionModule ?? pascal(item.key),
        label: item.label,
        icon: item.icon,
        route: item.to,
        prefix: firstSegment(item.to ?? ''),
        actions,
        pages: []
      });
      continue;
    }

    const own = item.children.filter((c) => c.permissionModule);
    const pageChildren = item.children.filter((c) => !c.permissionModule);

    if (pageChildren.length > 0) {
      modules.push({
        key: item.permissionModule ?? pascal(item.key),
        label: item.label,
        icon: item.icon,
        prefix: firstSegment(pageChildren[0].to),
        actions,
        pages: pageChildren.map((c) => ({
          key: c.key ?? derivePageKey(c.to),
          label: c.label,
          route: c.to,
          exact: !!c.end,
          actions: c.actions ?? actions
        }))
      });
    }

    for (const c of own) {
      modules.push({
        key: c.permissionModule!,
        label: c.label,
        icon: item.icon,
        route: c.to,
        prefix: firstSegment(c.to),
        actions: c.actions ?? [...STANDARD_ACTIONS],
        pages: []
      });
    }
  }

  return modules;
}

/** Every module registered in the application navigation. */
export const getApplicationModules = (): PermissionModule[] => buildPermissionModules();

export function getModulePages(module: PermissionModule): PermissionPage[] {
  return module.pages;
}

/** Maps a URL path to the registered module/page that owns it (longest route prefix wins). */
export function resolveRoute(pathname: string, modules: PermissionModule[] = getApplicationModules()): ResolvedRoute | null {
  let best: { r: ResolvedRoute; len: number } | null = null;

  const consider = (route: string, exact: boolean, r: ResolvedRoute) => {
    const matches = pathname === route || (!exact && route !== '/' && pathname.startsWith(route + '/'));
    if (matches && (!best || route.length > best.len)) best = { r, len: route.length };
  };

  for (const m of modules) {
    if (m.route) consider(m.route, false, { module: m });
    for (const p of m.pages) consider(p.route, p.exact, { module: m, page: p });
  }
  if (best) return (best as { r: ResolvedRoute }).r;

  // Unknown sub-route of a module (e.g. a detail path no page claims): module-level check only.
  const seg = firstSegment(pathname);
  const owner = seg ? modules.find((m) => m.prefix === seg) : undefined;
  return owner ? { module: owner } : null;
}
