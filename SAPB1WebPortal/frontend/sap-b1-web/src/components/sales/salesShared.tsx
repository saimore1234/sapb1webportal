import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { getSalesOverview } from '../../api/sales';
import type { SalesOverview } from '../../types';
import { useTheme } from '../../context/ThemeContext';
import { useSalesRefresh } from './salesRefresh';

export const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const num = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** ₹ in Cr / L / K so large values fit chart labels and tiles. */
export function compactInr(v: number) {
  const a = Math.abs(v);
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(1)} L`;
  if (a >= 1e3) return `₹${(v / 1e3).toFixed(1)} K`;
  return `₹${num.format(v)}`;
}

export function formatDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

// Categorical palette from the brand's blue/indigo family, ordered by rank.
export const RANK_COLORS = ['#3d60a5', '#5b7fc4', '#7f9bd3', '#a3b7e0', '#c2d0ec', '#d9e2f5', '#e8eef9', '#f1f4fb'];

export function useChartTheme() {
  const { theme } = useTheme();
  const axisColor = theme === 'dark' ? '#a5b0c2' : '#4b5563';
  const gridColor = theme === 'dark' ? '#27303e' : '#e4e7ec';
  return {
    axisColor,
    gridColor,
    cur: theme === 'dark' ? '#6485c2' : '#3d60a5',
    prev: theme === 'dark' ? '#3a4a6b' : '#c2d0ec',
    tooltipStyle: {
      background: theme === 'dark' ? '#111723' : '#ffffff',
      border: `1px solid ${gridColor}`,
      borderRadius: 10,
      fontSize: 13
    }
  };
}

export function StatusPill({ text }: { text: string | null }) {
  if (!text) return <span className="text-ink-tertiary">—</span>;
  const tone =
    text === 'Ready' || text === 'Dispatched' || text === 'Low' || text === 'Against Delivery'
      ? 'bg-success-bg text-success'
      : text === 'In Production' || text === 'Part Dispatched'
        ? 'bg-info-bg text-info'
        : text === 'Pending' || text === 'Watch'
          ? 'bg-warning-bg text-warning'
          : text === 'High'
            ? 'bg-danger-bg text-danger'
            : 'bg-surface-tertiary text-ink-secondary';
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${tone}`}>{text}</span>;
}

/**
 * Section heading shared by the dashboard and the standalone report pages.
 * With `reportTo` (dashboard) the heading becomes a link into the full report;
 * without it (the report page itself) it is plain text.
 */
export function SectionHeading({ id, title, note, reportTo }: { id: string; title: string; note?: React.ReactNode; reportTo?: string }) {
  const body = (
    <>
      {title}
      {note && <span className="text-ink-tertiary font-normal"> {note}</span>}
    </>
  );
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 id={id} className="text-sm font-semibold text-ink-primary">
        {reportTo ? (
          <Link to={reportTo} className="hover:text-brand-600 dark:hover:text-brand-400">
            {body}
          </Link>
        ) : (
          body
        )}
      </h2>
      {reportTo && (
        <Link to={reportTo} className="text-xs text-brand-600 dark:text-brand-400 inline-flex items-center gap-1 hover:underline">
          Open report <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}

// One shared request for the overview payload: the dashboard mounts several
// sections that all need it, so they reuse a single in-flight/recent fetch
// instead of each calling the API.
let cache: { at: number; promise: Promise<SalesOverview> } | null = null;
const CACHE_MS = 30_000;

function fetchOverview(force: boolean) {
  if (force || !cache || Date.now() - cache.at > CACHE_MS) {
    const promise = getSalesOverview();
    promise.catch(() => {
      if (cache?.promise === promise) cache = null;
    });
    cache = { at: Date.now(), promise };
  }
  return cache.promise;
}

export function useSalesOverview() {
  const [data, setData] = useState<SalesOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { tick, markUpdated } = useSalesRefresh();
  const seenTick = useRef(tick);

  function load(force: boolean, silent = false) {
    if (!silent) setLoading(true);
    setError(null);
    fetchOverview(force)
      .then((d) => {
        setData(d);
        markUpdated();
      })
      .catch((err) => setError(err?.response?.data?.message || err.message || 'Unable to load the sales overview.'))
      .finally(() => setLoading(false));
  }
  // A refresh tick always bypasses the 30-second shared cache and updates in place.
  useEffect(() => {
    const refreshed = seenTick.current !== tick;
    seenTick.current = tick;
    load(refreshed, refreshed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  return { data, loading, error, reload: () => load(true) };
}
