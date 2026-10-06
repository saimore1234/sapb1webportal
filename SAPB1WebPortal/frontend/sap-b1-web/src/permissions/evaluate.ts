import { VIEW_ACTION, resolveRoute, type PermissionModule } from './registry';

/**
 * The ONE place the frontend permission rules live (mirrors RoleAccess.cs on the
 * server, which is what actually enforces them). Pure functions, no module or page
 * names. Keys are compared case-insensitively.
 *
 *  - full access (Administrator / portal admin): everything, including future modules;
 *  - action on a module needs the module grant AND the module's View;
 *  - action on a page additionally needs the page grant AND the page's View, where a
 *    page with no explicit rule inherits (allowed by the module grant).
 */
export interface AccessSnapshot {
  fullAccess: boolean;
  /** "module.action", lower-cased. */
  moduleGrants: Set<string>;
  /** "module.page.action" (lower-cased) -> explicit grant. */
  pageRules: Map<string, boolean>;
}

export const emptyAccess = (): AccessSnapshot => ({ fullAccess: false, moduleGrants: new Set(), pageRules: new Map() });

export function buildAccess(fullAccess: boolean, moduleKeys: string[], pageRules: Record<string, boolean>): AccessSnapshot {
  return {
    fullAccess,
    moduleGrants: new Set(moduleKeys.map((k) => k.toLowerCase())),
    pageRules: new Map(Object.entries(pageRules).map(([k, v]) => [k.toLowerCase(), v]))
  };
}

const moduleGranted = (a: AccessSnapshot, module: string, action: string) =>
  a.moduleGrants.has(`${module}.${action}`.toLowerCase());

const pageRule = (a: AccessSnapshot, module: string, page: string, action: string) =>
  a.pageRules.get(`${module}.${page}.${action}`.toLowerCase()) ?? true;

export function hasPermission(a: AccessSnapshot, module: string, page: string | undefined | null, action: string): boolean {
  if (a.fullAccess) return true;
  if (!moduleGranted(a, module, action) || !moduleGranted(a, module, VIEW_ACTION)) return false;
  if (!page) return true;
  return pageRule(a, module, page, action) && pageRule(a, module, page, VIEW_ACTION);
}

/** Access to a URL, resolved through the navigation registry. Unregistered paths (404s, login) are not gated. */
export function canAccessPath(a: AccessSnapshot, pathname: string, action = VIEW_ACTION, modules?: PermissionModule[]): boolean {
  const resolved = resolveRoute(pathname, modules);
  if (!resolved) return true;
  return hasPermission(a, resolved.module.key, resolved.page?.key, action);
}
