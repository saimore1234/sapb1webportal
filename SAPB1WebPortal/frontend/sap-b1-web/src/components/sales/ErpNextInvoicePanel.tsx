import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Ban, CheckCircle2, Copy, ExternalLink, FileCheck2, Loader2, RefreshCw, Truck, UploadCloud } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  ErpNextApiError,
  getErpNextStatus,
  pushToErpNext,
  refreshErpNextStatus,
  type ErpNextComplianceResult,
  type ErpNextLinkStatus
} from '../../api/erpnext';
import { CancelDialog, EInvoiceDialog, EwayBillDialog } from './ErpNextComplianceDialogs';
import ErpNextEInvoiceQr from './ErpNextEInvoiceQr';

function formatMoney(value: number | null, currency: string | null) {
  if (value === null || value === undefined) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 2 }).format(value);
  } catch {
    return value.toLocaleString();
  }
}

function formatDateTime(value: string | null) {
  if (!value) return '—';
  // The API sends UTC without a zone suffix on some paths; treat it as UTC either way.
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(d.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
}

/** Acknowledgement and e-way bill times come back in the ERPNext site's local time: show them as given, no zone shift. */
function formatSiteTime(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
}

/** True while the 24-hour cancellation window is open (or its end is unknown). The server enforces the real limit. */
function windowOpen(until: string | null) {
  if (!until) return true;
  const t = new Date(until).getTime();
  return Number.isNaN(t) || t > Date.now();
}

const STATE_BADGE: Record<ErpNextLinkStatus['status'], { label: string; className: string }> = {
  NotPushed: { label: 'Not pushed', className: 'badge-neutral' },
  Pushing: { label: 'Pushing…', className: 'badge-info' },
  Pushed: { label: 'Pushed', className: 'badge-success' },
  Failed: { label: 'Last push failed', className: 'badge-danger' }
};

/**
 * ERPNext panel for the A/R Invoice screen: shows whether this invoice has been pushed, links to the draft
 * Sales Invoice in ERPNext, shows how ERPNext's totals reconcile with SAP, and holds the Push button.
 *
 * Push only ever creates a DRAFT in ERPNext (never submitted) and is safe to click again — a second push
 * returns the existing ERPNext invoice. Any failure is shown here with its specific reason; nothing fails silently.
 */
export default function ErpNextInvoicePanel({ docEntry, docNum, currency }: { docEntry: number; docNum: number; currency: string | null }) {
  const { can } = useAuth();
  const toast = useToast();

  const [status, setStatus] = useState<ErpNextLinkStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ErpNextApiError | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState<ErpNextApiError | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [einvOpen, setEinvOpen] = useState(false);
  const [ewbOpen, setEwbOpen] = useState(false);
  const [cancelEinvOpen, setCancelEinvOpen] = useState(false);
  const [cancelEwbOpen, setCancelEwbOpen] = useState(false);

  const canView = can('ErpNext.View');
  const canPush = can('ErpNext.Push');
  const canEInvoice = can('ErpNext.EInvoice');
  const canEwayBill = can('ErpNext.EwayBill');
  const canCancel = can('ErpNext.Cancel');

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    getErpNextStatus(docEntry)
      .then(setStatus)
      .catch((e) => setLoadError(e instanceof ErpNextApiError ? e : new ErpNextApiError('Could not load the ERPNext status.')))
      .finally(() => setLoading(false));
  }, [docEntry]);

  useEffect(() => {
    if (canView) load();
    else setLoading(false);
  }, [canView, load]);

  async function push() {
    if (pushing) return;
    setPushing(true);
    setPushError(null);
    try {
      const result = await pushToErpNext(docEntry);
      toast.show({
        variant: result.reconStatus === 'Mismatch' ? 'warning' : 'success',
        title:
          result.outcome === 'AlreadyPushed'
            ? `Already in ERPNext as ${result.invoiceName}`
            : result.outcome === 'Adopted'
              ? `Linked to existing ERPNext invoice ${result.invoiceName}`
              : `Draft invoice ${result.invoiceName} created in ERPNext`,
        description: result.reconStatus === 'Mismatch' ? 'ERPNext totals differ from SAP — see the reconciliation below.' : undefined
      });
      load();
    } catch (e) {
      const err = e instanceof ErpNextApiError ? e : new ErpNextApiError('The push failed unexpectedly. Please try again.');
      setPushError(err);
      toast.show({ variant: 'error', title: 'Push to ERPNext failed', description: err.message });
      load(); // pick up the 'Failed' state / last error recorded server-side
    } finally {
      setPushing(false);
    }
  }

  /** Re-reads the invoice from ERPNext (status, IRN, e-way bill), unlike the first load which only reads the portal's own record. */
  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setLoadError(null);
    try {
      setStatus(await refreshErpNextStatus(docEntry));
    } catch (e) {
      setLoadError(e instanceof ErpNextApiError ? e : new ErpNextApiError('Could not refresh from ERPNext.'));
    } finally {
      setRefreshing(false);
    }
  }

  function onEInvoiceDone(result: ErpNextComplianceResult) {
    setStatus(result.status);
    setEinvOpen(false);
    toast.show({
      variant: 'success',
      title: result.outcome === 'AlreadyGenerated' ? 'E-invoice already exists' : 'E-invoice generated',
      description: result.status.irn ? `IRN ${result.status.irn}` : undefined
    });
  }

  function onEwayBillDone(result: ErpNextComplianceResult) {
    setStatus(result.status);
    setEwbOpen(false);
    toast.show({
      variant: 'success',
      title: result.outcome === 'AlreadyGenerated' ? 'E-way bill already exists' : 'E-way bill generated',
      description: result.status.ewbNo ? `E-way bill ${result.status.ewbNo}` : undefined
    });
  }

  function onCancelDone(result: ErpNextComplianceResult, what: string) {
    setStatus(result.status);
    setCancelEinvOpen(false);
    setCancelEwbOpen(false);
    toast.show({ variant: 'success', title: what + ' cancelled' });
  }

  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(
      () => toast.show({ variant: 'info', title: 'Copied' }),
      () => undefined
    );
  }

  if (!canView) return null;

  const pushed = status?.status === 'Pushed';
  const badge = status ? STATE_BADGE[status.status] : null;
  const busy = pushing || loading || refreshing;
  const einvCancelled = status?.eInvoiceStatus === 'Cancelled';
  const einvDone = status?.eInvoiceStatus === 'Generated' || status?.eInvoiceStatus === 'Generating' || status?.eInvoiceStatus === 'Cancelling' || einvCancelled;
  const ewbDone = status?.ewbStatus === 'Generated' || status?.ewbStatus === 'Generating' || status?.ewbStatus === 'Cancelling';

  return (
    <div className="card" aria-busy={busy}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-ink-tertiary uppercase tracking-wide mb-1">ERPNext</p>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-ink-primary">Sales Invoice in ERPNext</h2>
            {badge && <span className={badge.className}>{badge.label}</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canPush && (
            <button type="button" className="btn-primary" onClick={() => void push()} disabled={busy || pushed}>
              {pushing ? <Loader2 className="h-4 w-4 animate-spin" /> : pushed ? <CheckCircle2 className="h-4 w-4" /> : <UploadCloud className="h-4 w-4" />}
              {pushing ? 'Pushing…' : pushed ? 'Pushed to ERPNext' : status?.status === 'Failed' || pushError ? 'Retry push' : 'Push to ERPNext'}
            </button>
          )}
          {canEInvoice && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setEinvOpen(true)}
              disabled={busy || !pushed || einvDone}
              title={!pushed ? 'Push the invoice to ERPNext first' : einvCancelled ? 'A cancelled IRN cannot be generated again for this invoice number' : einvDone ? 'An e-invoice already exists' : undefined}
            >
              <FileCheck2 className="h-4 w-4" />
              {status?.eInvoiceStatus === 'Generated' ? 'E-invoice generated' : einvCancelled ? 'E-invoice cancelled' : status?.eInvoiceStatus === 'Failed' ? 'Retry e-invoice' : 'Generate e-invoice'}
            </button>
          )}
          {canEwayBill && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setEwbOpen(true)}
              disabled={busy || !pushed || ewbDone}
              title={!pushed ? 'Push the invoice to ERPNext first' : ewbDone ? 'An e-way bill already exists' : undefined}
            >
              <Truck className="h-4 w-4" />
              {status?.ewbStatus === 'Generated' ? 'E-way bill generated' : status?.ewbStatus === 'Failed' ? 'Retry e-way bill' : 'Generate e-way bill'}
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={() => void refresh()} disabled={busy} aria-label="Refresh from ERPNext">
            <RefreshCw className={`h-4 w-4 ${loading || refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* A push that was just attempted and failed: the specific reason, never a generic message. */}
      {pushError && (
        <div role="alert" className="mt-4 rounded-md border border-danger/30 bg-danger-bg text-danger text-sm p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-medium">{pushError.message}</p>
            {pushError.details.length > 0 && (
              <ul className="mt-1.5 list-disc pl-5 space-y-1 text-[13px]">
                {pushError.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs opacity-80">Nothing was submitted in ERPNext. Fix the cause above and use Retry push.</p>
          </div>
        </div>
      )}

      {loadError && (
        <div role="alert" className="mt-4 rounded-md border border-danger/30 bg-danger-bg text-danger text-sm p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <p className="flex-1">{loadError.message}</p>
        </div>
      )}

      {loading && !status && !loadError && (
        <div className="mt-4 flex items-center gap-2 text-sm text-ink-secondary">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking ERPNext status…
        </div>
      )}

      {status && !loadError && (
        <div className="mt-4">
          {status.status === 'NotPushed' && !pushError && (
            <p className="text-sm text-ink-secondary">
              This invoice has not been sent to ERPNext. Pushing creates a <strong className="font-medium text-ink-primary">draft</strong> Sales Invoice
              there (and the customer, addresses and item if they are missing). Nothing is submitted and nothing is changed in SAP.
            </p>
          )}

          {status.status === 'Pushing' && (
            <p className="text-sm text-ink-secondary">A push of this invoice is in progress. Use Refresh in a moment.</p>
          )}

          {status.status === 'Failed' && !pushError && (
            <div role="alert" className="rounded-md border border-danger/30 bg-danger-bg text-danger text-sm p-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-medium">The last push of this invoice failed.</p>
                {status.lastError && <p className="mt-1">{status.lastError}</p>}
              </div>
            </div>
          )}

          {pushed && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-ink-tertiary text-xs mb-0.5">ERPNext invoice</p>
                  {status.invoiceUrl ? (
                    <a
                      href={status.invoiceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-brand-700 dark:text-brand-300 inline-flex items-center gap-1 hover:underline break-all"
                    >
                      {status.invoiceName} <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    </a>
                  ) : (
                    <p className="font-medium text-ink-primary">{status.invoiceName}</p>
                  )}
                </div>
                <div>
                  <p className="text-ink-tertiary text-xs mb-0.5">ERPNext status</p>
                  <p className="font-medium text-ink-primary">{status.erpNextDocStatus ?? '—'}</p>
                </div>
                <div>
                  <p className="text-ink-tertiary text-xs mb-0.5">Pushed</p>
                  <p className="font-medium text-ink-primary">
                    {formatDateTime(status.pushedAtUtc)}
                    {status.pushedBy ? <span className="text-ink-tertiary font-normal"> · {status.pushedBy}</span> : null}
                  </p>
                </div>
                <div>
                  <p className="text-ink-tertiary text-xs mb-0.5">SAP total</p>
                  <p className="font-medium text-ink-primary tabular-nums">{formatMoney(status.sapTotal, currency)}</p>
                </div>
                <div>
                  <p className="text-ink-tertiary text-xs mb-0.5">ERPNext total</p>
                  <p className="font-medium text-ink-primary tabular-nums">{formatMoney(status.erpNextGrandTotal, currency)}</p>
                </div>
                <div>
                  <p className="text-ink-tertiary text-xs mb-0.5">Reconciliation</p>
                  {status.reconStatus ? (
                    <span className={status.reconStatus === 'Match' ? 'badge-success' : 'badge-warning'}>
                      {status.reconStatus === 'Match' ? 'Matches SAP' : 'Differs from SAP'}
                    </span>
                  ) : (
                    <p className="font-medium text-ink-primary">—</p>
                  )}
                </div>
              </div>

              {status.reconDetail && (
                <p className={`text-xs ${status.reconStatus === 'Mismatch' ? 'text-warning' : 'text-ink-tertiary'}`}>{status.reconDetail}</p>
              )}

              {/* E-invoice: active */}
              {status.irn && status.eInvoiceStatus !== 'Cancelled' && (
                <div className="border-t border-border pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-ink-primary">E-invoice</h3>
                      <span className={status.eInvoiceStatus === 'Cancelling' ? 'badge-warning' : 'badge-success'}>
                        {status.eInvoiceStatus === 'Cancelling' ? 'Cancelling…' : 'Generated'}
                      </span>
                    </div>
                    {canCancel && status.eInvoiceStatus === 'Generated' &&
                      (windowOpen(status.eInvoiceCancellableUntil) ? (
                        <button type="button" className="btn-secondary text-danger" onClick={() => setCancelEinvOpen(true)} disabled={busy}>
                          <Ban className="h-4 w-4" /> Cancel e-invoice
                        </button>
                      ) : (
                        <span className="text-xs text-ink-tertiary">The 24-hour cancellation window has passed.</span>
                      ))}
                  </div>
                  <div className="flex flex-col sm:flex-row gap-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm flex-1 min-w-0">
                      <div className="sm:col-span-2">
                        <p className="text-ink-tertiary text-xs mb-0.5">IRN</p>
                        <p className="font-mono text-[13px] text-ink-primary break-all inline-flex items-start gap-2">
                          {status.irn}
                          <button type="button" onClick={() => copy(status.irn!)} className="text-ink-tertiary hover:text-ink-primary shrink-0" aria-label="Copy IRN">
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </p>
                      </div>
                      <div>
                        <p className="text-ink-tertiary text-xs mb-0.5">Acknowledgement no.</p>
                        <p className="font-medium text-ink-primary">{status.ackNo ?? '—'}</p>
                      </div>
                      <div>
                        <p className="text-ink-tertiary text-xs mb-0.5">Acknowledged on</p>
                        <p className="font-medium text-ink-primary">{formatSiteTime(status.ackDate)}</p>
                      </div>
                      {status.eInvoiceStatus === 'Generated' && status.eInvoiceCancellableUntil && windowOpen(status.eInvoiceCancellableUntil) && (
                        <div className="sm:col-span-2">
                          <p className="text-ink-tertiary text-xs mb-0.5">Can be cancelled until</p>
                          <p className="font-medium text-ink-primary">{formatSiteTime(status.eInvoiceCancellableUntil)}</p>
                        </div>
                      )}
                    </div>
                    {status.eInvoiceStatus === 'Generated' && <ErpNextEInvoiceQr docEntry={docEntry} irn={status.irn} />}
                  </div>
                </div>
              )}

              {/* E-invoice: cancelled */}
              {status.eInvoiceStatus === 'Cancelled' && (
                <div className="border-t border-border pt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-sm font-semibold text-ink-primary">E-invoice</h3>
                    <span className="badge-danger">Cancelled</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                    {status.irn && (
                      <div className="sm:col-span-3">
                        <p className="text-ink-tertiary text-xs mb-0.5">IRN (cancelled)</p>
                        <p className="font-mono text-[13px] text-ink-tertiary line-through break-all">{status.irn}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-ink-tertiary text-xs mb-0.5">Cancelled</p>
                      <p className="font-medium text-ink-primary">
                        {formatDateTime(status.eInvoiceCancelledAtUtc)}
                        {status.eInvoiceCancelledBy ? <span className="text-ink-tertiary font-normal"> · {status.eInvoiceCancelledBy}</span> : null}
                      </p>
                    </div>
                    <div className="sm:col-span-2">
                      <p className="text-ink-tertiary text-xs mb-0.5">Reason</p>
                      <p className="font-medium text-ink-primary">{status.eInvoiceCancelReason ?? '—'}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-ink-tertiary">
                    A cancelled IRN cannot be generated again for this invoice number. To bill again, cancel the invoice in ERPNext and issue a new one.
                  </p>
                </div>
              )}

              {/* E-way bill: active */}
              {status.ewbNo && status.ewbStatus !== 'Cancelled' && (
                <div className="border-t border-border pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-ink-primary">E-way bill</h3>
                      <span className={status.ewbStatus === 'Cancelling' ? 'badge-warning' : 'badge-success'}>
                        {status.ewbStatus === 'Cancelling' ? 'Cancelling…' : 'Generated'}
                      </span>
                    </div>
                    {canCancel && status.ewbStatus === 'Generated' &&
                      (windowOpen(status.ewbCancellableUntil) ? (
                        <button type="button" className="btn-secondary text-danger" onClick={() => setCancelEwbOpen(true)} disabled={busy}>
                          <Ban className="h-4 w-4" /> Cancel e-way bill
                        </button>
                      ) : (
                        <span className="text-xs text-ink-tertiary">The 24-hour cancellation window has passed.</span>
                      ))}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-ink-tertiary text-xs mb-0.5">E-way bill no.</p>
                      <p className="font-medium text-ink-primary tabular-nums">{status.ewbNo}</p>
                    </div>
                    <div>
                      <p className="text-ink-tertiary text-xs mb-0.5">Generated on</p>
                      <p className="font-medium text-ink-primary">{formatSiteTime(status.ewbDate)}</p>
                    </div>
                    <div>
                      <p className="text-ink-tertiary text-xs mb-0.5">Valid until</p>
                      <p className="font-medium text-ink-primary">{formatSiteTime(status.ewbValidUpto)}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* E-way bill: cancelled */}
              {status.ewbStatus === 'Cancelled' && (
                <div className="border-t border-border pt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-sm font-semibold text-ink-primary">E-way bill</h3>
                    <span className="badge-danger">Cancelled</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                    {status.ewbNo && (
                      <div>
                        <p className="text-ink-tertiary text-xs mb-0.5">E-way bill no. (cancelled)</p>
                        <p className="font-medium text-ink-tertiary tabular-nums line-through">{status.ewbNo}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-ink-tertiary text-xs mb-0.5">Cancelled</p>
                      <p className="font-medium text-ink-primary">
                        {formatDateTime(status.ewbCancelledAtUtc)}
                        {status.ewbCancelledBy ? <span className="text-ink-tertiary font-normal"> · {status.ewbCancelledBy}</span> : null}
                      </p>
                    </div>
                    <div>
                      <p className="text-ink-tertiary text-xs mb-0.5">Reason</p>
                      <p className="font-medium text-ink-primary">{status.ewbCancelReason ?? '—'}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-ink-tertiary">A new e-way bill can be generated for this invoice.</p>
                </div>
              )}
            </div>
          )}

          {/* A failed attempt recorded on the server, with its reason. A failed CANCELLATION leaves the status Generated with an error. */}
          {pushed && status.eInvoiceError && (status.eInvoiceStatus === 'Failed' || status.eInvoiceStatus === 'Generated') && (
            <div role="alert" className="mt-4 rounded-md border border-danger/30 bg-danger-bg text-danger text-sm p-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-medium">
                  {status.eInvoiceStatus === 'Failed' ? 'The last e-invoice attempt failed.' : 'The last attempt to cancel the e-invoice failed. The e-invoice is still active.'}
                </p>
                <p className="mt-1">{status.eInvoiceError}</p>
              </div>
            </div>
          )}
          {pushed && status.ewbError && (status.ewbStatus === 'Failed' || status.ewbStatus === 'Generated') && (
            <div role="alert" className="mt-4 rounded-md border border-danger/30 bg-danger-bg text-danger text-sm p-3 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-medium">
                  {status.ewbStatus === 'Failed' ? 'The last e-way bill attempt failed.' : 'The last attempt to cancel the e-way bill failed. The e-way bill is still active.'}
                </p>
                <p className="mt-1">{status.ewbError}</p>
              </div>
            </div>
          )}
        </div>
      )}

      <EInvoiceDialog
        open={einvOpen}
        docEntry={docEntry}
        docNum={docNum}
        willSubmit={status?.erpNextDocStatus === 'Draft' || status?.erpNextDocStatus == null}
        onClose={() => setEinvOpen(false)}
        onDone={onEInvoiceDone}
      />
      <EwayBillDialog open={ewbOpen} docEntry={docEntry} onClose={() => setEwbOpen(false)} onDone={onEwayBillDone} />
      <CancelDialog
        open={cancelEinvOpen}
        kind="einvoice"
        docEntry={docEntry}
        docNum={docNum}
        cancellableUntil={status?.eInvoiceCancellableUntil ?? null}
        alsoCancelsEwayBill={status?.ewbStatus === 'Generated'}
        onClose={() => setCancelEinvOpen(false)}
        onDone={(r) => onCancelDone(r, 'E-invoice')}
      />
      <CancelDialog
        open={cancelEwbOpen}
        kind="ewaybill"
        docEntry={docEntry}
        docNum={docNum}
        cancellableUntil={status?.ewbCancellableUntil ?? null}
        alsoCancelsEwayBill={false}
        onClose={() => setCancelEwbOpen(false)}
        onDone={(r) => onCancelDone(r, 'E-way bill')}
      />
    </div>
  );
}
