import type { NavItem } from '../layouts/navigation';
import { canAccessPath, type AccessSnapshot } from './evaluate';

/** Filters the navigation tree down to what the user may view. A group with no
 *  accessible children is dropped. Used by every menu (sidebar, mobile "More"). */
export function filterNavigation(items: NavItem[], access: AccessSnapshot): NavItem[] {
  const out: NavItem[] = [];
  for (const item of items) {
    if (item.children) {
      const children = item.children.filter((c) => canAccessPath(access, c.to));
      if (children.length > 0) out.push({ ...item, children });
    } else if (item.to === undefined || canAccessPath(access, item.to)) {
      out.push(item);
    }
  }
  return out;
}

/** First route in the (already filtered) navigation, used to land users who can't see the home page. */
export function firstAccessibleRoute(items: NavItem[], access: AccessSnapshot): string | null {
  const filtered = filterNavigation(items, access);
  for (const item of filtered) {
    if (item.children) return item.children[0].to;
    if (item.to) return item.to;
  }
  return null;
}
