import { useEffect, useState } from 'react';
import { AlertCircle, Ban, FileCheck2, Loader2, Truck, X } from 'lucide-react';
import Modal from '../ui/Modal';
import {
  ErpNextApiError,
  cancelEInvoice,
  cancelEwayBill,
  generateEInvoice,
  generateEwayBill,
  getTransportDefaults,
  type CancelReason,
  type ErpNextComplianceResult,
  type TransportDefaults,
  type TransportMode
} from '../../api/erpnext';

/** The specific reason an action failed — headline plus every detail the server gave. Never a generic message. */
function ErrorBox({ error }: { error: ErpNextApiError }) {
  return (
    <div role="alert" className="rounded-md border border-danger/30 bg-danger-bg text-danger text-sm p-3 flex items-start gap-2">
      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-medium">{error.message}</p>
        {error.details.length > 0 && (
          <ul className="mt-1.5 list-disc pl-5 space-y-1 text-[13px]">
            {error.details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DialogHeader({ id, icon: Icon, title, onClose }: { id: string; icon: typeof Truck; title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-5">
      <h2 id={id} className="flex items-center gap-2 text-lg font-semibold text-ink-primary">
        <Icon className="h-5 w-5 text-brand-600" /> {title}
      </h2>
      <button type="button" onClick={onClose} className="text-ink-tertiary hover:text-ink-primary" aria-label="Close">
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

// ------------------------------------------------------------------------------------------ e-invoice
interface EInvoiceDialogProps {
  open: boolean;
  docEntry: number;
  docNum: number | null;
  /** True when ERPNext still holds the invoice as a draft, so this will submit it first. */
  willSubmit: boolean;
  onClose: () => void;
  onDone: (result: ErpNextComplianceResult) => void;
}

/**
 * Generating an e-invoice registers the invoice with the GST portal, so it needs an explicit confirmation that
 * says exactly what will happen. Failures stay inside the dialog with the full reason, so nothing is lost.
 */
export function EInvoiceDialog({ open, docEntry, docNum, willSubmit, onClose, onDone }: EInvoiceDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErpNextApiError | null>(null);

  useEffect(() => {
    if (open) {
      setBusy(false);
      setError(null);
    }
  }, [open]);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await generateEInvoice(docEntry));
    } catch (e) {
      setError(e instanceof ErpNextApiError ? e : new ErpNextApiError('The e-invoice could not be generated. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={() => !busy && onClose()} labelledBy="einv-title">
      <DialogHeader id="einv-title" icon={FileCheck2} title="Generate e-invoice" onClose={() => !busy && onClose()} />
      <div className="px-5 py-4 space-y-3 text-sm text-ink-secondary overflow-y-auto">
        <p>
          This registers A/R Invoice <strong className="text-ink-primary">#{docNum ?? docEntry}</strong> with the government GST e-invoice portal
          through ERPNext and returns its IRN.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          {willSubmit && (
            <li>
              The invoice is still a draft in ERPNext, so it will be <strong className="text-ink-primary">submitted first</strong>. That posts the accounting
              entries in ERPNext.
            </li>
          )}
          <li>
            An IRN <strong className="text-ink-primary">can only be cancelled within 24 hours</strong>. After that it can no longer be undone.
          </li>
          <li>Nothing is changed in SAP.</li>
        </ul>
        {error && <ErrorBox error={error} />}
      </div>
      <div className="flex justify-end gap-2 px-5 pb-5">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={() => void confirm()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}
          {busy ? 'Generating…' : error ? 'Try again' : 'Generate e-invoice'}
        </button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------ e-way bill
interface EwayBillDialogProps {
  open: boolean;
  docEntry: number;
  onClose: () => void;
  onDone: (result: ErpNextComplianceResult) => void;
}

const MODES: TransportMode[] = ['Road', 'Rail', 'Air', 'Ship'];

export function EwayBillDialog({ open, docEntry, onClose, onDone }: EwayBillDialogProps) {
  const [defaults, setDefaults] = useState<TransportDefaults | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<ErpNextApiError | null>(null);

  const [mode, setMode] = useState<TransportMode>('Road');
  const [vehicleNo, setVehicleNo] = useState('');
  const [vehicleType, setVehicleType] = useState<'Regular' | 'Over Dimensional Cargo (ODC)'>('Regular');
  const [transporterGstin, setTransporterGstin] = useState('');
  const [transporterName, setTransporterName] = useState('');
  const [lrNo, setLrNo] = useState('');
  const [lrDate, setLrDate] = useState('');
  const [distance, setDistance] = useState('0');
  const [agreedToSubmit, setAgreedToSubmit] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErpNextApiError | null>(null);

  // Load the pre-fill (from the SAP invoice's transport fields) every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoadError(null);
    setAgreedToSubmit(false);
    setLoading(true);
    getTransportDefaults(docEntry)
      .then((d) => {
        setDefaults(d);
        setMode(d.mode);
        setVehicleNo(d.vehicleNo ?? '');
        setTransporterName(d.transporterName ?? '');
        setLrNo(d.lrNo ?? '');
        setLrDate(d.lrDate ?? '');
        setDistance(String(d.distance ?? 0));
      })
      .catch((e) => setLoadError(e instanceof ErpNextApiError ? e : new ErpNextApiError('Could not load the transport details.')))
      .finally(() => setLoading(false));
  }, [open, docEntry]);

  const willSubmit = defaults?.willSubmit ?? false;
  const road = mode === 'Road';
  const canSubmit = !busy && !loading && !loadError && (!willSubmit || agreedToSubmit);

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const result = await generateEwayBill(docEntry, {
        confirm: !willSubmit || agreedToSubmit,
        mode,
        vehicleNo: vehicleNo.trim() || undefined,
        vehicleType: road ? vehicleType : undefined,
        transporterGstin: transporterGstin.trim() || undefined,
        transporterName: transporterName.trim() || undefined,
        lrNo: lrNo.trim() || undefined,
        lrDate: lrDate || undefined,
        distance: Number.isFinite(Number(distance)) ? Math.trunc(Number(distance)) : 0
      });
      onDone(result);
    } catch (e) {
      setError(e instanceof ErpNextApiError ? e : new ErpNextApiError('The e-way bill could not be generated. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={() => !busy && onClose()} labelledBy="ewb-title">
      <DialogHeader id="ewb-title" icon={Truck} title="Generate e-way bill" onClose={() => !busy && onClose()} />

      <div className="px-5 py-4 space-y-4 overflow-y-auto">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-ink-secondary">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading transport details…
          </div>
        )}
        {loadError && <ErrorBox error={loadError} />}

        {!loading && !loadError && (
          <>
            <p className="text-sm text-ink-secondary">
              Enter the transport details for the GST portal. Fields filled from the SAP invoice can be changed here; nothing is written back to SAP.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-xs text-ink-tertiary">
                Mode of transport
                <select className="input-field mt-1" value={mode} onChange={(e) => setMode(e.target.value as TransportMode)}>
                  {MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs text-ink-tertiary">
                Distance (km) — 0 = calculate automatically
                <input className="input-field mt-1" type="number" min={0} max={4000} value={distance} onChange={(e) => setDistance(e.target.value)} />
              </label>

              {road && (
                <>
                  <label className="block text-xs text-ink-tertiary">
                    Vehicle number
                    <input
                      className="input-field mt-1 uppercase"
                      value={vehicleNo}
                      onChange={(e) => setVehicleNo(e.target.value.toUpperCase())}
                      placeholder="MH12AB1234"
                      autoComplete="off"
                    />
                  </label>
                  <label className="block text-xs text-ink-tertiary">
                    Vehicle type
                    <select className="input-field mt-1" value={vehicleType} onChange={(e) => setVehicleType(e.target.value as typeof vehicleType)}>
                      <option value="Regular">Regular</option>
                      <option value="Over Dimensional Cargo (ODC)">Over Dimensional Cargo (ODC)</option>
                    </select>
                  </label>
                </>
              )}

              <label className="block text-xs text-ink-tertiary">
                Transporter GSTIN / ID {road ? '(if no vehicle yet)' : ''}
                <input
                  className="input-field mt-1 uppercase"
                  value={transporterGstin}
                  onChange={(e) => setTransporterGstin(e.target.value.toUpperCase())}
                  maxLength={15}
                  autoComplete="off"
                />
              </label>
              <label className="block text-xs text-ink-tertiary">
                Transporter name
                <input className="input-field mt-1" value={transporterName} onChange={(e) => setTransporterName(e.target.value)} autoComplete="off" />
              </label>

              <label className="block text-xs text-ink-tertiary">
                {road ? 'LR / GR number (optional)' : 'Transport document number (RR / AWB / BL)'}
                <input className="input-field mt-1" value={lrNo} onChange={(e) => setLrNo(e.target.value)} autoComplete="off" />
              </label>
              <label className="block text-xs text-ink-tertiary">
                {road ? 'LR / GR date (optional)' : 'Transport document date'}
                <input className="input-field mt-1" type="date" value={lrDate} onChange={(e) => setLrDate(e.target.value)} />
              </label>
            </div>

            {willSubmit && (
              <label className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-bg text-sm p-3 text-ink-primary">
                <input type="checkbox" className="mt-0.5" checked={agreedToSubmit} onChange={(e) => setAgreedToSubmit(e.target.checked)} />
                <span>
                  This invoice is still a <strong>draft</strong> in ERPNext. An e-way bill needs it submitted, which posts the accounting entries in ERPNext.
                  I understand and want to continue.
                </span>
              </label>
            )}
          </>
        )}

        {error && <ErrorBox error={error} />}
      </div>

      <div className="flex justify-end gap-2 px-5 pb-5">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={() => void submit()} disabled={!canSubmit}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
          {busy ? 'Generating…' : error ? 'Try again' : 'Generate e-way bill'}
        </button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------ cancel
export type CancelKind = 'einvoice' | 'ewaybill';

interface CancelDialogProps {
  open: boolean;
  kind: CancelKind;
  docEntry: number;
  docNum: number | null;
  /** When the 24-hour cancellation window ends (ERPNext site local time), if known. */
  cancellableUntil: string | null;
  /** For an e-invoice: true if an e-way bill exists, because it is cancelled together with the IRN. */
  alsoCancelsEwayBill: boolean;
  onClose: () => void;
  onDone: (result: ErpNextComplianceResult) => void;
}

const CANCEL_REASONS: CancelReason[] = ['Duplicate', 'Data Entry Mistake', 'Order Cancelled', 'Others'];

/**
 * Cancelling goes to the GST portal and cannot be undone, so it needs an explicit reason and a confirmation that says what
 * will happen. Failures stay inside the dialog with the full reason.
 */
export function CancelDialog({ open, kind, docEntry, docNum, cancellableUntil, alsoCancelsEwayBill, onClose, onDone }: CancelDialogProps) {
  const [reason, setReason] = useState<CancelReason | ''>('');
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErpNextApiError | null>(null);

  const einvoice = kind === 'einvoice';
  const label = einvoice ? 'e-invoice' : 'e-way bill';

  useEffect(() => {
    if (open) {
      setReason('');
      setRemark('');
      setBusy(false);
      setError(null);
    }
  }, [open]);

  const remarkOk = remark.trim().length <= 100 && (reason !== 'Others' || remark.trim().length > 0);
  const canSubmit = !busy && reason !== '' && remarkOk;

  async function confirm() {
    if (reason === '' || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const request = { confirm: true, reason, remark: remark.trim() || undefined };
      onDone(einvoice ? await cancelEInvoice(docEntry, request) : await cancelEwayBill(docEntry, request));
    } catch (e) {
      setError(e instanceof ErpNextApiError ? e : new ErpNextApiError(`The ${label} could not be cancelled. Please try again.`));
    } finally {
      setBusy(false);
    }
  }

  const until = cancellableUntil ? new Date(cancellableUntil) : null;
  const untilText = until && !Number.isNaN(until.getTime())
    ? new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(until)
    : null;

  return (
    <Modal open={open} onClose={() => !busy && onClose()} labelledBy="cancel-title">
      <DialogHeader id="cancel-title" icon={Ban} title={`Cancel ${label}`} onClose={() => !busy && onClose()} />
      <div className="px-5 py-4 space-y-3 text-sm text-ink-secondary overflow-y-auto">
        <p>
          This cancels the {label} for A/R Invoice <strong className="text-ink-primary">#{docNum ?? docEntry}</strong> on the government GST portal
          through ERPNext.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-ink-primary">This cannot be undone.</strong>
            {untilText ? <> It can only be cancelled until {untilText}.</> : <> It can only be cancelled within 24 hours of being generated.</>}
          </li>
          {einvoice && (
            <li>
              The same invoice number can <strong className="text-ink-primary">never get a new IRN</strong>. To bill again, cancel the invoice in ERPNext and issue a
              new one.
            </li>
          )}
          {einvoice && alsoCancelsEwayBill && <li>The e-way bill on this invoice is cancelled together with the IRN.</li>}
          {!einvoice && <li>A new e-way bill can be generated afterwards.</li>}
          <li>Nothing is changed in SAP.</li>
        </ul>

        <div className="grid grid-cols-1 gap-3 pt-1">
          <label className="block text-xs text-ink-tertiary">
            Reason (required)
            <select className="input-field mt-1" value={reason} onChange={(e) => setReason(e.target.value as CancelReason | '')}>
              <option value="">Choose a reason…</option>
              {CANCEL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-ink-tertiary">
            Remark {reason === 'Others' ? '(required)' : '(optional)'} — sent to the GST portal, max 100 characters
            <input className="input-field mt-1" value={remark} maxLength={100} onChange={(e) => setRemark(e.target.value)} autoComplete="off" />
          </label>
        </div>

        {error && <ErrorBox error={error} />}
      </div>
      <div className="flex justify-end gap-2 px-5 pb-5">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
          Keep it
        </button>
        <button type="button" className="btn-primary !bg-danger hover:!opacity-90" onClick={() => void confirm()} disabled={!canSubmit}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
          {busy ? 'Cancelling…' : error ? 'Try again' : `Cancel ${label}`}
        </button>
      </div>
    </Modal>
  );
}
