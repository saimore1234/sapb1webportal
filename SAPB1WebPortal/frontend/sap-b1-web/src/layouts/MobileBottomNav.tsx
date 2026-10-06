import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, Package, Menu as MenuIcon, LogOut, Moon, Sun } from 'lucide-react';
import Modal from '../components/ui/Modal';
import { navItems } from './navigation';
import { filterNavigation } from '../permissions/navigation';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

const tabs = [
  { to: '/', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/items', label: 'Items', icon: Package }
];

export default function MobileBottomNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const navigate = useNavigate();
  const { logout, access, canAccessPath } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const moreItems = filterNavigation(navItems, access).filter((i) => !['dashboard', 'items'].includes(i.key));

  return (
    <>
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-20 bg-surface border-t border-border flex items-stretch"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {tabs.filter((tab) => canAccessPath(tab.to)).map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
                isActive ? 'text-brand-600 dark:text-brand-400' : 'text-ink-tertiary'
              }`
            }
          >
            <tab.icon className="h-5 w-5" />
            {tab.label}
          </NavLink>
        ))}
        <button
          onClick={() => setMoreOpen(true)}
          className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium text-ink-tertiary"
        >
          <MenuIcon className="h-5 w-5" />
          More
        </button>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} variant="sheet" labelledBy="more-sheet-label">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <p id="more-sheet-label" className="text-sm font-semibold text-ink-primary">
            More
          </p>
        </div>
        <div className="overflow-y-auto py-2">
          {moreItems.map((item) => {
            const Icon = item.icon;
            if (item.children) {
              return item.children.map((child) => (
                <button
                  key={child.to}
                  onClick={() => {
                    navigate(child.to);
                    setMoreOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm text-ink-primary hover:bg-surface-tertiary text-left"
                >
                  <Icon className="h-[18px] w-[18px] text-ink-tertiary" />
                  {child.label}
                </button>
              ));
            }
            return (
              <button
                key={item.key}
                onClick={() => {
                  navigate(item.to!);
                  setMoreOpen(false);
                }}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface-tertiary text-left"
              >
                <span className={`flex items-center gap-3 ${item.available ? 'text-ink-primary' : 'text-ink-tertiary'}`}>
                  <Icon className="h-[18px] w-[18px]" />
                  {item.label}
                </span>
                {!item.available && <span className="text-[10px] font-semibold uppercase text-ink-tertiary">Soon</span>}
              </button>
            );
          })}
          <div className="my-1.5 border-t border-border" />
          <button
            onClick={toggleTheme}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-ink-primary hover:bg-surface-tertiary text-left"
          >
            {theme === 'dark' ? <Sun className="h-[18px] w-[18px] text-ink-tertiary" /> : <Moon className="h-[18px] w-[18px] text-ink-tertiary" />}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button
            onClick={() => logout()}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-danger hover:bg-danger-bg text-left"
          >
            <LogOut className="h-[18px] w-[18px]" />
            Log out
          </button>
        </div>
      </Modal>
    </>
  );
}
