import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import { getSuppliers } from '../api/suppliers';
import type { SupplierListItem, PagedResult } from '../types';
import SearchBar from '../components/SearchBar';
import Pagination from '../components/Pagination';
import StatusBadge from '../components/StatusBadge';
import Avatar from '../components/ui/Avatar';
import { ErrorState, EmptyState } from '../components/StateViews';
import { TableSkeleton } from '../components/ui/Skeleton';
import ResponsiveTable, { type ColumnDef } from '../components/ui/ResponsiveTable';
import { useToast } from '../context/ToastContext';
import { usePermissions } from '../permissions/usePermissions';

export default function Suppliers() {
  const { canExport } = usePermissions();
  const navigate = useNavigate();
  const { show } = useToast();
  const [result, setResult] = useState<PagedResult<SupplierListItem> | null>(null);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    getSuppliers({
      page,
      pageSize: 20,
      search: search || undefined,
      active: activeFilter === 'all' ? undefined : activeFilter === 'active'
    })
      .then(setResult)
      .catch((err) => setError(err?.response?.data?.message || err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [page, activeFilter]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      load();
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function exportCsv() {
    if (!result || result.items.length === 0) return;
    const header = ['Vendor Code', 'Name', 'Group', 'Phone', 'Balance', 'Status'];
    const rows = result.items.map((s) => [s.cardCode, s.cardName, s.groupName ?? '', s.phone ?? '', s.balance, s.active ? 'Active' : 'Inactive']);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'suppliers.csv';
    a.click();
    URL.revokeObjectURL(url);
    show({ variant: 'success', title: 'Export ready', description: `${result.items.length} suppliers exported (current page).` });
  }

  const columns: ColumnDef<SupplierListItem>[] = [
    {
      key: 'name',
      header: 'Supplier',
      render: (s) => (
        <div className="flex items-center gap-3">
          <Avatar name={s.cardName || s.cardCode} size="sm" />
          <div className="min-w-0">
            <p className="font-medium text-ink-primary truncate">{s.cardName || '—'}</p>
            <p className="text-ink-tertiary text-xs">{s.cardCode}</p>
          </div>
        </div>
      )
    },
    { key: 'group', header: 'Group', render: (s) => s.groupName || '—', className: 'hidden md:table-cell text-ink-secondary' },
    { key: 'phone', header: 'Phone', render: (s) => s.phone || '—', className: 'hidden lg:table-cell text-ink-secondary' },
    { key: 'balance', header: 'Balance', align: 'right', render: (s) => <span className="tabular-nums">{s.balance.toLocaleString()}</span> },
    { key: 'status', header: 'Status', render: (s) => <StatusBadge active={s.active} /> }
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">Suppliers</h1>
          {result && <p className="text-sm text-ink-secondary mt-0.5">{result.totalCount.toLocaleString()} total suppliers</p>}
        </div>
        <div className="flex gap-2 flex-wrap">
          <SearchBar value={search} onChange={setSearch} placeholder="Vendor code, name, GSTIN…" />
          <select className="input-field w-auto" value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          {canExport && (
            <button className="btn-secondary" onClick={exportCsv} disabled={!result || result.items.length === 0}>
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Export</span>
            </button>
          )}
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        {loading && <TableSkeleton />}
        {!loading && error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && result && result.items.length === 0 && (
          <EmptyState message="No suppliers match your filters." description="Try a different search term or clear the status filter." />
        )}

        {!loading && !error && result && result.items.length > 0 && (
          <>
            <ResponsiveTable
              columns={columns}
              rows={result.items}
              keyField={(s) => s.cardCode}
              onRowClick={(s) => navigate(`/suppliers/${s.cardCode}`)}
              renderMobileCard={(s) => (
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <Avatar name={s.cardName || s.cardCode} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink-primary truncate">{s.cardName || '—'}</p>
                    <p className="text-ink-tertiary text-xs">{s.cardCode}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium tabular-nums text-ink-primary">{s.balance.toLocaleString()}</p>
                    <div className="mt-1">
                      <StatusBadge active={s.active} />
                    </div>
                  </div>
                </div>
              )}
            />
            <Pagination page={result.page} totalPages={result.totalPages} onPageChange={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
