import { apiClient } from './client';
import type { ApiResponse } from '../types';

// ERPNext integration. The company (and therefore the ERPNext site and credentials) is always resolved
// server-side from the JWT — nothing here ever sends a company, URL or credential.

export type ErpNextLinkState = 'NotPushed' | 'Pushing' | 'Pushed' | 'Failed';

export interface ErpNextLinkStatus {
  docEntry: number;
  status: ErpNextLinkState;
  invoiceName: string | null;
  erpNextDocStatus: string | null;
  invoiceUrl: string | null;
  sapTotal: number | null;
  erpNextGrandTotal: number | null;
  reconStatus: 'Match' | 'Mismatch' | null;
  reconDetail: string | null;
  pushedAtUtc: string | null;
  pushedBy: string | null;
  lastError: string | null;

  // E-invoice (IRN). acknowledgement / e-way bill dates are the ERPNext site's local time, not UTC.
  irn: string | null;
  ackNo: string | null;
  ackDate: string | null;
  eInvoiceStatus: 'Generating' | 'Generated' | 'Failed' | 'Cancelling' | 'Cancelled' | null;
  eInvoiceError: string | null;
  eInvoiceBy: string | null;

  // E-way bill.
  ewbNo: string | null;
  ewbDate: string | null;
  ewbValidUpto: string | null;
  ewbStatus: 'Generating' | 'Generated' | 'Failed' | 'Cancelling' | 'Cancelled' | null;
  ewbError: string | null;
  ewbBy: string | null;

  // Cancellations ("Reason: remark"). Cancellable-until is 24 hours after generation, in the ERPNext site's local time.
  eInvoiceCancelledAtUtc: string | null;
  eInvoiceCancelReason: string | null;
  eInvoiceCancelledBy: string | null;
  ewbCancelledAtUtc: string | null;
  ewbCancelReason: string | null;
  ewbCancelledBy: string | null;
  eInvoiceCancellableUntil: string | null;
  ewbCancellableUntil: string | null;
}

export type CancelReason = 'Duplicate' | 'Data Entry Mistake' | 'Order Cancelled' | 'Others';

export interface CancelRequest {
  confirm: boolean;
  reason: CancelReason;
  /** Optional note for the GST portal, max 100 characters (required when the reason is Others). */
  remark?: string;
}

export interface EInvoiceQr {
  irn: string;
  /** The signed QR string; the portal draws the code from it. */
  signedQrCode: string;
}

export interface ErpNextComplianceResult {
  /** 'Generated' | 'AlreadyGenerated' */
  outcome: string;
  status: ErpNextLinkStatus;
}

export type TransportMode = 'Road' | 'Rail' | 'Air' | 'Ship';

export interface EwayBillRequest {
  /** Needed when the invoice is still a draft in ERPNext: the e-way bill needs it submitted. */
  confirm: boolean;
  mode: TransportMode;
  vehicleNo?: string;
  vehicleType?: 'Regular' | 'Over Dimensional Cargo (ODC)';
  transporterGstin?: string;
  transporterName?: string;
  lrNo?: string;
  /** yyyy-MM-dd */
  lrDate?: string;
  /** km; 0 lets the GST portal work it out from the pincodes. */
  distance: number;
}

export interface TransportDefaults {
  mode: TransportMode;
  vehicleNo: string | null;
  transporterName: string | null;
  lrNo: string | null;
  lrDate: string | null;
  distance: number;
  /** True when ERPNext still holds the invoice as a draft, so generating will submit it first. */
  willSubmit: boolean;
}

export type ErpNextPushOutcome = 'Created' | 'AlreadyPushed' | 'Adopted' | 'Blocked' | 'InProgress';

export interface ErpNextPushResult {
  docEntry: number;
  docNum: number;
  outcome: ErpNextPushOutcome;
  problems: string[];
  invoiceName: string | null;
  erpNextDocStatus: string | null;
  invoiceUrl: string | null;
  sapTotal: number | null;
  erpNextGrandTotal: number | null;
  reconStatus: 'Match' | 'Mismatch' | null;
  reconDetail: string | null;
  pushedAtUtc: string | null;
}

/**
 * A failed ERPNext call, already turned into something a person can act on.
 * `message` is the headline; `details` is a list of specific causes (e.g. the validation
 * problems that blocked the push) and may be empty.
 */
export class ErpNextApiError extends Error {
  constructor(
    message: string,
    public details: string[] = [],
    public status?: number
  ) {
    super(message);
  }
}

function toApiError(err: any, action: string): ErpNextApiError {
  const status: number | undefined = err?.response?.status;
  const body = err?.response?.data as Partial<ApiResponse<unknown>> | undefined;
  const serverMessage = typeof body?.message === 'string' && body.message.trim() ? body.message.trim() : null;
  const details = Array.isArray(body?.errors) ? body!.errors!.filter((e): e is string => typeof e === 'string' && !!e) : [];

  if (!err?.response) {
    return new ErpNextApiError(`Could not reach the portal server to ${action}. Check your connection and try again.`);
  }

  switch (status) {
    case 400:
      // Validation problems (nothing was sent to ERPNext) or ERPNext not configured for this company.
      return new ErpNextApiError(serverMessage ?? `The request to ${action} was not valid.`, details, status);
    case 403:
      return new ErpNextApiError(`You do not have permission to ${action}. Ask an administrator for the ERPNext permission.`, [], status);
    case 404:
      return new ErpNextApiError(serverMessage ?? 'This invoice was not found.', [], status);
    case 409:
      return new ErpNextApiError(serverMessage ?? 'Another push of this invoice is already running. Try again in a moment.', [], status);
    case 502:
      // ERPNext itself rejected the call or could not be reached; the message carries ERPNext's reason.
      return new ErpNextApiError(serverMessage ?? 'ERPNext could not be reached or rejected the request.', details, status);
    default:
      return new ErpNextApiError(
        serverMessage ?? `The portal server could not ${action} (error ${status ?? 'unknown'}). Please try again or contact support.`,
        details,
        status
      );
  }
}

/** What the link table says about this A/R invoice. Does not call ERPNext. */
export async function getErpNextStatus(docEntry: number): Promise<ErpNextLinkStatus> {
  try {
    const { data } = await apiClient.get<ApiResponse<ErpNextLinkStatus>>(`/erpnext/invoices/${docEntry}`);
    if (!data.success || !data.data) throw new ErpNextApiError(data.message ?? 'Could not load the ERPNext status.');
    return data.data;
  } catch (err) {
    if (err instanceof ErpNextApiError) throw err;
    throw toApiError(err, 'load the ERPNext status');
  }
}

/** Creates (or finds) the DRAFT Sales Invoice in ERPNext. Safe to repeat. */
export async function pushToErpNext(docEntry: number): Promise<ErpNextPushResult> {
  try {
    const { data } = await apiClient.post<ApiResponse<ErpNextPushResult>>(`/erpnext/invoices/${docEntry}/push`);
    if (!data.success || !data.data) throw new ErpNextApiError(data.message ?? 'The push did not complete.', data.errors ?? []);
    return data.data;
  } catch (err) {
    if (err instanceof ErpNextApiError) throw err;
    throw toApiError(err, 'push this invoice to ERPNext');
  }
}

/** Re-reads the invoice from ERPNext (status, IRN, acknowledgement, e-way bill) and returns the updated link. */
export async function refreshErpNextStatus(docEntry: number): Promise<ErpNextLinkStatus> {
  try {
    const { data } = await apiClient.post<ApiResponse<ErpNextLinkStatus>>(`/erpnext/invoices/${docEntry}/refresh`);
    if (!data.success || !data.data) throw new ErpNextApiError(data.message ?? 'Could not refresh from ERPNext.', data.errors ?? []);
    return data.data;
  } catch (err) {
    if (err instanceof ErpNextApiError) throw err;
    throw toApiError(err, 'refresh the status from ERPNext');
  }
}

/**
 * Registers the invoice with the GST e-invoice portal through ERPNext (submitting the draft first if needed).
 * NOT reversible after 24 hours — the caller must have asked the user to confirm.
 */
export async function generateEInvoice(docEntry: number): Promise<ErpNextComplianceResult> {
  try {
    const { data } = await apiClient.post<ApiResponse<ErpNextComplianceResult>>(`/erpnext/invoices/${docEntry}/e-invoice`, { confirm: true });
    if (!data.success || !data.data) throw new ErpNextApiError(data.message ?? 'The e-invoice was not generated.', data.errors ?? []);
    return data.data;
  } catch (err) {
    if (err instanceof ErpNextApiError) throw err;
    throw toApiError(err, 'generate the e-invoice');
  }
}

export async function generateEwayBill(docEntry: number, request: EwayBillRequest): Promise<ErpNextComplianceResult> {
  try {
    const { data } = await apiClient.post<ApiResponse<ErpNextComplianceResult>>(`/erpnext/invoices/${docEntry}/e-waybill`, request);
    if (!data.success || !data.data) throw new ErpNextApiError(data.message ?? 'The e-way bill was not generated.', data.errors ?? []);
    return data.data;
  } catch (err) {
    if (err instanceof ErpNextApiError) throw err;
    throw toApiError(err, 'generate the e-way bill');
  }
}

/** Pre-fill for the e-way bill form, from the transport fields on the SAP invoice. */
export async function getTransportDefaults(docEntry: number): Promise<TransportDefaults> {
  try {
    const { data } = await apiClient.get<ApiResponse<TransportDefaults>>(`/erpnext/invoices/${docEntry}/transport-defaults`);
    if (!data.success || !data.data) throw new ErpNextApiError(data.message ?? 'Could not load the transport details.', data.errors ?? []);
    return data.data;
  } catch (err) {
    if (err instanceof ErpNextApiError) throw err;
    throw toApiError(err, 'load the transport details');
  }
}

/**
 * Cancels the IRN on the GST portal through ERPNext — and, as India Compliance does, any e-way bill with it. Only possible within
 * 24 hours of generation. NOT reversible, and the same invoice number can never get a new IRN. The caller must have asked the user to confirm.
 */
export async function cancelEInvoice(docEntry: number, request: CancelRequest): Promise<ErpNextComplianceResult> {
  try {
    const { data } = await apiClient.post<ApiResponse<ErpNextComplianceResult>>(`/erpnext/invoices/${docEntry}/e-invoice/cancel`, request);
    if (!data.success || !data.data) throw new ErpNextApiError(data.message ?? 'The e-invoice was not cancelled.', data.errors ?? []);
    return data.data;
  } catch (err) {
    if (err instanceof ErpNextApiError) throw err;
    throw toApiError(err, 'cancel the e-invoice');
  }
}

/** Cancels the e-way bill within 24 hours of its generation. NOT reversible (a new one can be generated afterwards). */
export async function cancelEwayBill(docEntry: number, request: CancelRequest): Promise<ErpNextComplianceResult> {
  try {
    const { data } = await apiClient.post<ApiResponse<ErpNextComplianceResult>>(`/erpnext/invoices/${docEntry}/e-waybill/cancel`, request);
    if (!data.success || !data.data) throw new ErpNextApiError(data.message ?? 'The e-way bill was not cancelled.', data.errors ?? []);
    return data.data;
  } catch (err) {
    if (err instanceof ErpNextApiError) throw err;
    throw toApiError(err, 'cancel the e-way bill');
  }
}

/** The signed QR string of the invoice's active e-invoice; null if it has none (404). */
export async function getEInvoiceQr(docEntry: number): Promise<EInvoiceQr | null> {
  try {
    const { data } = await apiClient.get<ApiResponse<EInvoiceQr>>(`/erpnext/invoices/${docEntry}/e-invoice/qr`);
    return data.success && data.data ? data.data : null;
  } catch (err: any) {
    if (err?.response?.status === 404) return null;
    throw toApiError(err, 'load the e-invoice QR code');
  }
}
