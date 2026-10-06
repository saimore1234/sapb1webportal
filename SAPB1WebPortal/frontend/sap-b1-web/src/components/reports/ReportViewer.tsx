import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Download, Printer, Star } from 'lucide-react';
import SearchBar from '../SearchBar';
import { ErrorState, EmptyState } from '../StateViews';
import { TableSkeleton } from '../ui/Skeleton';
import ResponsiveTable from '../ui/ResponsiveTable';
import type { ReportDataSource } from '../../data/reportDataSources';
import { exportRowsToCsv } from '../../utils/csvExport';
import { usePermissions } from '../../permissions/usePermissions';

interface ReportViewerProps<T extends Record<string, unknown>> {
  title: string;
  description: string;
  dataSource: ReportDataSource<T>;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}

export default function ReportViewer<T extends Record<string, unknown>>({
  title,
  description,
  dataSource,
  isFavorite,
  onToggleFavorite
}: ReportViewerProps<T>) {
  const { canExport } = usePermissions();
  const [rows, setRows] = useState<T[] | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    dataSource
      .fetch()
      .then((data) => {
        setRows(data);
        setLastUpdated(new Date());
      })
      .catch((err) => setError(err?.response?.data?.message || err.message || 'Unable to load report.'))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [dataSource]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((row) => Object.values(row).some((v) => v != null && String(v).toLowerCase().includes(q)));
  }, [rows, search]);

  function handleExport() {
    if (!rows) return;
    exportRowsToCsv(
      filtered,
      dataSource.columns.map((c) => ({ key: c.key, header: c.header, value: (row: T) => String((row as Record<string, unknown>)[c.key] ?? '') })),
      title
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-ink-primary">{title}</h1>
            <button onClick={onToggleFavorite} aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}>
              <Star className={`h-4 w-4 ${isFavorite ? 'fill-amber-400 text-amber-400' : 'text-ink-tertiary'}`} />
            </button>
          </div>
          <p className="text-sm text-ink-secondary mt-0.5">{description}</p>
          {lastUpdated && <p className="text-xs text-ink-tertiary mt-1">Last updated: {lastUpdated.toLocaleTimeString()}</p>}
        </div>
        <div className="flex gap-2 flex-wrap items-center shrink-0">
          <SearchBar value={search} onChange={setSearch} placeholder="Search this report…" />
          <button className="btn-secondary" onClick={load} aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
          </button>
          {canExport && (
            <button className="btn-secondary" onClick={handleExport} disabled={!rows || rows.length === 0}>
              <Download className="h-4 w-4" />
              Export
            </button>
          )}
          <button className="btn-secondary" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Print
          </button>
        </div>
      </div>

      {dataSource.summary && rows && rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {dataSource.summary(rows).map((s) => (
            <div key={s.label} className="card py-3">
              <p className="text-xs text-ink-tertiary uppercase tracking-wide">{s.label}</p>
              <p className="text-lg font-semibold text-ink-primary tabular-nums mt-0.5">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        {loading && <TableSkeleton cols={dataSource.columns.length} />}
        {!loading && error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && filtered.length === 0 && (
          <EmptyState message="No Data Found" description="No records match the selected filters." />
        )}
        {!loading && !error && filtered.length > 0 && (
          <ResponsiveTable
            columns={dataSource.columns}
            rows={filtered}
            keyField={(_, i) => String(i)}
            renderMobileCard={(row) => (
              <div className="px-4 py-3.5 space-y-1">
                {dataSource.columns.map((c) => (
                  <div key={c.key} className="flex items-center justify-between text-sm">
                    <span className="text-ink-tertiary">{c.header}</span>
                    <span className="text-ink-primary font-medium">{c.render(row)}</span>
                  </div>
                ))}
              </div>
            )}
          />
        )}
      </div>
    </div>
  );
}
