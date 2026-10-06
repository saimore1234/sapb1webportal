import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Package } from 'lucide-react';
import { getItems } from '../api/items';
import type { ItemListItem, PagedResult } from '../types';
import SearchBar from '../components/SearchBar';
import Pagination from '../components/Pagination';
import StatusBadge from '../components/StatusBadge';
import { ErrorState, EmptyState } from '../components/StateViews';
import { TableSkeleton } from '../components/ui/Skeleton';
import ResponsiveTable, { type ColumnDef } from '../components/ui/ResponsiveTable';
import { useToast } from '../context/ToastContext';
import { usePermissions } from '../permissions/usePermissions';

export default function Items() {
  const { canExport } = usePermissions();
  const navigate = useNavigate();
  const { show } = useToast();
  const [result, setResult] = useState<PagedResult<ItemListItem> | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    getItems({ page, pageSize: 20, search: search || undefined })
      .then(setResult)
      .catch((err) => setError(err?.response?.data?.message || err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [page]);

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
    const header = ['Item Code', 'Name', 'Group', 'UoM', 'On Hand', 'Available', 'Status'];
    const rows = result.items.map((i) => [
      i.itemCode,
      i.itemName,
      i.itemGroup ?? '',
      i.inventoryUom ?? '',
      i.onHand,
      i.available,
      i.active ? 'Active' : 'Inactive'
    ]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'items.csv';
    a.click();
    URL.revokeObjectURL(url);
    show({ variant: 'success', title: 'Export ready', description: `${result.items.length} items exported (current page).` });
  }

  const columns: ColumnDef<ItemListItem>[] = [
    {
      key: 'name',
      header: 'Item',
      render: (i) => (
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-surface-tertiary text-ink-tertiary flex items-center justify-center shrink-0">
            <Package className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-ink-primary truncate">{i.itemName || '—'}</p>
            <p className="text-ink-tertiary text-xs">{i.itemCode}</p>
          </div>
        </div>
      )
    },
    { key: 'group', header: 'Group', render: (i) => i.itemGroup || '—', className: 'hidden md:table-cell text-ink-secondary' },
    { key: 'uom', header: 'UoM', render: (i) => i.inventoryUom || '—', className: 'hidden lg:table-cell text-ink-secondary' },
    { key: 'onHand', header: 'On Hand', align: 'right', render: (i) => <span className="tabular-nums">{i.onHand.toLocaleString()}</span> },
    { key: 'available', header: 'Available', align: 'right', render: (i) => <span className="tabular-nums">{i.available.toLocaleString()}</span> },
    { key: 'status', header: 'Status', render: (i) => <StatusBadge active={i.active} /> }
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">Items</h1>
          {result && <p className="text-sm text-ink-secondary mt-0.5">{result.totalCount.toLocaleString()} total items</p>}
        </div>
        <div className="flex gap-2 flex-wrap">
          <SearchBar value={search} onChange={setSearch} placeholder="Item code, name, barcode…" />
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
          <EmptyState message="No items match your search." description="Try a different item code, name, or barcode." />
        )}

        {!loading && !error && result && result.items.length > 0 && (
          <>
            <ResponsiveTable
              columns={columns}
              rows={result.items}
              keyField={(i) => i.itemCode}
              onRowClick={(i) => navigate(`/items/${i.itemCode}`)}
              renderMobileCard={(i) => (
                <div className="flex items-center gap-3 px-4 py-3.5">
                  <div className="h-9 w-9 rounded-lg bg-surface-tertiary text-ink-tertiary flex items-center justify-center shrink-0">
                    <Package className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink-primary truncate">{i.itemName || '—'}</p>
                    <p className="text-ink-tertiary text-xs">{i.itemCode}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium tabular-nums text-ink-primary">{i.available.toLocaleString()} avail.</p>
                    <div className="mt-1">
                      <StatusBadge active={i.active} />
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
