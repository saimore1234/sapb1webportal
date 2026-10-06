import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getCustomerOutstanding } from '../../api/sales';
import type { CustomerOutstanding } from '../../types';
import { ErrorState } from '../StateViews';
import { Skeleton } from '../ui/Skeleton';
import { SectionHeading, StatusPill, compactInr, inr, useChartTheme } from './salesShared';
import { salesReportPath } from '../../data/salesReports';
import { useSalesRefresh } from './salesRefresh';

const BUCKET_COLORS = ['#3d60a5', '#7f9bd3', '#e09f3e', '#c0392b'];

/** Receivables aged from posting date against 60-day credit terms, plus per-customer risk. */
export default function OutstandingSection({ reportTo }: { reportTo?: string }) {
  const { axisColor, gridColor, tooltipStyle } = useChartTheme();
  const [data, setData] = useState<CustomerOutstanding | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { tick, markUpdated } = useSalesRefresh();
  const seenTick = useRef(tick);

  function load(silent = false) {
    if (!silent) setLoading(true);
    setError(null);
    getCustomerOutstanding()
      .then((d) => {
        setData(d);
        markUpdated();
      })
      .catch((err) => setError(err?.response?.data?.message || err.message || 'Unable to load customer outstanding.'))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    const refreshed = seenTick.current !== tick;
    seenTick.current = tick;
    load(refreshed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  if (error) return <div className="card"><ErrorState message={error} onRetry={() => load()} /></div>;

  const pct = (part: number) => (data && data.total ? ((part / data.total) * 100).toFixed(1) : '0.0');
  const cell = (v: number) => (v ? compactInr(v) : '—');

  return (
    <section aria-labelledby="out-h" className="space-y-3">
      <SectionHeading
        id="out-h"
        title="Customer Outstanding"
        note={data ? <>as on {new Date(data.asOf).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} · credit terms {data.creditTermsDays} days</> : undefined}
        reportTo={reportTo}
      />
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
        <div className="xl:col-span-2 space-y-4">
          {loading || !data ? (
            <Skeleton className="h-[300px] w-full" />
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3 gap-3">
                <div className="card !p-4">
                  <p className="text-xs text-ink-secondary">Total Outstanding</p>
                  <p className="text-xl font-semibold tabular-nums text-ink-primary mt-1">{compactInr(data.total)}</p>
                  <p className="text-xs text-ink-tertiary mt-1">across {data.customerCount} customers</p>
                </div>
                <div className="card !p-4">
                  <p className="text-xs text-ink-secondary">Current (≤ {data.creditTermsDays} days)</p>
                  <p className="text-xl font-semibold tabular-nums text-success mt-1">{compactInr(data.current)}</p>
                  <p className="text-xs text-ink-tertiary mt-1">{pct(data.current)}% of total</p>
                </div>
                <div className="card !p-4">
                  <p className="text-xs text-ink-secondary">Overdue (&gt; {data.creditTermsDays} days)</p>
                  <p className="text-xl font-semibold tabular-nums text-danger mt-1">{compactInr(data.overdue)}</p>
                  <p className="text-xs text-ink-tertiary mt-1">{pct(data.overdue)}% · {data.overdueCustomerCount} customers</p>
                </div>
              </div>
              <div className="card">
                <h3 className="font-semibold text-ink-primary">Ageing Debtors</h3>
                <p className="text-xs text-ink-tertiary mb-2">Days since invoice date</p>
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={data.buckets}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: axisColor }} />
                    <YAxis tick={{ fontSize: 11, fill: axisColor }} tickFormatter={compactInr} width={70} />
                    <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: axisColor }} formatter={(v: number) => inr.format(v)} />
                    <Bar dataKey="value" name="Outstanding" radius={[6, 6, 0, 0]} maxBarSize={56}>
                      {data.buckets.map((_, i) => <Cell key={i} fill={BUCKET_COLORS[i]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>

        <div className="card p-0 overflow-hidden xl:col-span-3">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="font-semibold text-ink-primary">Customer-wise Ageing</h3>
            <p className="text-xs text-ink-tertiary">Top 15 outstanding accounts · select a customer for the ledger</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-tertiary border-b border-border">
                  <th className="px-4 py-2.5 font-medium">Customer</th>
                  <th className="px-3 py-2.5 font-medium text-right">0–30</th>
                  <th className="px-3 py-2.5 font-medium text-right">31–60</th>
                  <th className="px-3 py-2.5 font-medium text-right">61–90</th>
                  <th className="px-3 py-2.5 font-medium text-right">90+</th>
                  <th className="px-3 py-2.5 font-medium text-right">Total</th>
                  <th className="px-4 py-2.5 font-medium">Risk</th>
                </tr>
              </thead>
              <tbody>
                {loading || !data
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i} className="border-b border-border last:border-0"><td colSpan={7} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td></tr>
                    ))
                  : data.customers.map((c) => (
                      <tr key={c.customerCode} className="border-b border-border last:border-0 hover:bg-surface-tertiary/60">
                        <td className="px-4 py-3">
                          <Link to={`${salesReportPath('customer-ledger')}?customer=${encodeURIComponent(c.customerCode)}`} className="text-ink-primary font-medium hover:text-brand-600 dark:hover:text-brand-400">
                            {c.customerName ?? c.customerCode}
                          </Link>
                          {c.salesPerson && <div className="text-xs text-ink-tertiary">{c.salesPerson}</div>}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{cell(c.days0To30)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{cell(c.days31To60)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-warning">{cell(c.days61To90)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-danger">{cell(c.days90Plus)}</td>
                        <td className="px-3 py-3 text-right tabular-nums font-medium">{compactInr(c.total)}</td>
                        <td className="px-4 py-3"><StatusPill text={c.risk} /></td>
                      </tr>
                    ))}
                {!loading && data?.customers.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-ink-tertiary">No outstanding invoices.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <p className="text-xs text-ink-tertiary">Risk is High when 25% or more of a customer's balance is older than {data?.creditTermsDays ?? 60} days, Watch when any is, otherwise Low.</p>
    </section>
  );
}
