import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ErrorState } from '../StateViews';
import { DetailSkeleton } from '../ui/Skeleton';
import StatCard from '../StatCard';
import SalesDocumentFlow from './SalesDocumentFlow';
import type { SalesDocumentLine, RelatedDocument } from '../../types';

interface DetailBase {
  docEntry: number;
  docNum: number;
  postingDate: string;
  status: string;
  remarks: string | null;
  currency: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  grandTotal: number;
  lines: SalesDocumentLine[];
  relatedDocuments: RelatedDocument[];
}

interface ExtraField {
  label: string;
  value: string | number | null | undefined;
}

interface ExtraStatCard {
  label: string;
  value: string;
  icon: LucideIcon;
  accent?: 'blue' | 'green' | 'amber' | 'red' | 'slate';
}

interface SalesDocumentDetailProps<T extends DetailBase> {
  documentLabel: string;
  /** Enables the SAP B1 Print button (see api/print.ts). */
  printType?: PrintDocumentType;
  backLabel: string;
  backRoute: string;
  fetchFn: (docEntry: number) => Promise<T>;
  title: (doc: T) => string;
  subtitle?: (doc: T) => string | null | undefined;
  extraFields: (doc: T) => ExtraField[];
  extraStatCards?: (doc: T) => ExtraStatCard[];
  /** Optional extra card(s) shown under the summary — e.g. the ERPNext panel on A/R Invoices. */
  extraSections?: (doc: T) => React.ReactNode;
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

function formatMoney(value: number, currency: string | null) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 2 }).format(value);
  } catch {
    return value.toLocaleString();
  }
}

/** Mirrors components/purchase/PurchaseDocumentDetail.tsx (same premium
 * document layout) but wired to the /sales/* route tree and Sales document
 * lines, which additionally carry Ordered/Delivered quantities on Orders and
 * Deliveries. */
import PrintButton from '../PrintButton';
import type { PrintDocumentType } from '../../api/print';

export default function SalesDocumentDetail<T extends DetailBase>({
  documentLabel,
  printType,
  backLabel,
  backRoute,
  fetchFn,
  title,
  subtitle,
  extraFields,
  extraStatCards,
  extraSections
}: SalesDocumentDetailProps<T>) {
  const { docEntry: docEntryParam = '' } = useParams();
  const docEntry = Number(docEntryParam);
  const [doc, setDoc] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    fetchFn(docEntry)
      .then(setDoc)
      .catch((err) => setError(err?.response?.data?.message || err.message || 'Unable to load sales data.'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [docEntry]);

  if (loading) return <DetailSkeleton />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!doc) return null;

  const statusBadgeClass = doc.status === 'Open' ? 'badge-success' : doc.status === 'Closed' ? 'badge-neutral' : 'badge-warning';
  const currency = doc.currency;
  const hasQtyTracking = doc.lines.some((l) => l.deliveredQuantity != null || l.orderedQuantity != null);

  return (
    <div className="space-y-6 max-w-4xl">
      <Link to={backRoute} className="inline-flex items-center gap-1.5 text-sm text-ink-secondary hover:text-ink-primary">
        <ArrowLeft className="h-4 w-4" />
        {backLabel}
      </Link>

      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-ink-tertiary uppercase tracking-wide mb-1">{documentLabel}</p>
            <h1 className="text-xl font-semibold text-ink-primary">
              {title(doc)} <span className="text-ink-tertiary font-normal">#{doc.docNum}</span>
            </h1>
            {subtitle?.(doc) && <p className="text-ink-tertiary text-sm mt-0.5">{subtitle(doc)}</p>}
          </div>
          <div className="flex items-center gap-2">
            {printType && <PrintButton documentType={printType} docEntry={doc.docEntry} />}
            <span className={statusBadgeClass}>{doc.status}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-6 text-sm">
          <Field label="Posting Date" value={formatDate(doc.postingDate)} />
          {extraFields(doc).map((f) => (
            <Field key={f.label} label={f.label} value={f.value} />
          ))}
          <Field label="Currency" value={currency || '—'} />
        </div>
        {doc.remarks && (
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-ink-tertiary text-xs mb-1">Remarks</p>
            <p className="text-sm text-ink-primary">{doc.remarks}</p>
          </div>
        )}
      </div>

      {extraStatCards && (
        <div className="grid grid-cols-2 gap-4">
          {extraStatCards(doc).map((c) => (
            <StatCard key={c.label} label={c.label} value={c.value} icon={c.icon} accent={c.accent ?? 'blue'} />
          ))}
        </div>
      )}

      {extraSections?.(doc)}

      {doc.lines.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <h2 className="font-semibold text-ink-primary px-5 pt-5 mb-3">Items</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary text-ink-secondary text-left">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Item</th>
                  <th className="px-4 py-2.5 font-medium hidden md:table-cell">Warehouse</th>
                  <th className="px-4 py-2.5 font-medium text-right">Quantity</th>
                  {hasQtyTracking && <th className="px-4 py-2.5 font-medium text-right hidden md:table-cell">Delivered</th>}
                  <th className="px-4 py-2.5 font-medium text-right hidden lg:table-cell">Price</th>
                  <th className="px-4 py-2.5 font-medium hidden lg:table-cell">Tax</th>
                  <th className="px-4 py-2.5 font-medium text-right">Line Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {doc.lines.map((l) => (
                  <tr key={l.lineNum}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-ink-primary">{l.itemName || l.itemCode}</p>
                      <p className="text-ink-tertiary text-xs">{l.itemCode}</p>
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell text-ink-secondary">{l.warehouse || '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {l.quantity.toLocaleString()}
                      {l.openQuantity != null && l.openQuantity !== l.quantity && (
                        <span className="block text-xs text-ink-tertiary">{l.openQuantity.toLocaleString()} open</span>
                      )}
                      {l.orderedQuantity != null && (
                        <span className="block text-xs text-ink-tertiary">{l.orderedQuantity.toLocaleString()} ordered</span>
                      )}
                    </td>
                    {hasQtyTracking && (
                      <td className="px-4 py-2.5 text-right tabular-nums hidden md:table-cell text-ink-secondary">
                        {l.deliveredQuantity != null ? l.deliveredQuantity.toLocaleString() : '—'}
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-right tabular-nums hidden lg:table-cell">{formatMoney(l.price, currency)}</td>
                    <td className="px-4 py-2.5 hidden lg:table-cell text-ink-secondary">{l.taxCode || '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatMoney(l.lineTotal, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-border p-5 flex justify-end">
            <div className="w-full max-w-xs space-y-1.5 text-sm">
              <div className="flex justify-between text-ink-secondary">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatMoney(doc.subtotal, currency)}</span>
              </div>
              {doc.discount !== 0 && (
                <div className="flex justify-between text-ink-secondary">
                  <span>Discount</span>
                  <span className="tabular-nums">-{formatMoney(doc.discount, currency)}</span>
                </div>
              )}
              <div className="flex justify-between text-ink-secondary">
                <span>Tax</span>
                <span className="tabular-nums">{formatMoney(doc.tax, currency)}</span>
              </div>
              <div className="flex justify-between text-base font-semibold text-ink-primary pt-1.5 border-t border-border">
                <span>Grand Total</span>
                <span className="tabular-nums">{formatMoney(doc.grandTotal, currency)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="font-semibold text-ink-primary mb-4">Document Flow</h2>
        <SalesDocumentFlow currentLabel={documentLabel} currentDocNum={doc.docNum} related={doc.relatedDocuments} />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <p className="text-ink-tertiary text-xs mb-0.5">{label}</p>
      <p className="font-medium text-ink-primary text-sm">{value ?? '—'}</p>
    </div>
  );
}
