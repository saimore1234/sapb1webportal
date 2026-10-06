namespace SAPB1.Api.DTOs.Sales;

/// <summary>
/// Client-approved "Sales Dashboard" (stage 1: Key Metrics, Sales Overview,
/// Open Sales Orders). Financial year = Apr–Mar. Every figure comes from real
/// SAP B1 documents; nothing the company doesn't record (targets, sample
/// requests) is invented — those fields are simply absent.
/// </summary>
public class SalesOverviewDto
{
    public DateTime FyStart { get; set; }
    public DateTime FyEnd { get; set; }
    public string FyLabel { get; set; } = string.Empty; // e.g. "FY 2026-27"

    // Key metrics
    public int TotalCustomers { get; set; }
    public int NewCustomersThisQuarter { get; set; }
    public int OpenSalesOrders { get; set; }
    public decimal OpenSalesOrderValue { get; set; }
    /// <summary>Open deliveries: dispatched but not yet invoiced.</summary>
    public int PendingInvoices { get; set; }
    public decimal PendingInvoiceValue { get; set; }
    public decimal TotalOutstanding { get; set; }
    public decimal OverdueOutstanding { get; set; }
    public int OverdueDaysThreshold { get; set; } = 60;

    public List<SalesOverviewMonthDto> Monthly { get; set; } = new();
    public List<SalesByEmployeeDto> SalesPersons { get; set; } = new();
    public List<SalesByCustomerDto> TopCustomers { get; set; } = new();
    public List<SalesByItemDto> TopItems { get; set; } = new();
}

public class SalesOverviewMonthDto
{
    public string Period { get; set; } = string.Empty; // yyyy-MM, current FY
    public string Label { get; set; } = string.Empty;  // "Apr"
    public decimal Value { get; set; }
    public double Quantity { get; set; }
    public decimal PreviousValue { get; set; }         // same month, previous FY
    public double PreviousQuantity { get; set; }
}

public class OpenSalesOrderRowDto
{
    public int DocEntry { get; set; }
    public int DocNum { get; set; }
    public DateTime PostingDate { get; set; }
    public string CustomerCode { get; set; } = string.Empty;
    public string? CustomerName { get; set; }
    public string? City { get; set; }
    public string? Item { get; set; }
    public int LineCount { get; set; }
    public double OrderedQty { get; set; }
    public double PendingQty { get; set; }
    public string? Uom { get; set; }
    /// <summary>Linked production order status (Planned/Released/Closed…), null when none is linked.</summary>
    public string? ProductionStatus { get; set; }
    /// <summary>0-100, completed vs planned qty of linked production orders; null when none.</summary>
    public double? ProductionProgress { get; set; }
    public DateTime? Eta { get; set; }                 // SAP DocDueDate
    /// <summary>Not Dispatched / Part Dispatched / Dispatched (derived from open vs ordered qty).</summary>
    public string DeliveryStatus { get; set; } = string.Empty;
    public decimal Total { get; set; }
}

public class OpenSalesOrdersDto
{
    public int TotalOpen { get; set; }
    public decimal TotalValue { get; set; }
    public int InProduction { get; set; }
    public int Ready { get; set; }
    public int Pending { get; set; }
    public int PartDispatched { get; set; }
    public int TotalCount { get; set; }
    public List<OpenSalesOrderRowDto> Rows { get; set; } = new();
}
