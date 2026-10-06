namespace SAPB1.Api.DTOs.ErpNext;

/// <summary>Result of POST /api/erpnext/invoices/{docEntry}/push.</summary>
public class ErpNextPushResultDto
{
    public int DocEntry { get; set; }
    public int DocNum { get; set; }

    /// <summary>
    /// "Created"       a new draft Sales Invoice was created.
    /// "AlreadyPushed" this invoice was pushed before; the existing ERPNext invoice is returned, nothing was created.
    /// "Adopted"       a previous attempt had created it in ERPNext (e.g. after a timeout); it was found by sap_b1_key and linked.
    /// "Blocked"       validation problems prevented the push (nothing was sent to ERPNext).
    /// "InProgress"    another push of the same invoice is running right now.
    /// </summary>
    public string Outcome { get; set; } = string.Empty;
    public List<string> Problems { get; set; } = new();

    public string? InvoiceName { get; set; }
    public string? ErpNextDocStatus { get; set; }
    public string? InvoiceUrl { get; set; }

    public decimal? SapTotal { get; set; }
    public decimal? ErpNextGrandTotal { get; set; }
    /// <summary>"Match" | "Mismatch"</summary>
    public string? ReconStatus { get; set; }
    public string? ReconDetail { get; set; }
    public DateTime? PushedAtUtc { get; set; }
}

/// <summary>Result of GET /api/erpnext/invoices/{docEntry}: what the link table currently says.</summary>
public class ErpNextLinkStatusDto
{
    public int DocEntry { get; set; }
    /// <summary>"NotPushed" | "Pushing" | "Pushed" | "Failed"</summary>
    public string Status { get; set; } = "NotPushed";
    public string? InvoiceName { get; set; }
    public string? ErpNextDocStatus { get; set; }
    public string? InvoiceUrl { get; set; }
    public decimal? SapTotal { get; set; }
    public decimal? ErpNextGrandTotal { get; set; }
    public string? ReconStatus { get; set; }
    public string? ReconDetail { get; set; }
    public DateTime? PushedAtUtc { get; set; }
    public string? PushedBy { get; set; }
    public string? LastError { get; set; }

    // E-invoice (IRN) — null until generated. AckDate and the e-way bill dates are the ERPNext site's local time (IST).
    public string? Irn { get; set; }
    public string? AckNo { get; set; }
    public DateTime? AckDate { get; set; }
    /// <summary>null | "Generating" | "Generated" | "Failed" | "Cancelled"</summary>
    public string? EInvoiceStatus { get; set; }
    public string? EInvoiceError { get; set; }
    public string? EInvoiceBy { get; set; }

    // E-way bill — null until generated.
    public string? EwbNo { get; set; }
    public DateTime? EwbDate { get; set; }
    public DateTime? EwbValidUpto { get; set; }
    public string? EwbStatus { get; set; }
    public string? EwbError { get; set; }
    public string? EwbBy { get; set; }

    // Cancellations. While one is in flight the e-invoice / e-way bill status above reads "Cancelling".
    public DateTime? EInvoiceCancelledAtUtc { get; set; }
    public string? EInvoiceCancelReason { get; set; }
    public string? EInvoiceCancelledBy { get; set; }
    public DateTime? EwbCancelledAtUtc { get; set; }
    public string? EwbCancelReason { get; set; }
    public string? EwbCancelledBy { get; set; }

    /// <summary>Until when (ERPNext site local time) the e-invoice / e-way bill can still be cancelled: 24 hours after it was generated. Null when none is active.</summary>
    public DateTime? EInvoiceCancellableUntil { get; set; }
    public DateTime? EwbCancellableUntil { get; set; }
}
