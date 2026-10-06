import { useEffect, useMemo, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getSalesAnalyticsOptions, getSalesAnalyticsReport } from '../../api/sales';
import type { SalesAnalyticsOptions, SalesAnalyticsQuery, SalesAnalyticsReport } from '../../types';
import { ErrorState } from '../StateViews';
import { Skeleton } from '../ui/Skeleton';
import { SectionHeading, compactInr, inr, num, useChartTheme } from './salesShared';
import { fyStartDate, pctChange, toIsoDate } from './salesUtils';
import { useSalesRefresh } from './salesRefresh';

function Delta({ current, previous }: { current: number; previous: number }) {
  const d = pctChange(current, previous);
  if (d === null) return <span className="text-xs text-ink-tertiary">no prior-year data</span>;
  return (
    <span className={`text-xs font-medium ${d >= 0 ? 'text-success' : 'text-danger'}`}>
      {d >= 0 ? '▲' : '▼'} {Math.abs(d).toFixed(1)}% <span className="text-ink-tertiary font-normal">vs same period last year</span>
    </span>
  );
}

/** Slice sales by customer, sales person, item and period; compared with the same period a year earlier. */
export default function AnalyticsSection({ reportTo }: { reportTo?: string }) {
  const { axisColor, gridColor, cur, prev, tooltipStyle } = useChartTheme();
  const defaults = useMemo(() => ({ dateFrom: toIsoDate(fyStartDate()), dateTo: toIsoDate(new Date()) }), []);

  const [draft, setDraft] = useState<SalesAnalyticsQuery>(defaults);
  const [applied, setApplied] = useState<SalesAnalyticsQuery>(defaults);
  const [options, setOptions] = useState<SalesAnalyticsOptions | null>(null);
  const [data, setData] = useState<SalesAnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const { tick, markUpdated } = useSalesRefresh();
  const seenTick = useRef(tick);

  useEffect(() => {
    getSalesAnalyticsOptions().then(setOptions).catch(() => setOptions({ customers: [], salesPersons: [], items: [] }));
  }, []);

  useEffect(() => {
    // A refresh tick updates data in place; filter/page changes still show the skeleton.
    const silent = seenTick.current !== tick;
    seenTick.current = tick;
    if (!silent) setLoading(true);
    setError(null);
    getSalesAnalyticsReport(applied)
      .then((d) => {
        setData(d);
        markUpdated();
      })
      .catch((err) => setError(err?.response?.data?.message || err.message || 'Unable to load sales analytics.'))
      .finally(() => setLoading(false));
  }, [applied, reload, tick]);

  const input = 'px-3 py-2 text-sm rounded-lg border border-border-strong bg-surface text-ink-primary min-w-0';
  const label = 'text-xs text-ink-secondary mb-1 block';
  const set = (patch: Partial<SalesAnalyticsQuery>) => setDraft((d) => ({ ...d, ...patch }));

  const trend = (data?.trend ?? []).map((t) => ({ ...t, label: new Date(`${t.label}-01`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }) }));
  const compare = (rows: SalesAnalyticsReport['customers']) =>
    rows.map((r) => ({ name: r.name ?? r.key, current: r.value, previous: r.previousValue }));

  const comparisonChart = (rows: ReturnType<typeof compare>, title: string) => (
    <div className="card">
      <h3 className="font-semibold text-ink-primary">{title}</h3>
      <p className="text-xs text-ink-tertiary mb-2">This period vs same period last year</p>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-tertiary py-10 text-center">No sales in this selection.</p>
      ) : (
        <ResponsiveContainer width="100%" height={40 + rows.length * 46}>
          <BarChart data={rows} layout="vertical" margin={{ left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={gridColor} />
            <XAxis type="number" tick={{ fontSize: 11, fill: axisColor }} tickFormatter={compactInr} />
            <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: axisColor }} tickFormatter={(n: string) => (n.length > 18 ? `${n.slice(0, 17)}…` : n)} />
            <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: axisColor }} formatter={(v: number) => inr.format(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="previous" name="Last year" fill={prev} radius={[0, 4, 4, 0]} maxBarSize={14} />
            <Bar dataKey="current" name="This period" fill={cur} radius={[0, 4, 4, 0]} maxBarSize={14} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );

  return (
    <section aria-labelledby="ana-h" className="space-y-3">
      <SectionHeading id="ana-h" title="Sales Analytics" note="Net of GST" reportTo={reportTo} />

      <form
        className="card grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end"
        onSubmit={(e) => { e.preventDefault(); setApplied(draft); }}
      >
        <div>
          <label className={label} htmlFor="an-cust">Customer</label>
          <select id="an-cust" className={`${input} w-full`} value={draft.customer ?? ''} onChange={(e) => set({ customer: e.target.value || undefined })}>
            <option value="">All Customers</option>
            {options?.customers.map((c) => <option key={c.key} value={c.key}>{c.name ?? c.key}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="an-sp">Sales Person</label>
          <select id="an-sp" className={`${input} w-full`} value={draft.salesPerson ?? ''} onChange={(e) => set({ salesPerson: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">All Sales Persons</option>
            {options?.salesPersons.map((s) => <option key={s.key} value={s.key}>{s.name ?? s.key}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="an-item">Item</label>
          <select id="an-item" className={`${input} w-full`} value={draft.item ?? ''} onChange={(e) => set({ item: e.target.value || undefined })}>
            <option value="">All Items</option>
            {options?.items.map((i) => <option key={i.key} value={i.key}>{i.name ?? i.key}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="an-from">From</label>
          <input id="an-from" type="date" className={`${input} w-full`} value={draft.dateFrom ?? ''} max={draft.dateTo} onChange={(e) => set({ dateFrom: e.target.value })} />
        </div>
        <div>
          <label className={label} htmlFor="an-to">To</label>
          <input id="an-to" type="date" className={`${input} w-full`} value={draft.dateTo ?? ''} min={draft.dateFrom} onChange={(e) => set({ dateTo: e.target.value })} />
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => { setDraft(defaults); setApplied(defaults); }}>Reset</button>
          <button type="submit" className="btn-primary">Apply</button>
        </div>
      </form>

      {error ? (
        <div className="card"><ErrorState message={error} onRetry={() => setReload((n) => n + 1)} /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {loading || !data ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
            ) : (
              <>
                <div className="card !p-4">
                  <p className="text-xs uppercase tracking-wide text-ink-secondary">Total Quantity</p>
                  <p className="text-2xl font-semibold tabular-nums text-ink-primary mt-1">{num.format(data.quantity)}</p>
                  <Delta current={data.quantity} previous={data.previousQuantity} />
                </div>
                <div className="card !p-4">
                  <p className="text-xs uppercase tracking-wide text-ink-secondary">Average Rate</p>
                  <p className="text-2xl font-semibold tabular-nums text-ink-primary mt-1">{inr.format(data.averageRate)}</p>
                  <Delta current={data.averageRate} previous={data.previousAverageRate} />
                </div>
                <div className="card !p-4">
                  <p className="text-xs uppercase tracking-wide text-ink-secondary">Total Sales Value</p>
                  <p className="text-2xl font-semibold tabular-nums text-ink-primary mt-1">{compactInr(data.value)}</p>
                  <Delta current={data.value} previous={data.previousValue} />
                </div>
              </>
            )}
          </div>

          <div className="card">
            <h3 className="font-semibold text-ink-primary">Sales Trend</h3>
            <p className="text-xs text-ink-tertiary mb-2">Monthly value and quantity for the selected period</p>
            {loading || !data ? (
              <Skeleton className="h-[260px] w-full" />
            ) : trend.length === 0 ? (
              <p className="text-sm text-ink-tertiary py-10 text-center">No sales in this selection.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: axisColor }} />
                  <YAxis yAxisId="v" tick={{ fontSize: 11, fill: axisColor }} tickFormatter={compactInr} width={70} />
                  <YAxis yAxisId="q" orientation="right" tick={{ fontSize: 11, fill: axisColor }} tickFormatter={(v) => num.format(v)} width={60} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: axisColor }} formatter={(v: number, name: string) => (name === 'Quantity' ? num.format(v) : inr.format(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="q" dataKey="quantity" name="Quantity" fill={prev} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Line yAxisId="v" dataKey="value" name="Value" stroke={cur} strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {loading || !data ? (
              <>
                <Skeleton className="h-[280px] w-full" />
                <Skeleton className="h-[280px] w-full" />
              </>
            ) : (
              <>
                {comparisonChart(compare(data.customers), 'Customer-wise Comparison')}
                {comparisonChart(compare(data.items), 'Item-wise Comparison')}
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
