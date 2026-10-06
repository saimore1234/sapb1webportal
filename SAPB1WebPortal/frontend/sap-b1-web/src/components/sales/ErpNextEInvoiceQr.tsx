import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { ErpNextApiError, getEInvoiceQr, type EInvoiceQr } from '../../api/erpnext';

/**
 * The e-invoice's signed QR code. ERPNext keeps only the signed QR string (not an image), so the code is drawn here from it.
 * It is always black on white regardless of the portal theme — a QR with inverted colours is not reliably scannable.
 */
export default function ErpNextEInvoiceQr({ docEntry, irn }: { docEntry: number; irn: string }) {
  const [qr, setQr] = useState<EInvoiceQr | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getEInvoiceQr(docEntry)
      .then((q) => !cancelled && setQr(q))
      .catch((e) => !cancelled && setError(e instanceof ErpNextApiError ? e.message : 'Could not load the QR code.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [docEntry, irn]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-secondary">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading QR code…
      </div>
    );
  }
  if (error) {
    return (
      <p className="text-sm text-danger flex items-start gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /> {error}
      </p>
    );
  }
  if (!qr) return <p className="text-sm text-ink-tertiary">No QR code is available for this e-invoice.</p>;

  return (
    <figure className="inline-block">
      <div className="inline-block rounded-lg border border-border bg-white p-2">
        <QRCodeSVG value={qr.signedQrCode} size={160} level="M" marginSize={1} bgColor="#ffffff" fgColor="#000000" title="E-invoice signed QR code" />
      </div>
      <figcaption className="mt-1.5 text-[11px] text-ink-tertiary max-w-[176px]">Signed e-invoice QR code. Scan to verify on the GST portal.</figcaption>
    </figure>
  );
}
