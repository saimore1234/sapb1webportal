namespace SAPB1.Api.DTOs.Sales;

// ---- Invoice Register ----------------------------------------------------
public class InvoiceRegisterQuery
{
    public DateTime? DateFrom { get; set; }
    public DateTime? DateTo { get; set; }
    public string? Search { get; set; }
    /// <summary>all | delivery (created from a delivery) | direct (invoiced without a delivery).</summary>
    public string? Dispatch { get; set; }
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 10;
}

public class InvoiceRegisterRowDto
{
    public int DocEntry { get; set; }
    public int DocNum { get; set; }
    public DateTime DocDate { get; set; }
    public string CustomerCode { get; set; } = string.Empty;
    public string? CustomerName { get; set; }
    public string? Item { get; set; }
    public int LineCount { get; set; }
    public double Quantity { get; set; }
    public string? Uom { get; set; }
    /// <summary>Net line value / quantity.</summary>
    public decimal Rate { get; set; }
    /// <summary>Invoice value including GST (DocTotal).</summary>
    public decimal Value { get; set; }
    /// <summary>"Against Delivery" when any line was created from a delivery, otherwise "Direct Invoice".</summary>
    public string DispatchStatus { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
}

public class InvoiceRegisterDto
{
    public int TotalCount { get; set; }
    public decimal TotalValue { get; set; }
    public List<InvoiceRegisterRowDto> Rows { get; set; } = new();
}

// ---- Customer Outstanding --------------------------------------------------
public class AgeingBucketDto
{
    public string Label { get; set; } = string.Empty;
    public decimal Value { get; set; }
}

public class CustomerAgeingRowDto
{
    public string CustomerCode { get; set; } = string.Empty;
    public string? CustomerName { get; set; }
    public string? SalesPerson { get; set; }
    public decimal Days0To30 { get; set; }
    public decimal Days31To60 { get; set; }
    public decimal Days61To90 { get; set; }
    public decimal Days90Plus { get; set; }
    public decimal Total { get; set; }
    /// <summary>Low | Watch | High — High when 25%+ of the balance is older than 60 days.</summary>
    public string Risk { get; set; } = "Low";
}

public class CustomerOutstandingDto
{
    public DateTime AsOf { get; set; }
    public int CreditTermsDays { get; set; } = 60;
    public decimal Total { get; set; }
    public int CustomerCount { get; set; }
    /// <summary>Balance aged up to the credit-terms window.</summary>
    public decimal Current { get; set; }
    /// <summary>Balance aged beyond the credit-terms window.</summary>
    public decimal Overdue { get; set; }
    public int OverdueCustomerCount { get; set; }
    public List<AgeingBucketDto> Buckets { get; set; } = new();
    public List<CustomerAgeingRowDto> Customers { get; set; } = new();
}

// ---- Customer Ledger -------------------------------------------------------
public class CustomerLookupDto
{
    public string CustomerCode { get; set; } = string.Empty;
    public string? CustomerName { get; set; }
}

public class LedgerRowDto
{
    public DateTime Date { get; set; }
    public string DocType { get; set; } = string.Empty;
    public string? DocNo { get; set; }
    public string? Particulars { get; set; }
    public decimal Debit { get; set; }
    public decimal Credit { get; set; }
    public decimal Balance { get; set; }
}

public class CustomerLedgerDto
{
    public string CustomerCode { get; set; } = string.Empty;
    public string? CustomerName { get; set; }
    public string? City { get; set; }
    public string? TaxNo { get; set; }
    public DateTime DateFrom { get; set; }
    public DateTime DateTo { get; set; }
    public decimal OpeningBalance { get; set; }
    public decimal TotalDebit { get; set; }
    public decimal TotalCredit { get; set; }
    public decimal ClosingBalance { get; set; }
    public decimal CreditLimit { get; set; }
    /// <summary>Current account balance (OCRD.Balance) — what the credit limit is measured against.</summary>
    public decimal CurrentBalance { get; set; }
    public List<LedgerRowDto> Rows { get; set; } = new();
}

// ---- Sales Analytics -------------------------------------------------------
public class SalesAnalyticsQuery
{
    public string? Customer { get; set; }
    public int? SalesPerson { get; set; }
    public string? Item { get; set; }
    public DateTime? DateFrom { get; set; }
    public DateTime? DateTo { get; set; }
}

public class AnalyticsPointDto
{
    public string Label { get; set; } = string.Empty;
    public decimal Value { get; set; }
    public double Quantity { get; set; }
}

public class AnalyticsComparisonDto
{
    public string Key { get; set; } = string.Empty;
    public string? Name { get; set; }
    public decimal Value { get; set; }
    public decimal PreviousValue { get; set; }
}

public class AnalyticsOptionDto
{
    public string Key { get; set; } = string.Empty;
    public string? Name { get; set; }
}

public class SalesAnalyticsReportDto
{
    public DateTime DateFrom { get; set; }
    public DateTime DateTo { get; set; }
    public double Quantity { get; set; }
    public double PreviousQuantity { get; set; }
    public decimal Value { get; set; }
    public decimal PreviousValue { get; set; }
    /// <summary>Value / quantity, net of GST.</summary>
    public decimal AverageRate { get; set; }
    public decimal PreviousAverageRate { get; set; }
    public List<AnalyticsPointDto> Trend { get; set; } = new();
    public List<AnalyticsComparisonDto> Customers { get; set; } = new();
    public List<AnalyticsComparisonDto> Items { get; set; } = new();
}

public class SalesAnalyticsOptionsDto
{
    public List<AnalyticsOptionDto> Customers { get; set; } = new();
    public List<AnalyticsOptionDto> SalesPersons { get; set; } = new();
    public List<AnalyticsOptionDto> Items { get; set; } = new();
}

// ---- Turnover breakup (Sales Dashboard: Total Turnover + Customer Group / Location / Branch) ----
public class TurnoverQuery
{
    public DateTime? DateFrom { get; set; }
    public DateTime? DateTo { get; set; }
    /// <summary>OCRG.GroupCode; null = all groups.</summary>
    public int? CustomerGroup { get; set; }
    /// <summary>OLCT.Code (invoice line location); null = all.</summary>
    public int? Location { get; set; }
    /// <summary>OBPL.BPLId (invoice branch); null = all.</summary>
    public int? Branch { get; set; }
}

public class TurnoverOptionDto
{
    public int Code { get; set; }
    public string Name { get; set; } = string.Empty;
}

public class TurnoverGroupDto
{
    public string CustomerGroup { get; set; } = string.Empty;
    public decimal SalesValue { get; set; }
    public decimal Percentage { get; set; }
}

public class TurnoverGroupLocationBranchDto
{
    public string CustomerGroup { get; set; } = string.Empty;
    public string Location { get; set; } = string.Empty;
    public string Branch { get; set; } = string.Empty;
    public decimal SalesValue { get; set; }
    public decimal Percentage { get; set; }
}

public class TurnoverBreakupDto
{
    public DateTime DateFrom { get; set; }
    public DateTime DateTo { get; set; }
    public decimal TotalTurnover { get; set; }
    public List<TurnoverGroupDto> CustomerGroupSales { get; set; } = new();
    public List<TurnoverGroupLocationBranchDto> GroupLocationBranchSales { get; set; } = new();
    public List<TurnoverOptionDto> CustomerGroups { get; set; } = new();
    public List<TurnoverOptionDto> Locations { get; set; } = new();
    public List<TurnoverOptionDto> Branches { get; set; } = new();
}
