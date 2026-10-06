import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { getOpenSalesOrdersBoard } from '../../api/sales';
import type { OpenSalesOrders } from '../../types';
import { ErrorState } from '../StateViews';
import { Skeleton } from '../ui/Skeleton';
import { SectionHeading, StatusPill, compactInr, formatDate, num } from './salesShared';
import { useSalesRefresh } from './salesRefresh';

const FILTERS: { key: string; label: string; count: (b: OpenSalesOrders) => number | null }[] = [
  { key: 'all', label: 'All', count: (b) => b.totalOpen },
  { key: 'production', label: 'In Production', count: (b) => b.inProduction },
  { key: 'ready', label: 'Ready', count: (b) => b.ready },
  { key: 'pending', label: 'Pending', count: (b) => b.pending },
  { key: 'part', label: 'Part Dispatched', count: (b) => b.partDispatched }
];

/** Open sales orders board. `pageSize` is small on the dashboard and larger on the report page. */
export default function OpenOrdersSection({ reportTo, pageSize = 8 }: { reportTo?: string; pageSize?: number }) {
  const [board, setBoard] = useState<OpenSalesOrders | null>(null);
  const [boardLoading, setBoardLoading] = useState(true);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [boardReload, setBoardReload] = useState(0);
  const { tick, markUpdated } = useSalesRefresh();
  const seenTick = useRef(tick);

  // Debounce the search box so we don't hit the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    // A refresh tick updates data in place; filter/page changes still show the skeleton.
    const silent = seenTick.current !== tick;
    seenTick.current = tick;
    if (!silent) setBoardLoading(true);
    setBoardError(null);
    getOpenSalesOrdersBoard({ filter, search: query || undefined, page, pageSize: pageSize })
      .then((d) => {
        setBoard(d);
        markUpdated();
      })
      .catch((err) => setBoardError(err?.response?.data?.message || err.message || 'Unable to load open sales orders.'))
      .finally(() => setBoardLoading(false));
  }, [filter, query, page, boardReload, tick]);

  const totalPages = board ? Math.max(1, Math.ceil(board.totalCount / pageSize)) : 1;

  return (
  <section aria-labelledby="oso-h" className="space-y-3">
    <SectionHeading id="oso-h" title="Open Sales Orders" note={board && <>{board.totalOpen} open · {compactInr(board.totalValue)}</>} reportTo={reportTo} />
    <div className="card p-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-border">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Order filter">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => {
                setFilter(f.key);
                setPage(1);
              }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                filter === f.key ? 'bg-brand-600 text-white border-brand-600' : 'bg-surface text-ink-secondary border-border-strong hover:bg-surface-tertiary'
              }`}
            >
              {f.label}
              {board ? ` (${f.count(board)})` : ''}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-tertiary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order, customer, item"
            aria-label="Search open sales orders"
            className="pl-8 pr-3 py-2 text-sm rounded-lg border border-border-strong bg-surface text-ink-primary w-64 max-w-full"
          />
        </div>
      </div>

      {boardError ? (
        <ErrorState message={boardError} onRetry={() => setBoardReload((n) => n + 1)} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-tertiary border-b border-border">
                <th className="px-4 py-2.5 font-medium">SO Number</th>
                <th className="px-4 py-2.5 font-medium">Customer</th>
                <th className="px-4 py-2.5 font-medium">Item</th>
                <th className="px-4 py-2.5 font-medium text-right">Ordered Qty</th>
                <th className="px-4 py-2.5 font-medium text-right">Pending Qty</th>
                <th className="px-4 py-2.5 font-medium">Production Status</th>
                <th className="px-4 py-2.5 font-medium">Progress</th>
                <th className="px-4 py-2.5 font-medium">ETA</th>
                <th className="px-4 py-2.5 font-medium">Delivery Status</th>
              </tr>
            </thead>
            <tbody>
              {boardLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td colSpan={9} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    </tr>
                  ))
                : board?.rows.map((r) => (
                    <tr key={r.docEntry} className="border-b border-border last:border-0 hover:bg-surface-tertiary/60">
                      <td className="px-4 py-3">
                        <Link to={`/sales/orders/${r.docEntry}`} className="text-brand-600 dark:text-brand-400 font-medium hover:underline">
                          SO/{r.docNum}
                        </Link>
                        <div className="text-xs text-ink-tertiary">{formatDate(r.postingDate)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-ink-primary">{r.customerName ?? r.customerCode}</div>
                        {r.city && <div className="text-xs text-ink-tertiary">{r.city}</div>}
                      </td>
                      <td className="px-4 py-3 text-ink-primary">
                        {r.item ?? '—'}
                        {r.lineCount > 1 && <span className="text-xs text-ink-tertiary"> +{r.lineCount - 1} more</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {num.format(r.orderedQty)} <span className="text-xs text-ink-tertiary">{r.uom ?? ''}</span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{num.format(r.pendingQty)}</td>
                      <td className="px-4 py-3">
                        <StatusPill text={r.productionStatus} />
                      </td>
                      <td className="px-4 py-3 w-36">
                        {r.productionProgress === null ? (
                          <span className="text-ink-tertiary">—</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 rounded bg-surface-tertiary overflow-hidden">
                              <div className="h-full bg-brand-600" style={{ width: `${r.productionProgress}%` }} />
                            </div>
                            <span className="text-xs tabular-nums text-ink-secondary">{r.productionProgress}%</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{formatDate(r.eta)}</td>
                      <td className="px-4 py-3">
                        <StatusPill text={r.deliveryStatus} />
                      </td>
                    </tr>
                  ))}
              {!boardLoading && board?.rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-ink-tertiary">
                    No open sales orders match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {board && board.totalCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-border text-xs text-ink-secondary">
          <span>
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, board.totalCount)} of {board.totalCount} open orders
          </span>
          <div className="flex items-center gap-2">
            <button className="btn-secondary !py-1 !px-3" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span className="tabular-nums">
              {page} / {totalPages}
            </span>
            <button className="btn-secondary !py-1 !px-3" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </div>
      )}
    </div>
    <p className="text-xs text-ink-tertiary">
      Production Status, Progress and ETA come from production orders linked to the sales order and the order's due date; orders with no linked production order show “—”.
    </p>
  </section>
  );
}
