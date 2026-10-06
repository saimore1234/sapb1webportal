import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import PurchaseDocumentList from '../../components/purchase/PurchaseDocumentList';
import { getPurchaseRequests } from '../../api/purchase';
import { usePermissions } from '../../permissions/usePermissions';
import type { PurchaseRequest } from '../../types';
import type { ColumnDef } from '../../components/ui/ResponsiveTable';

function formatDate(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

const columns: ColumnDef<PurchaseRequest>[] = [
  { key: 'docNum', header: 'Request #', render: (r) => <span className="font-medium text-brand-600 dark:text-brand-400">#{r.docNum}</span> },
  { key: 'requester', header: 'Requester', render: (r) => r.requester || '—', className: 'text-ink-secondary' },
  { key: 'postingDate', header: 'Posting Date', render: (r) => formatDate(r.postingDate), className: 'hidden md:table-cell text-ink-secondary' },
  { key: 'requiredDate', header: 'Required Date', render: (r) => formatDate(r.requiredDate), className: 'hidden lg:table-cell text-ink-secondary' },
  { key: 'status', header: 'Status', render: (r) => <span className={r.status === 'Open' ? 'badge-success' : 'badge-neutral'}>{r.status}</span> },
  { key: 'total', header: 'Total', align: 'right', render: (r) => <span className="tabular-nums">{r.total.toLocaleString()}</span> }
];

export default function PurchaseRequests() {
  const { canCreate } = usePermissions();

  return (
    <PurchaseDocumentList
      title="Purchase Requests"
      fetchFn={getPurchaseRequests}
      columns={columns}
      keyField={(r) => String(r.docEntry)}
      docEntryField={(r) => r.docEntry}
      routeBase="/purchase/requests"
      searchPlaceholder="Request #, requester…"
      filterFields={['date', 'status']}
      emptyMessage="No purchase requests found."
      headerAction={
        canCreate ? (
          <Link to="/purchase/requests/new" className="btn-primary text-sm py-2 px-3.5">
            <Plus className="h-4 w-4" />
            Create Purchase Request
          </Link>
        ) : undefined
      }
      renderMobileCard={(r) => (
        <div className="flex items-center justify-between px-4 py-3.5">
          <div className="min-w-0">
            <p className="font-medium text-ink-primary">Request #{r.docNum}</p>
            <p className="text-ink-tertiary text-xs">{r.requester || '—'} · {formatDate(r.postingDate)}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-medium tabular-nums text-ink-primary">{r.total.toLocaleString()}</p>
            <span className={r.status === 'Open' ? 'badge-success' : 'badge-neutral'}>{r.status}</span>
          </div>
        </div>
      )}
    />
  );
}
