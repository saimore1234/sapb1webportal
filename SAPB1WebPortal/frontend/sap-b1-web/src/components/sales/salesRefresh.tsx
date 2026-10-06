import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

/**
 * Live-refresh state shared by every Sales dashboard/report section.
 * A section re-fetches whenever `tick` changes (auto-refresh timer or the
 * Refresh button) and calls `markUpdated()` after a successful load so the
 * "Updated" stamp reflects when data actually arrived.
 */
interface SalesRefreshValue {
  tick: number;
  markUpdated: () => void;
  refresh: () => void;
  updatedAt: Date | null;
  intervalMin: number;
  setIntervalMin: (m: number) => void;
}

const STORAGE_KEY = 'sales_auto_refresh_min';
const OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 1, label: 'Every 1 min' },
  { value: 5, label: 'Every 5 min' }
];

const SalesRefreshContext = createContext<SalesRefreshValue>({
  tick: 0,
  markUpdated: () => {},
  refresh: () => {},
  updatedAt: null,
  intervalMin: 0,
  setIntervalMin: () => {}
});

export const useSalesRefresh = () => useContext(SalesRefreshContext);

function storedInterval() {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    return OPTIONS.some((o) => o.value === v) && localStorage.getItem(STORAGE_KEY) !== null ? v : 5;
  } catch {
    return 5;
  }
}

export function SalesRefreshProvider({ children }: { children: React.ReactNode }) {
  const [tick, setTick] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [intervalMin, setIntervalState] = useState(storedInterval);
  const lastTickAt = useRef(Date.now());

  const refresh = useCallback(() => {
    lastTickAt.current = Date.now();
    setTick((t) => t + 1);
  }, []);
  const markUpdated = useCallback(() => setUpdatedAt(new Date()), []);

  function setIntervalMin(m: number) {
    setIntervalState(m);
    try {
      localStorage.setItem(STORAGE_KEY, String(m));
    } catch {
      // Storage unavailable — the choice just won't be remembered.
    }
  }

  useEffect(() => {
    if (!intervalMin) return;
    const ms = intervalMin * 60_000;
    // Skip ticks while the tab is hidden so a forgotten tab doesn't keep hitting SAP.
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, ms);
    // Coming back to a tab that sat hidden past the interval: refresh straight away.
    const onVisible = () => {
      if (!document.hidden && Date.now() - lastTickAt.current >= ms) refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMin, refresh]);

  const value = useMemo(
    () => ({ tick, markUpdated, refresh, updatedAt, intervalMin, setIntervalMin }),
    [tick, markUpdated, refresh, updatedAt, intervalMin]
  );
  return <SalesRefreshContext.Provider value={value}>{children}</SalesRefreshContext.Provider>;
}

/** "Updated 3:42:10 pm · [auto-refresh select] · [Refresh]" */
export function RefreshBar() {
  const { updatedAt, refresh, intervalMin, setIntervalMin } = useSalesRefresh();
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
      <span aria-live="polite">
        {updatedAt ? `Updated ${updatedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Loading…'}
      </span>
      <select
        value={intervalMin}
        onChange={(e) => setIntervalMin(Number(e.target.value))}
        aria-label="Auto-refresh"
        className="px-2 py-1.5 text-xs rounded-lg border border-border-strong bg-surface text-ink-primary"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.value === 0 ? 'Auto-refresh: Off' : o.label}
          </option>
        ))}
      </select>
      <button className="btn-secondary !py-1.5 !px-3 !text-xs" onClick={refresh}>
        <RefreshCw className="h-3.5 w-3.5" /> Refresh
      </button>
    </div>
  );
}
