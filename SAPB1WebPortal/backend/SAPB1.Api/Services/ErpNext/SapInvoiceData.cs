namespace SAPB1.Api.Services.ErpNext;

// Read-model of one SAP B1 A/R Invoice, exactly the columns the ERPNext push needs.
// Property names match the SAP column names (or their SELECT aliases) so Dapper maps them directly.

public class SapInvoiceHeader
{
    public int DocEntry { get; set; }
    public int DocNum { get; set; }
    public string CardCode { get; set; } = string.Empty;
    public string? CardName { get; set; }
    public DateTime DocDate { get; set; }
    public DateTime? DocDueDate { get; set; }
    public string? DocCur { get; set; }
    public decimal DocRate { get; set; }
    public decimal DocTotal { get; set; }
    public decimal DocTotalFC { get; set; }
    public string? Comments { get; set; }
    public string? NumAtCard { get; set; }
    public string? PayToCode { get; set; }
    public string? ShipToCode { get; set; }
    public string? GSTTranTyp { get; set; }
    public string? ShipState { get; set; }
    /// <summary>OINV.CANCELED: 'N' normal, 'Y' cancelled, 'C' is the cancellation document.</summary>
    public string? Canceled { get; set; }
    public string? DocStatus { get; set; }
}

/// <summary>INV12 — one row per invoice.</summary>
public class SapInvoiceGstInfo
{
    public string? BpGSTN { get; set; }
    public string? BpGSTType { get; set; }
    public string? BpStateCod { get; set; }
    public string? LocGSTN { get; set; }
    public string? LocGSTType { get; set; }
    public string? LocStaGSTN { get; set; }
}

public class SapInvoiceLine
{
    public int LineNum { get; set; }
    public string? ItemCode { get; set; }
    public string? Dscription { get; set; }
    public double Quantity { get; set; }
    /// <summary>Unit price AFTER the line discount.</summary>
    public decimal Price { get; set; }
    public decimal DiscPrcnt { get; set; }
    public string? TaxCode { get; set; }
    public decimal LineTotal { get; set; }
    public string? UnitMsr { get; set; }
    public string? WhsCode { get; set; }
    public int? HsnEntry { get; set; }
    public int? SacEntry { get; set; }
    /// <summary>OCHP.ChapterID resolved from INV1.HsnEntry, falling back to OITM.ChapterID.</summary>
    public string? HsnCode { get; set; }
    /// <summary>OSAC.ServCode resolved from INV1.SacEntry, falling back to OITM.SACEntry.</summary>
    public string? SacCode { get; set; }
}

/// <summary>INV4 — GST per line and tax type, used for reconciliation only.</summary>
public class SapInvoiceTaxLine
{
    public int LineNum { get; set; }
    public string? StcCode { get; set; }
    public string? StaCode { get; set; }
    public int? StaType { get; set; }
    public decimal TaxRate { get; set; }
    public decimal TaxSum { get; set; }
    public decimal BaseSum { get; set; }
}

public class SapInvoiceAddress
{
    /// <summary>'B' bill-to, 'S' ship-to.</summary>
    public string AdresType { get; set; } = string.Empty;
    public string? Address { get; set; }
    public string? Street { get; set; }
    public string? Block { get; set; }
    public string? Building { get; set; }
    public string? City { get; set; }
    public string? ZipCode { get; set; }
    public string? StateCode { get; set; }
    public string? StateName { get; set; }
    public string? CountryCode { get; set; }
    public string? CountryName { get; set; }
    public string? GSTRegnNo { get; set; }
    public string? GSTType { get; set; }
}

public class SapInvoiceData
{
    public SapInvoiceHeader Header { get; set; } = new();
    /// <summary>Null if the invoice has no INV12 row.</summary>
    public SapInvoiceGstInfo? Gst { get; set; }
    public List<SapInvoiceLine> Lines { get; set; } = new();
    public List<SapInvoiceTaxLine> TaxLines { get; set; } = new();
    public List<SapInvoiceAddress> Addresses { get; set; } = new();
    /// <summary>OCST name for INV12.BpStateCod / OINV.ShipState; null if not found.</summary>
    public string? BpStateName { get; set; }
    public string? ShipStateName { get; set; }
    /// <summary>Optional OINV user fields that exist in this company's database (U_Transporter, U_GateInVehicleNo, ...). Read-only.</summary>
    public Dictionary<string, object?> Udfs { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}
