import { useEffect, useRef, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { getInvoiceRegister } from '../../api/sales';
import type { InvoiceRegister } from '../../types';
import { ErrorState } from '../StateViews';
import { Skeleton } from '../ui/Skeleton';
import { SectionHeading, StatusPill, formatDate, inr, num } from './salesShared';
import { downloadCsv, fyStartDate, toIsoDate } from './salesUtils';
import { useSalesRefresh } from './salesRefresh';
import { usePermissions } from '../../permissions/usePermissions';

/** A/R invoices for a period, with search, dispatch filter and CSV export. */
export default function InvoiceRegisterSection({ reportTo, pageSize = 7 }: { reportTo?: string; pageSize?: number }) {
  const { canExport } = usePermissions();
  const [from, setFrom] = useState(() => toIsoDate(fyStartDate()));
  const [to, setTo] = useState(() => toIsoDate(new Date()));
  const [dispatch, setDispatch] = useState<'all' | 'delivery' | 'direct'>('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<InvoiceRegister | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { tick, markUpdated } = useSalesRefresh();
  const seenTick = useRef(tick);

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
    if (!silent) setLoading(true);
    setError(null);
    getInvoiceRegister({ dateFrom: from, dateTo: to, dispatch, search: query || undefined, page, pageSize })
      .then((d) => {
        setData(d);
        markUpdated();
      })
      .catch((err) => setError(err?.response?.data?.message || err.message || 'Unable to load the invoice register.'))
      .finally(() => setLoading(false));
  }, [from, to, dispatch, query, page, pageSize, reload, tick]);

  const totalPages = data ? Math.max(1, Math.ceil(data.totalCount / pageSize)) : 1;
  const pageTotal = (data?.rows ?? []).reduce((s, r) => s + r.value, 0);

  async function exportCsv() {
    const all = await getInvoiceRegister({ dateFrom: from, dateTo: to, dispatch, search: query || undefined, page: 1, pageSize: 5000 });
    downloadCsv(
      `invoice-register-${from}-to-${to}.csv`,
      ['Invoice No', 'Date', 'Customer Code', 'Customer', 'Item', 'Quantity', 'Rate', 'Value (incl. GST)', 'Dispatch Status'],
      all.rows.map((r) => [r.docNum, r.docDate.slice(0, 10), r.customerCode, r.customerName, r.item, r.quantity, r.rate, r.value, r.dispatchStatus])
    );
  }

  const input = 'px-3 py-2 text-sm rounded-lg border border-border-strong bg-surface text-ink-primary';

  return (
    <section aria-labelledby="inv-h" className="space-y-3">
      <SectionHeading id="inv-h" title="Invoice Register" note={data ? <>{data.totalCount} invoices · {inr.format(data.totalValue)}</> : undefined} reportTo={reportTo} />
      <div className="card p-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 p-4 border-b border-border">
          <input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPage(1); }} aria-label="From date" className={input} />
          <span className="text-ink-tertiary text-sm">to</span>
          <input type="date" value={to} min={from} onChange={(e) => { setTo(e.target.value); setPage(1); }} aria-label="To date" className={input} />
          <select value={dispatch} onChange={(e) => { setDispatch(e.target.value as typeof dispatch); setPage(1); }} aria-label="Dispatch filter" className={input}>
            <option value="all">Dispatch: All</option>
            <option value="delivery">Against Delivery</option>
            <option value="direct">Direct Invoice</option>
          </select>
          <div className="relative ml-auto">
            <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-tertiary" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Invoice no. or customer" aria-label="Search invoices" className={`${input} pl-8 w-56`} />
          </div>
          {canExport && (
            <button className="btn-secondary" onClick={exportCsv} disabled={!data || data.totalCount === 0}>
              <Download className="h-4 w-4" /> Download CSV
            </button>
          )}
        </div>

        {error ? (
          <ErrorState message={error} onRetry={() => setReload((n) => n + 1)} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-tertiary border-b border-border">
                  <th className="px-4 py-2.5 font-medium">Invoice No.</th>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  <th className="px-4 py-2.5 font-medium">Item</th>
                  <th className="px-4 py-2.5 font-medium text-right">Qty</th>
                  <th className="px-4 py-2.5 font-medium text-right">Rate</th>
                  <th className="px-4 py-2.5 font-medium text-right">Value (incl. GST)</th>
                  <th className="px-4 py-2.5 font-medium">Dispatch</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td colSpan={8} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                      </tr>
                    ))
                  : data?.rows.map((r) => (
                      <tr key={r.docEntry} className="border-b border-border last:border-0 hover:bg-surface-tertiary/60">
                        <td className="px-4 py-3 font-medium text-brand-600 dark:text-brand-400 whitespace-nowrap">INV/{r.docNum}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{formatDate(r.docDate)}</td>
                        <td className="px-4 py-3 text-ink-primary">{r.customerName ?? r.customerCode}</td>
                        <td className="px-4 py-3">
                          {r.item ?? '—'}
                          {r.lineCount > 1 && <span className="text-xs text-ink-tertiary"> +{r.lineCount - 1} more</span>}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{num.format(r.quantity)} <span className="text-xs text-ink-tertiary">{r.uom ?? ''}</span></td>
                        <td className="px-4 py-3 text-right tabular-nums">{r.lineCount > 1 ? 'avg ' : ''}{inr.format(r.rate)}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium">{inr.format(r.value)}</td>
                        <td className="px-4 py-3"><StatusPill text={r.dispatchStatus} /></td>
                      </tr>
                    ))}
                {!loading && data?.rows.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-ink-tertiary">No invoices match.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {data && data.totalCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-border text-xs text-ink-secondary">
            <span>
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, data.totalCount)} of {data.totalCount} · Page total <strong className="text-ink-primary">{inr.format(pageTotal)}</strong>
            </span>
            <div className="flex items-center gap-2">
              <button className="btn-secondary !py-1 !px-3" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
              <span className="tabular-nums">{page} / {totalPages}</span>
              <button className="btn-secondary !py-1 !px-3" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          </div>
        )}
      </div>
      <p className="text-xs text-ink-tertiary">
        “Against Delivery” means the invoice was created from a delivery. Transporter, LR number and e-Way bill are not stored in standard SAP tables and are not shown.
      </p>
    </section>
  );
}
