import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Sidebar from './Sidebar';
import MobileBottomNav from './MobileBottomNav';
import CommandPalette from '../components/CommandPalette';
import TopHeader from './shell/TopHeader';
import ModuleBar from './shell/ModuleBar';
import StatusBar from './shell/StatusBar';
import ShellDialogs from './shell/ShellDialogs';
import { ShellProvider, useShell } from './shell/ShellContext';
import { useAuth } from '../context/AuthContext';
import AccessDenied from '../components/AccessDenied';
import { navItems } from './navigation';
import { firstAccessibleRoute } from '../permissions/navigation';

const SIDEBAR_COLLAPSED_KEY = 'b1_sidebar_collapsed';

export default function MainLayout() {
  return (
    <ShellProvider>
      <Shell />
    </ShellProvider>
  );
}

function Shell() {
  const shell = useShell();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const { access, canAccessPath } = useAuth();

  // Generic route guard: the path is resolved through the navigation registry to its
  // module/page and checked by the central permission service.
  const denied = !canAccessPath(location.pathname);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      // Storage unavailable — collapse preference just won't persist.
    }
  }, [collapsed]);

  // Global shortcuts. Save/New/Print/Reload are deliberately left to the browser.
  const { setSearchOpen, setModulesOpen, modulesOpen } = shell;
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (key === 'k' || key === 'f') && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.altKey && !e.ctrlKey && key === 'm') {
        e.preventDefault();
        setModulesOpen(!modulesOpen);
      } else if (e.altKey && !e.ctrlKey && key === 'h') {
        e.preventDefault();
        navigate('/');
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [setSearchOpen, setModulesOpen, modulesOpen, navigate]);

  // Users who can't see the home page land on the first page they can open.
  if (location.pathname === '/' && denied) {
    const landing = firstAccessibleRoute(navItems, access);
    if (landing) return <Navigate to={landing} replace />;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-bg">
      <TopHeader />
      <ModuleBar />
      <div className="flex flex-1 min-h-0">
        <Sidebar
          open={shell.sidebarOpen}
          onClose={() => shell.setSidebarOpen(false)}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((c) => !c)}
        />
        <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 pb-20 lg:pb-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            >
              {denied ? <AccessDenied /> : <Outlet />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <StatusBar />
      <MobileBottomNav />

      <CommandPalette open={shell.searchOpen} onClose={() => shell.setSearchOpen(false)} />
      <ShellDialogs />
    </div>
  );
}
