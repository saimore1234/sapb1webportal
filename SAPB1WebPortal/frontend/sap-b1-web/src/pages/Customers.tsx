import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import { getCustomers } from '../api/customers';
import type { CustomerListItem, PagedResult } from '../types';
import SearchBar from '../components/SearchBar';
import Pagination from '../components/Pagination';
import StatusBadge from '../components/StatusBadge';
import Avatar from '../components/ui/Avatar';
import { ErrorState, EmptyState } from '../components/StateViews';
import { TableSkeleton } from '../components/ui/Skeleton';
import ResponsiveTable, { type ColumnDef } from '../components/ui/ResponsiveTable';
import { useToast } from '../context/ToastContext';
import { usePermissions } from '../permissions/usePermissions';

export default function Customers() {
  const { canExport } = usePermissions();
  const navigate = useNavigate();
  const { show } = useToast();
  const [result, setResult] = useState<PagedResult<CustomerListItem> | null>(null);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    getCustomers({
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
    const header = ['Card Code', 'Name', 'Group', 'Mobile', 'Sales Employee', 'Balance', 'Status'];
    const rows = result.items.map((c) => [
      c.cardCode,
      c.cardName,
      c.groupName ?? '',
      c.mobile ?? '',
      c.salesEmployee ?? '',
      c.balance,
      c.active ? 'Active' : 'Inactive'
    ]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'customers.csv';
    a.click();
    URL.revokeObjectURL(url);
    show({ variant: 'success', title: 'Export ready', description: `${result.items.length} customers exported (current page).` });
  }

  const columns: ColumnDef<CustomerListItem>[] = [
    {
      key: 'name',
      header: 'Customer',
      render: (c) => (
        <div className="flex items-center gap-3">
          <Avatar name={c.cardName || c.cardCode} size="sm" />
          <div className="min-w-0">
            <p className="font-medium text-ink-primary truncate">{c.cardName || '—'}</p>
            <p className="text-ink-tertiary text-xs">{c.cardCode}</p>
          </div>
        </div>
      )
    },
    { key: 'group', header: 'Group', render: (c) => c.groupName || '—', className: 'hidden md:table-cell text-ink-secondary' },
    { key: 'mobile', header: 'Mobile', render: (c) => c.mobile || '—', className: 'hidden lg:table-cell text-ink-secondary' },
    {
      key: 'salesEmployee',
      header: 'Sales Employee',
      render: (c) => c.salesEmployee || '—',
      className: 'hidden lg:table-cell text-ink-secondary'
    },
    { key: 'balance', header: 'Balance', align: 'right', render: (c) => <span className="tabular-nums">{c.balance.toLocaleString()}</span> },
    { key: 'status', header: 'Status', render: (c) => <StatusBadge active={c.active} /> }
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">Customers</h1>
          {result && <p className="text-sm text-ink-secondary mt-0.5">{result.totalCount.toLocaleString()} total customers</p>}
        </div>
        <div className="flex gap-2 flex-wrap">
          <SearchBar value={search} onChange={setSearch} placeholder="Card code, name, mobile, GSTIN…" />
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
          <EmptyState message="No customers match your filters." description="Try a different search term or clear the status filter." />
        )}

        {!loading && !error && result && result.items.length > 0 && (
          <>
            <ResponsiveTable
              columns={columns}
              rows={result.items}
              keyField={(c) => c.cardCode}
              onRowClick={(c) => navigate(`/customers/${c.cardCode}`)}
              renderMobileCard={(c) => (
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <Avatar name={c.cardName || c.cardCode} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink-primary truncate">{c.cardName || '—'}</p>
                    <p className="text-ink-tertiary text-xs">{c.cardCode}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium tabular-nums text-ink-primary">{c.balance.toLocaleString()}</p>
                    <div className="mt-1">
                      <StatusBadge active={c.active} />
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

