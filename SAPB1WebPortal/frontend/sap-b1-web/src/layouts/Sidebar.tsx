import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { navItems as allNavItems } from './navigation';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useAuth } from '../context/AuthContext';
import { filterNavigation } from '../permissions/navigation';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export default function Sidebar({ open, onClose, collapsed, onToggleCollapsed }: SidebarProps) {
  const location = useLocation();
  const { access } = useAuth();
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  // Permission-driven: the registry tree is filtered by the central permission service.
  const navItems = useMemo(() => filterNavigation(allNavItems, access), [access]);
  // "collapsed" is a desktop-only preference — the mobile drawer is always
  // shown at full width regardless of it, so every label/chevron below reads
  // this instead of the raw prop.
  const isCollapsed = collapsed && isDesktop;

  const [expandedGroup, setExpandedGroup] = useState<string | null>(() => {
    const active = navItems.find((item) => item.children?.some((c) => location.pathname.startsWith(c.to)));
    return active?.key ?? null;
  });

  useEffect(() => {
    const active = navItems.find((item) => item.children?.some((c) => location.pathname.startsWith(c.to)));
    if (active) setExpandedGroup(active.key);
  }, [location.pathname]);

  const linkBase =
    'flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg transition-colors mx-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';

  return (
    <>
      {open && <div className="fixed inset-0 bg-slate-950/40 z-20 lg:hidden" onClick={onClose} aria-hidden="true" />}

      <aside
        className={`fixed z-30 lg:static top-0 left-0 h-full bg-brand-950 text-white flex flex-col transition-[width,transform] duration-200 ease-out shrink-0
          ${open ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0
          ${collapsed ? 'lg:w-[76px]' : 'lg:w-64'} w-64`}
      >
        <div className={`lg:hidden h-14 flex items-center border-b border-white/10 shrink-0 ${isCollapsed ? 'justify-center px-0' : 'px-5'}`}>
          <div className="h-8 w-8 rounded-lg bg-white/10 flex items-center justify-center font-bold text-sm shrink-0">B1</div>
          {!isCollapsed && <span className="ml-2.5 font-semibold text-[15px] truncate">Business Hub</span>}
        </div>

        <nav className="flex-1 overflow-y-auto py-3 no-scrollbar">
          {navItems.map((item) => {
            const Icon = item.icon;

            if (item.children) {
              const isGroupActive = item.children.some((c) => location.pathname.startsWith(c.to));
              const isExpanded = expandedGroup === item.key && !isCollapsed;
              return (
                <div key={item.key} className="mb-0.5">
                  <button
                    onClick={() => setExpandedGroup(isExpanded ? null : item.key)}
                    className={`${linkBase} w-[calc(100%-1rem)] justify-between ${
                      isGroupActive ? 'bg-white/10 text-white font-medium' : 'text-white/75 hover:bg-white/5 hover:text-white'
                    }`}
                    title={isCollapsed ? item.label : undefined}
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      {!isCollapsed && <span className="truncate">{item.label}</span>}
                    </span>
                    {!isCollapsed && (
                      <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    )}
                  </button>
                  {isExpanded && (
                    <div className="ml-[34px] mt-0.5 space-y-0.5 border-l border-white/10 pl-3">
                      {item.children.map((child) => (
                        <NavLink
                          key={child.to}
                          to={child.to}
                          end={child.end}
                          onClick={onClose}
                          className={({ isActive }) =>
                            `block px-3 py-2 text-sm rounded-lg transition-colors ${
                              isActive ? 'bg-white/10 text-white font-medium' : 'text-white/65 hover:bg-white/5 hover:text-white'
                            }`
                          }
                        >
                          {child.label}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            if (!item.available) {
              return (
                <NavLink
                  key={item.key}
                  to={item.to!}
                  onClick={onClose}
                  title={isCollapsed ? `${item.label} — coming soon` : undefined}
                  className={({ isActive }) =>
                    `${linkBase} justify-between ${
                      isActive ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/5 hover:text-white/70'
                    }`
                  }
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    {!isCollapsed && <span className="truncate">{item.label}</span>}
                  </span>
                  {!isCollapsed && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide bg-white/10 text-white/50 px-1.5 py-0.5 rounded">
                      Soon
                    </span>
                  )}
                </NavLink>
              );
            }

            return (
              <NavLink
                key={item.key}
                to={item.to!}
                end={item.end}
                onClick={onClose}
                title={isCollapsed ? item.label : undefined}
                className={({ isActive }) =>
                  `${linkBase} ${isActive ? 'bg-white/10 text-white font-medium' : 'text-white/75 hover:bg-white/5 hover:text-white'}`
                }
              >
                <Icon className="h-[18px] w-[18px] shrink-0" />
                {!isCollapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-2 hidden lg:block">
          <button
            onClick={onToggleCollapsed}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-white/60 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
          >
            {isCollapsed ? <ChevronsRight className="h-[18px] w-[18px]" /> : <ChevronsLeft className="h-[18px] w-[18px]" />}
            {!isCollapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
