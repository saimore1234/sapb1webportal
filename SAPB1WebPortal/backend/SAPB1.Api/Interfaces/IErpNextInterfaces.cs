using System.Text.Json.Nodes;
using SAPB1.Api.DTOs.ErpNext;
using SAPB1.Api.Services.ErpNext;

namespace SAPB1.Api.Interfaces;

/// <summary>
/// Resolves the ERPNext settings for the company the CURRENT request is
/// authenticated against (ICompanyContext, from the validated JWT, re-checked
/// against ICompanyRegistry). Nothing about which ERPNext site, company or
/// credentials to use is ever taken from a request.
/// </summary>
public interface IErpNextConfigProvider
{
    /// <summary>Throws <see cref="ErpNextConfigException"/> with a safe message if the company has no usable ERPNext config.</summary>
    ErpNextCompanyOptions GetForCurrentCompany();

    /// <summary>Same, but returns null plus a safe <paramref name="error"/> message instead of throwing when the
    /// company's ERPNext settings are missing/invalid (used by the preview, which reports it as a problem).</summary>
    ErpNextCompanyOptions? TryGetForCurrentCompany(out string? error);
}

/// <summary>
/// Thin authenticated REST client for one ERPNext site. Every call takes the
/// already-resolved company options; the client holds no per-company state.
/// Failures throw <see cref="ErpNextException"/> with a sanitised message.
/// </summary>
public interface IErpNextClient
{
    /// <summary>GET. Returns null on HTTP 404 (document not found).</summary>
    Task<JsonNode?> GetAsync(ErpNextCompanyOptions cfg, string path, IDictionary<string, string>? query = null, CancellationToken ct = default);
    Task<JsonNode> PostAsync(ErpNextCompanyOptions cfg, string path, JsonNode body, CancellationToken ct = default);
    Task<JsonNode> PutAsync(ErpNextCompanyOptions cfg, string path, JsonNode body, CancellationToken ct = default);

    /// <summary>GET /api/resource/{doctype}/{name}; returns the "data" object, or null if not found.</summary>
    Task<JsonNode?> GetDocAsync(ErpNextCompanyOptions cfg, string doctype, string name, CancellationToken ct = default);

    /// <summary>GET /api/resource/{doctype} with filters ([[field, op, value], ...]); returns the "data" array.</summary>
    Task<JsonArray> ListAsync(ErpNextCompanyOptions cfg, string doctype, JsonArray? filters, string[] fields, int limit = 20, CancellationToken ct = default);
}

/// <summary>Read-only reader of one A/R Invoice (OINV/INV1/INV4/INV12/CRD1...) from the current company's SAP database.</summary>
public interface ISapInvoiceReader
{
    /// <summary>Null if the invoice does not exist. Throws <see cref="SapDataException"/> if a required SAP column/table is missing.</summary>
    Task<SapInvoiceData?> ReadAsync(int docEntry, CancellationToken ct = default);
}

/// <summary>Invoice-level ERPNext operations. Nothing here writes to SAP.</summary>
public interface IErpNextInvoiceService
{
    /// <summary>Reads the invoice from SAP and returns the mapped ERPNext payload plus validation problems.
    /// Does NOT call ERPNext. Null if the invoice does not exist.</summary>
    Task<ErpNextPreviewDto?> PreviewAsync(int docEntry, CancellationToken ct = default);

    /// <summary>Pushes the invoice to ERPNext as a DRAFT Sales Invoice (never submits). Idempotent: a second call returns
    /// the existing ERPNext invoice. Null if the invoice does not exist in SAP.</summary>
    Task<ErpNextPushResultDto?> PushAsync(int docEntry, CancellationToken ct = default);

    /// <summary>What the link table says about this invoice. Does not call ERPNext.</summary>
    Task<ErpNextLinkStatusDto> GetStatusAsync(int docEntry, CancellationToken ct = default);
}

/// <summary>E-invoice (IRN) and e-way bill generation for an invoice already pushed to ERPNext, done by ERPNext + India Compliance.
/// Nothing here writes to SAP.</summary>
public interface IErpNextComplianceService
{
    /// <summary>Pre-fill for the e-way bill form from the SAP invoice's transport fields. Null if the invoice does not exist in SAP.</summary>
    Task<ErpNextTransportDefaultsDto?> GetTransportDefaultsAsync(int docEntry, CancellationToken ct = default);

    /// <summary>Submits the draft in ERPNext if needed, then registers the invoice with the GST e-invoice portal. Requires Confirm.</summary>
    Task<ErpNextComplianceResultDto> GenerateEInvoiceAsync(int docEntry, ErpNextEInvoiceRequestDto request, CancellationToken ct = default);

    Task<ErpNextComplianceResultDto> GenerateEwayBillAsync(int docEntry, ErpNextEwayBillRequestDto request, CancellationToken ct = default);

    /// <summary>Cancels the IRN (and, as India Compliance does, any e-way bill on the invoice) within the 24-hour window. Requires Confirm.
    /// After this the same invoice number can never get a new IRN.</summary>
    Task<ErpNextComplianceResultDto> CancelEInvoiceAsync(int docEntry, ErpNextCancelRequestDto request, CancellationToken ct = default);

    /// <summary>Cancels the e-way bill within 24 hours of its generation. Requires Confirm.</summary>
    Task<ErpNextComplianceResultDto> CancelEwayBillAsync(int docEntry, ErpNextCancelRequestDto request, CancellationToken ct = default);

    /// <summary>The signed QR string of the invoice's e-invoice, for the portal to draw. Null if there is no active e-invoice.</summary>
    Task<ErpNextEInvoiceQrDto?> GetEInvoiceQrAsync(int docEntry, CancellationToken ct = default);

    /// <summary>Re-reads the invoice from ERPNext (status, IRN, acknowledgement, e-way bill) and updates the link.</summary>
    Task<ErpNextLinkStatusDto> RefreshAsync(int docEntry, CancellationToken ct = default);
}

public enum LinkClaimOutcome { Claimed, AlreadyPushed, InProgress }

/// <summary>One row of dbo.ErpNextInvoiceLink.</summary>
public class ErpNextInvoiceLinkRow
{
    public int Id { get; set; }
    public string CompanyCode { get; set; } = string.Empty;
    public int DocEntry { get; set; }
    public int DocNum { get; set; }
    public string SapB1Key { get; set; } = string.Empty;
    public string ErpNextCompany { get; set; } = string.Empty;
    public string PushStatus { get; set; } = string.Empty;
    public string? ErpNextInvoiceName { get; set; }
    public string? ErpNextDocStatus { get; set; }
    public decimal? SapTotal { get; set; }
    public decimal? ErpNextGrandTotal { get; set; }
    public string? ReconStatus { get; set; }
    public string? ReconDetail { get; set; }
    public DateTime? PushedAtUtc { get; set; }
    public string? PushedBy { get; set; }
    public string? LastError { get; set; }
    public DateTime? LastSyncedAtUtc { get; set; }
    public DateTime UpdatedAt { get; set; }

    // E-invoice (IRN). AckDate / Ewb dates are the ERPNext site's local time as returned by ERPNext.
    public string? Irn { get; set; }
    public string? AckNo { get; set; }
    public DateTime? AckDate { get; set; }
    public string? EInvoiceStatus { get; set; }
    public DateTime? EInvoiceAtUtc { get; set; }
    public string? EInvoiceBy { get; set; }
    public string? EInvoiceError { get; set; }

    // E-way bill.
    public string? EwbNo { get; set; }
    public DateTime? EwbDate { get; set; }
    public DateTime? EwbValidUpto { get; set; }
    public string? EwbStatus { get; set; }
    public DateTime? EwbAtUtc { get; set; }
    public string? EwbBy { get; set; }
    public string? EwbError { get; set; }

    // Cancellations ("Reason: remark").
    public DateTime? EInvoiceCancelledAtUtc { get; set; }
    public string? EInvoiceCancelReason { get; set; }
    public string? EInvoiceCancelledBy { get; set; }
    public DateTime? EwbCancelledAtUtc { get; set; }
    public string? EwbCancelReason { get; set; }
    public string? EwbCancelledBy { get; set; }
}

/// <summary>What ERPNext currently says about an invoice, used to refresh the link row.</summary>
public class ErpNextSyncSnapshot
{
    public string? DocStatus { get; set; }
    public decimal? GrandTotal { get; set; }
    public string? Irn { get; set; }
    public string? AckNo { get; set; }
    public DateTime? AckDate { get; set; }
    public string? EInvoiceStatus { get; set; }
    public string? EwbNo { get; set; }
    public DateTime? EwbDate { get; set; }
    public DateTime? EwbValidUpto { get; set; }
    public string? EwbStatus { get; set; }
}

/// <summary>Persistence of the SAP-invoice -> ERPNext-invoice link (portal database only).</summary>
public interface IErpNextLinkStore
{
    Task<ErpNextInvoiceLinkRow?> GetAsync(string companyCode, int docEntry, CancellationToken ct = default);

    /// <summary>Claims the invoice for pushing by inserting a 'Pushing' row (or re-claiming a Failed/stale one).
    /// Exactly one concurrent caller gets <see cref="LinkClaimOutcome.Claimed"/>.</summary>
    Task<(LinkClaimOutcome Outcome, ErpNextInvoiceLinkRow Link)> ClaimAsync(
        string companyCode, int docEntry, int docNum, string sapKey, string erpNextCompany, string user, CancellationToken ct = default);

    Task MarkPushedAsync(int id, string invoiceName, string? docStatus, decimal sapTotal, decimal? erpNextTotal, string reconStatus, string reconDetail);
    Task MarkFailedAsync(int id, string error);

    /// <summary>Marks an e-invoice (kind "EInvoice") or e-way bill (kind "Ewb") as Generating. Returns false if one is already
    /// generating (fresh) or already generated — so two clicks can never both reach the government portal.</summary>
    Task<bool> BeginComplianceAsync(int id, string kind, string user);
    Task MarkEInvoiceGeneratedAsync(int id, string irn, string? ackNo, DateTime? ackDate, string? erpNextDocStatus);
    Task MarkEwayBillGeneratedAsync(int id, string ewbNo, DateTime? ewbDate, DateTime? validUpto, string? erpNextDocStatus);
    Task MarkComplianceFailedAsync(int id, string kind, string error, string? erpNextDocStatus);
    Task SyncAsync(int id, ErpNextSyncSnapshot snapshot);

    /// <summary>Marks an e-invoice (kind "EInvoice") or e-way bill (kind "Ewb") as Cancelling. Returns false unless it is currently
    /// Generated (or a stale Cancelling) — so two clicks can never both send a cancellation to the GST portal.</summary>
    Task<bool> BeginCancelAsync(int id, string kind);
    Task MarkCancelledAsync(int id, string kind, string reason, string user, string? erpNextDocStatus);
    /// <summary>The cancellation did not happen: put the status back to Generated and keep the reason it failed.</summary>
    Task MarkCancelFailedAsync(int id, string kind, string error);
}

/// <summary>Setup actions an administrator runs before the first push.</summary>
public interface IErpNextAdminService
{
    Task<ErpNextCheckResultDto> TestConnectionAsync(CancellationToken ct = default);
    Task<ErpNextCustomFieldsResultDto> CreateCustomFieldsAsync(CancellationToken ct = default);
}

/// <summary>Safe audit trail of ERPNext actions (dbo.ErpNextActionLog). Never logs credentials or raw exceptions.</summary>
public interface IErpNextActionLog
{
    Task LogAsync(string companyCode, int? docEntry, string action, bool success, string? detail, CancellationToken ct = default);
}
