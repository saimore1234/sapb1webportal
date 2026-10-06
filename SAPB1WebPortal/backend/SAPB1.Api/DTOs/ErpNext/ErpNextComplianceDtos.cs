namespace SAPB1.Api.DTOs.ErpNext;

/// <summary>Body of POST .../e-invoice. Confirm must be true: generating an IRN registers the invoice with the GST portal.</summary>
public class ErpNextEInvoiceRequestDto
{
    public bool Confirm { get; set; }
}

/// <summary>Body of POST .../e-waybill. Dates are yyyy-MM-dd. Distance 0 lets the portal work it out from the pincodes.</summary>
public class ErpNextEwayBillRequestDto
{
    /// <summary>Required when the invoice is still a draft in ERPNext: the e-way bill needs it submitted.</summary>
    public bool Confirm { get; set; }

    /// <summary>"Road" | "Rail" | "Air" | "Ship"</summary>
    public string? Mode { get; set; }
    public string? VehicleNo { get; set; }
    /// <summary>"Regular" | "Over Dimensional Cargo (ODC)" — Road only.</summary>
    public string? VehicleType { get; set; }
    public string? TransporterGstin { get; set; }
    public string? TransporterName { get; set; }
    public string? LrNo { get; set; }
    public string? LrDate { get; set; }
    public int Distance { get; set; }
}

/// <summary>Body of POST .../e-invoice/cancel and .../e-waybill/cancel. Confirm must be true.</summary>
public class ErpNextCancelRequestDto
{
    public bool Confirm { get; set; }

    /// <summary>"Duplicate" | "Data Entry Mistake" | "Order Cancelled" | "Others"</summary>
    public string? Reason { get; set; }

    /// <summary>Optional note sent to the GST portal (max 100 characters).</summary>
    public string? Remark { get; set; }
}

/// <summary>The signed QR string of an e-invoice (from ERPNext's e-Invoice Log); the portal draws the QR code from it.</summary>
public class ErpNextEInvoiceQrDto
{
    public string Irn { get; set; } = string.Empty;
    public string SignedQrCode { get; set; } = string.Empty;
}

/// <summary>Result of an e-invoice / e-way bill generation: the outcome plus the invoice's full ERPNext status.</summary>
public class ErpNextComplianceResultDto
{
    /// <summary>"Generated" | "AlreadyGenerated"</summary>
    public string Outcome { get; set; } = string.Empty;
    public ErpNextLinkStatusDto Status { get; set; } = new();
}

/// <summary>Pre-fill for the e-way bill form, read from the SAP invoice's transport user fields (read-only).</summary>
public class ErpNextTransportDefaultsDto
{
    public string Mode { get; set; } = "Road";
    public string? VehicleNo { get; set; }
    public string? TransporterName { get; set; }
    public string? LrNo { get; set; }
    public string? LrDate { get; set; }
    public int Distance { get; set; }
    /// <summary>True when ERPNext still holds this invoice as a draft, so generating the e-way bill will submit it first.</summary>
    public bool WillSubmit { get; set; }
}
