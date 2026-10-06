import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Search } from 'lucide-react';
import { getCustomerLedger, lookupSalesCustomers } from '../../api/sales';
import type { CustomerLedger, CustomerLookup } from '../../types';
import { ErrorState } from '../StateViews';
import { Skeleton } from '../ui/Skeleton';
import { SectionHeading, formatDate, inr } from './salesShared';
import { downloadCsv, fyStartDate, toIsoDate } from './salesUtils';
import { useSalesRefresh } from './salesRefresh';
import { usePermissions } from '../../permissions/usePermissions';

const money = (v: number) => (v ? inr.format(v) : '—');
/** Ledger balances are debit-positive; show Dr/Cr so a credit balance isn't mistaken for zero. */
const bal = (v: number) => `${inr.format(Math.abs(v))} ${v < 0 ? 'Cr' : 'Dr'}`;

/**
 * Customer statement from the journal lines posted to the customer's account.
 * The selected customer lives in the `?customer=` query param so other
 * sections (Outstanding) can deep-link here.
 */
export default function LedgerSection({ reportTo }: { reportTo?: string }) {
  const { canExport } = usePermissions();
  const [params, setParams] = useSearchParams();
  const customer = params.get('customer') ?? '';
  const [from, setFrom] = useState(() => toIsoDate(fyStartDate()));
  const [to, setTo] = useState(() => toIsoDate(new Date()));

  const [term, setTerm] = useState('');
  const [options, setOptions] = useState<CustomerLookup[]>([]);
  const [open, setOpen] = useState(false);

  const [data, setData] = useState<CustomerLedger | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const { tick, markUpdated } = useSalesRefresh();
  const seenTick = useRef(tick);

  // Debounced customer search for the picker.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      lookupSalesCustomers(term).then(setOptions).catch(() => setOptions([]));
    }, 250);
    return () => clearTimeout(t);
  }, [term, open]);

  useEffect(() => {
    if (!customer) {
      setData(null);
      return;
    }
    // A refresh tick updates data in place; filter/page changes still show the skeleton.
    const silent = seenTick.current !== tick;
    seenTick.current = tick;
    if (!silent) setLoading(true);
    setError(null);
    getCustomerLedger({ customer, dateFrom: from, dateTo: to })
      .then((d) => {
        setData(d);
        markUpdated();
      })
      .catch((err) => setError(err?.response?.data?.message || err.message || 'Unable to load the ledger.'))
      .finally(() => setLoading(false));
  }, [customer, from, to, reload, tick]);

  function choose(c: CustomerLookup) {
    const next = new URLSearchParams(params);
    next.set('customer', c.customerCode);
    setParams(next, { replace: true });
    setTerm('');
    setOpen(false);
  }

  function exportCsv() {
    if (!data) return;
    downloadCsv(
      `ledger-${data.customerCode}-${from}-to-${to}.csv`,
      ['Date', 'Document', 'Doc No', 'Particulars', 'Debit', 'Credit', 'Balance (Dr+/Cr-)'],
      [
        ['', '', '', 'Opening Balance', '', '', data.openingBalance],
        ...data.rows.map((r) => [r.date.slice(0, 10), r.docType, r.docNo, r.particulars, r.debit || '', r.credit || '', r.balance]),
        ['', '', '', 'Closing Balance', data.totalDebit, data.totalCredit, data.closingBalance]
      ]
    );
  }

  const input = 'px-3 py-2 text-sm rounded-lg border border-border-strong bg-surface text-ink-primary';
  const utilised = data && data.creditLimit > 0 ? (data.currentBalance / data.creditLimit) * 100 : null;

  return (
    <section aria-labelledby="led-h" className="space-y-3">
      <SectionHeading id="led-h" title="Customer Ledger" note={data ? <>{data.customerName} ({data.customerCode})</> : undefined} reportTo={reportTo} />
      <div className="card p-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 p-4 border-b border-border">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-tertiary" />
            <input
              value={term}
              onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              placeholder={data ? `${data.customerName} — change customer` : 'Search customer by name or code'}
              aria-label="Search customer"
              className={`${input} pl-8 w-72 max-w-full`}
            />
            {open && (
              <ul className="absolute z-10 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-border-strong bg-surface shadow-elevated">
                {options.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-ink-tertiary">No customers found.</li>
                ) : (
                  options.map((o) => (
                    <li key={o.customerCode}>
                      <button className="w-full text-left px-3 py-2 text-sm hover:bg-surface-tertiary" onClick={() => choose(o)}>
                        <span className="text-ink-primary">{o.customerName}</span> <span className="text-xs text-ink-tertiary">{o.customerCode}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From date" className={input} />
          <span className="text-ink-tertiary text-sm">to</span>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To date" className={input} />
          {canExport && (
            <button className="btn-secondary ml-auto" onClick={exportCsv} disabled={!data}>
              <Download className="h-4 w-4" /> Download CSV
            </button>
          )}
        </div>

        {!customer ? (
          <p className="px-4 py-12 text-center text-sm text-ink-tertiary">Choose a customer to see their statement.</p>
        ) : error ? (
          <ErrorState message={error} onRetry={() => setReload((n) => n + 1)} />
        ) : loading || !data ? (
          <div className="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-border text-sm text-ink-secondary">
              <span className="text-ink-primary font-medium">{data.customerName}</span> · {data.customerCode}
              {data.city ? ` · ${data.city}` : ''}
              {data.taxNo ? ` · GSTIN ${data.taxNo}` : ''}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-ink-tertiary border-b border-border">
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 font-medium">Document</th>
                    <th className="px-4 py-2.5 font-medium">Particulars</th>
                    <th className="px-4 py-2.5 font-medium text-right">Debit</th>
                    <th className="px-4 py-2.5 font-medium text-right">Credit</th>
                    <th className="px-4 py-2.5 font-medium text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border bg-surface-tertiary/40">
                    <td className="px-4 py-2.5 text-ink-tertiary">—</td>
                    <td colSpan={2} className="px-4 py-2.5 font-medium">Opening Balance</td>
                    <td /><td />
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">{bal(data.openingBalance)}</td>
                  </tr>
                  {data.rows.map((r, i) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-surface-tertiary/60">
                      <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(r.date)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap"><span className="text-ink-primary">{r.docType}</span>{r.docNo ? <span className="text-ink-tertiary"> #{r.docNo}</span> : null}</td>
                      <td className="px-4 py-2.5">{r.particulars || '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{money(r.debit)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-success">{money(r.credit)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{bal(r.balance)}</td>
                    </tr>
                  ))}
                  {data.rows.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-tertiary">No postings in this period.</td></tr>
                  )}
                  <tr className="border-t border-border-strong bg-surface-tertiary/40 font-semibold">
                    <td colSpan={3} className="px-4 py-2.5">Closing Balance</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{inr.format(data.totalDebit)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{inr.format(data.totalCredit)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{bal(data.closingBalance)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-border text-xs text-ink-secondary">
              {utilised === null
                ? 'No credit limit is set for this customer.'
                : <>Credit limit {inr.format(data.creditLimit)} · Current balance {inr.format(data.currentBalance)} ({utilised.toFixed(1)}% utilised)</>}
              {data.rows.length >= 1000 && ' · Showing the first 1,000 postings; narrow the period to see the rest.'}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
