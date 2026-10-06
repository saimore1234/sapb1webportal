using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace SAPB1.Api.DTOs.ErpNext;

/// <summary>
/// Result of POST /api/erpnext/invoices/{docEntry}/preview: the ERPNext Sales
/// Invoice payload the push WOULD send, and every problem that would block it.
/// Produced without calling ERPNext. IsValid = no problems (warnings don't block).
/// </summary>
public class ErpNextPreviewDto
{
    public int DocEntry { get; set; }
    public int DocNum { get; set; }
    public string SapKey { get; set; } = string.Empty;
    public bool IsValid => Problems.Count == 0;
    public List<string> Problems { get; set; } = new();
    public List<string> Warnings { get; set; } = new();

    /// <summary>"Intra" (CGST+SGST), "Inter" (IGST) or null if it could not be determined.</summary>
    public string? SupplyType { get; set; }
    public string? TaxTemplate { get; set; }
    public string? PlaceOfSupply { get; set; }

    public ErpNextPreviewCustomerDto? Customer { get; set; }
    public List<ErpNextPreviewAddressDto> Addresses { get; set; } = new();
    public List<ErpNextPreviewItemDto> Items { get; set; } = new();

    /// <summary>SAP's own GST per tax type (from INV4) — what the ERPNext total will be reconciled against.</summary>
    public Dictionary<string, decimal> SapTaxSummary { get; set; } = new();
    public decimal SapTotal { get; set; }
    public string? SapCurrency { get; set; }

    /// <summary>The Sales Invoice document as it would be sent (a JSON object; null if the invoice could not be read far enough to build one).</summary>
    public object? Payload => PayloadNode;

    [JsonIgnore]
    public JsonObject? PayloadNode { get; set; }
}

public class ErpNextPreviewCustomerDto
{
    public string Name { get; set; } = string.Empty;
    public string SapKey { get; set; } = string.Empty;
    public string? Gstin { get; set; }
    public string GstCategory { get; set; } = string.Empty;
    public string CustomerGroup { get; set; } = string.Empty;
    public string Territory { get; set; } = string.Empty;
    public bool CreateIfMissing { get; set; }
}

public class ErpNextPreviewAddressDto
{
    /// <summary>"Billing" | "Shipping"</summary>
    public string Type { get; set; } = string.Empty;
    public string SapKey { get; set; } = string.Empty;
    public string? Line1 { get; set; }
    public string? Line2 { get; set; }
    public string? City { get; set; }
    public string? Pincode { get; set; }
    public string? State { get; set; }
    public string? Country { get; set; }
    public string? Gstin { get; set; }
    public string GstCategory { get; set; } = string.Empty;
}

public class ErpNextPreviewItemDto
{
    public int LineNum { get; set; }
    public string SapItemCode { get; set; } = string.Empty;
    public string ErpNextItemCode { get; set; } = string.Empty;
    public string ItemName { get; set; } = string.Empty;
    public string SapKey { get; set; } = string.Empty;
    public string? HsnSacCode { get; set; }
    public string? SapTaxCode { get; set; }
    public string? ItemTaxTemplate { get; set; }
    public string? Uom { get; set; }
    public bool CreateIfMissing { get; set; }
}
