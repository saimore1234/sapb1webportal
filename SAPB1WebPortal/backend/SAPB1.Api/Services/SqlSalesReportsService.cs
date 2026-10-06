using Dapper;
using SAPB1.Api.DTOs.Sales;
using SAPB1.Api.Interfaces;

namespace SAPB1.Api.Services;

/// <summary>
/// Read-only queries behind the Sales Reports (Invoice Register, Customer
/// Outstanding, Customer Ledger, Sales Analytics). Same conventions as
/// SqlSalesService: parameterized Dapper against whichever company the
/// request's JWT resolves to; cancelled documents (CANCELED &lt;&gt; 'N') are
/// excluded from every figure.
/// </summary>
public class SqlSalesReportsService : ISalesReportsService
{
    private readonly ICompanyConnectionFactory _connectionFactory;

    public SqlSalesReportsService(ICompanyConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory;
    }

    private static DateTime FyStart(DateTime today) => new(today.Month >= 4 ? today.Year : today.Year - 1, 4, 1);

    // ---------------------------------------------------------------
    // INVOICE REGISTER
    // ---------------------------------------------------------------
    public async Task<InvoiceRegisterDto> GetInvoiceRegisterAsync(InvoiceRegisterQuery q, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();

        var today = DateTime.Today;
        var p = new DynamicParameters();
        p.Add("From", (q.DateFrom ?? FyStart(today)).Date);
        p.Add("To", (q.DateTo ?? today).Date);
        p.Add("Search", string.IsNullOrWhiteSpace(q.Search) ? null : q.Search.Trim());
        p.Add("SearchLike", string.IsNullOrWhiteSpace(q.Search) ? null : $"%{q.Search.Trim()}%");
        var dispatch = q.Dispatch?.Trim().ToLowerInvariant();
        p.Add("Delivery", dispatch == "delivery" ? 1 : dispatch == "direct" ? 0 : (int?)null);
        p.Add("Skip", (Math.Max(1, q.Page) - 1) * Math.Clamp(q.PageSize, 1, 5000));
        p.Add("PageSize", Math.Clamp(q.PageSize, 1, 5000));

        // Whether an invoice was raised from a delivery (BaseType 15) — the only
        // dispatch signal standard SAP holds. LR/transporter/e-Way data is not
        // in standard tables, so it is deliberately not reported here.
        const string cte = @"
            WITH inv AS (
                SELECT h.DocEntry, h.DocNum, h.DocDate, h.CardCode, h.CardName, h.DocTotal, h.DocStatus,
                       CASE WHEN EXISTS (SELECT 1 FROM INV1 l WHERE l.DocEntry = h.DocEntry AND l.BaseType = 15)
                            THEN 1 ELSE 0 END AS FromDelivery
                FROM OINV h
                WHERE h.CANCELED = 'N' AND h.DocDate >= @From AND h.DocDate <= @To
                  AND (@Search IS NULL OR CAST(h.DocNum AS NVARCHAR(20)) LIKE @SearchLike
                       OR h.CardCode LIKE @SearchLike OR h.CardName LIKE @SearchLike)
            )";
        const string filter = " WHERE (@Delivery IS NULL OR FromDelivery = @Delivery)";

        var totals = await db.QuerySingleAsync(new CommandDefinition(
            cte + " SELECT COUNT(*) AS Cnt, ISNULL(SUM(DocTotal), 0) AS Total FROM inv" + filter, p, cancellationToken: ct));

        var rows = (await db.QueryAsync(new CommandDefinition(cte + @"
            SELECT i.DocEntry, i.DocNum, i.DocDate, i.CardCode, i.CardName, i.DocTotal, i.DocStatus, i.FromDelivery,
                   (SELECT TOP 1 l.Dscription FROM INV1 l WHERE l.DocEntry = i.DocEntry ORDER BY l.LineNum) AS Item,
                   (SELECT TOP 1 l.unitMsr FROM INV1 l WHERE l.DocEntry = i.DocEntry ORDER BY l.LineNum) AS Uom,
                   (SELECT COUNT(*) FROM INV1 l WHERE l.DocEntry = i.DocEntry) AS LineCount,
                   (SELECT ISNULL(SUM(l.Quantity), 0) FROM INV1 l WHERE l.DocEntry = i.DocEntry) AS Qty,
                   (SELECT ISNULL(SUM(l.LineTotal), 0) FROM INV1 l WHERE l.DocEntry = i.DocEntry) AS Net
            FROM inv i" + filter + @"
            ORDER BY i.DocDate DESC, i.DocEntry DESC
            OFFSET @Skip ROWS FETCH NEXT @PageSize ROWS ONLY", p, cancellationToken: ct))).ToList();

        var dto = new InvoiceRegisterDto { TotalCount = (int)totals.Cnt, TotalValue = (decimal)totals.Total };
        foreach (var r in rows)
        {
            double qty = Convert.ToDouble(r.Qty);
            decimal net = Convert.ToDecimal(r.Net);
            dto.Rows.Add(new InvoiceRegisterRowDto
            {
                DocEntry = r.DocEntry, DocNum = r.DocNum, DocDate = r.DocDate,
                CustomerCode = r.CardCode, CustomerName = r.CardName,
                Item = r.Item, Uom = r.Uom, LineCount = r.LineCount, Quantity = qty,
                Rate = qty > 0 ? Math.Round(net / (decimal)qty, 2) : 0,
                Value = r.DocTotal,
                DispatchStatus = r.FromDelivery == 1 ? "Against Delivery" : "Direct Invoice",
                Status = r.DocStatus == "O" ? "Open" : "Closed"
            });
        }
        return dto;
    }

    // ---------------------------------------------------------------
    // CUSTOMER OUTSTANDING — open A/R invoices aged from their posting date
    // against 60-day credit terms.
    // ---------------------------------------------------------------
    public async Task<CustomerOutstandingDto> GetCustomerOutstandingAsync(CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        var today = DateTime.Today;

        const string sql = @"
            SELECT h.CardCode AS CustomerCode, MAX(h.CardName) AS CustomerName, MAX(s.SlpName) AS SalesPerson,
                   ISNULL(SUM(CASE WHEN DATEDIFF(DAY, h.DocDate, @Today) <= 30 THEN h.DocTotal - h.PaidToDate END), 0) AS Days0To30,
                   ISNULL(SUM(CASE WHEN DATEDIFF(DAY, h.DocDate, @Today) BETWEEN 31 AND 60 THEN h.DocTotal - h.PaidToDate END), 0) AS Days31To60,
                   ISNULL(SUM(CASE WHEN DATEDIFF(DAY, h.DocDate, @Today) BETWEEN 61 AND 90 THEN h.DocTotal - h.PaidToDate END), 0) AS Days61To90,
                   ISNULL(SUM(CASE WHEN DATEDIFF(DAY, h.DocDate, @Today) > 90 THEN h.DocTotal - h.PaidToDate END), 0) AS Days90Plus,
                   SUM(h.DocTotal - h.PaidToDate) AS Total
            FROM OINV h
            LEFT JOIN OCRD c ON c.CardCode = h.CardCode
            LEFT JOIN OSLP s ON s.SlpCode = c.SlpCode
            WHERE h.CANCELED = 'N' AND h.DocStatus = 'O' AND h.DocTotal - h.PaidToDate > 0
            GROUP BY h.CardCode
            ORDER BY SUM(h.DocTotal - h.PaidToDate) DESC";

        var all = (await db.QueryAsync<CustomerAgeingRowDto>(new CommandDefinition(sql, new { Today = today }, cancellationToken: ct))).ToList();

        foreach (var c in all)
        {
            var overdue = c.Days61To90 + c.Days90Plus;
            c.Risk = c.Total > 0 && overdue / c.Total >= 0.25m ? "High" : overdue > 0 ? "Watch" : "Low";
        }

        var dto = new CustomerOutstandingDto
        {
            AsOf = today,
            CreditTermsDays = 60,
            Total = all.Sum(x => x.Total),
            CustomerCount = all.Count,
            Overdue = all.Sum(x => x.Days61To90 + x.Days90Plus),
            OverdueCustomerCount = all.Count(x => x.Days61To90 + x.Days90Plus > 0),
            Buckets =
            {
                new AgeingBucketDto { Label = "0–30", Value = all.Sum(x => x.Days0To30) },
                new AgeingBucketDto { Label = "31–60", Value = all.Sum(x => x.Days31To60) },
                new AgeingBucketDto { Label = "61–90", Value = all.Sum(x => x.Days61To90) },
                new AgeingBucketDto { Label = "90+", Value = all.Sum(x => x.Days90Plus) }
            },
            Customers = all.Take(15).ToList()
        };
        dto.Current = dto.Total - dto.Overdue;
        return dto;
    }

    // ---------------------------------------------------------------
    // CUSTOMER LEDGER — journal lines posted to the customer's account.
    // ---------------------------------------------------------------
    public async Task<List<CustomerLookupDto>> LookupCustomersAsync(string? search, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        var like = string.IsNullOrWhiteSpace(search) ? null : $"%{search.Trim()}%";
        const string sql = @"
            SELECT TOP 30 CardCode AS CustomerCode, CardName AS CustomerName
            FROM OCRD
            WHERE CardType = 'C' AND frozenFor = 'N'
              AND (@Like IS NULL OR CardCode LIKE @Like OR CardName LIKE @Like)
            ORDER BY CardName";
        return (await db.QueryAsync<CustomerLookupDto>(new CommandDefinition(sql, new { Like = like }, cancellationToken: ct))).ToList();
    }

    private static string DocTypeLabel(int transType) => transType switch
    {
        13 => "A/R Invoice",
        14 => "Credit Memo",
        15 => "Delivery",
        24 => "Incoming Payment",
        30 => "Journal Entry",
        203 => "A/R Down Payment",
        _ => "Document"
    };

    public async Task<CustomerLedgerDto?> GetCustomerLedgerAsync(string customer, DateTime? from, DateTime? to, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        var today = DateTime.Today;
        var dateFrom = (from ?? FyStart(today)).Date;
        var dateTo = (to ?? today).Date;

        var header = await db.QuerySingleOrDefaultAsync(new CommandDefinition(@"
            SELECT CardCode, CardName, City, LicTradNum, ISNULL(CreditLine, 0) AS CreditLine, ISNULL(Balance, 0) AS Balance
            FROM OCRD WHERE CardCode = @Customer AND CardType = 'C'", new { Customer = customer }, cancellationToken: ct));
        if (header is null) return null;

        var opening = await db.ExecuteScalarAsync<decimal>(new CommandDefinition(
            "SELECT ISNULL(SUM(Debit - Credit), 0) FROM JDT1 WHERE ShortName = @Customer AND RefDate < @From",
            new { Customer = customer, From = dateFrom }, cancellationToken: ct));

        var lines = (await db.QueryAsync(new CommandDefinition(@"
            SELECT TOP 1000 RefDate, TransType, BaseRef, LineMemo, Debit, Credit
            FROM JDT1
            WHERE ShortName = @Customer AND RefDate >= @From AND RefDate <= @To
            ORDER BY RefDate, TransId, Line_ID",
            new { Customer = customer, From = dateFrom, To = dateTo }, cancellationToken: ct))).ToList();

        var dto = new CustomerLedgerDto
        {
            CustomerCode = header.CardCode, CustomerName = header.CardName, City = header.City, TaxNo = header.LicTradNum,
            DateFrom = dateFrom, DateTo = dateTo, OpeningBalance = opening,
            CreditLimit = header.CreditLine, CurrentBalance = header.Balance
        };

        var running = opening;
        foreach (var l in lines)
        {
            decimal debit = l.Debit, credit = l.Credit;
            running += debit - credit;
            dto.TotalDebit += debit;
            dto.TotalCredit += credit;
            dto.Rows.Add(new LedgerRowDto
            {
                Date = l.RefDate,
                DocType = DocTypeLabel(Convert.ToInt32(l.TransType)),
                DocNo = l.BaseRef,
                Particulars = l.LineMemo,
                Debit = debit, Credit = credit, Balance = running
            });
        }
        dto.ClosingBalance = running;
        return dto;
    }

    // ---------------------------------------------------------------
    // SALES ANALYTICS — line-level, net of GST, this period vs the same
    // period one year earlier.
    // ---------------------------------------------------------------
    public async Task<SalesAnalyticsOptionsDto> GetAnalyticsOptionsAsync(CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        var dto = new SalesAnalyticsOptionsDto();

        dto.Customers = (await db.QueryAsync<AnalyticsOptionDto>(new CommandDefinition(@"
            SELECT TOP 300 h.CardCode AS [Key], MAX(h.CardName) AS Name
            FROM OINV h WHERE h.CANCELED = 'N' GROUP BY h.CardCode ORDER BY SUM(h.DocTotal) DESC", cancellationToken: ct))).ToList();
        dto.SalesPersons = (await db.QueryAsync<AnalyticsOptionDto>(new CommandDefinition(@"
            SELECT CAST(SlpCode AS NVARCHAR(20)) AS [Key], SlpName AS Name
            FROM OSLP WHERE SlpCode > 0 AND Active = 'Y' ORDER BY SlpName", cancellationToken: ct))).ToList();
        dto.Items = (await db.QueryAsync<AnalyticsOptionDto>(new CommandDefinition(@"
            SELECT TOP 300 l.ItemCode AS [Key], MAX(l.Dscription) AS Name
            FROM INV1 l JOIN OINV h ON h.DocEntry = l.DocEntry
            WHERE h.CANCELED = 'N' AND l.ItemCode IS NOT NULL GROUP BY l.ItemCode ORDER BY SUM(l.LineTotal) DESC", cancellationToken: ct))).ToList();
        return dto;
    }

    public async Task<SalesAnalyticsReportDto> GetSalesAnalyticsAsync(SalesAnalyticsQuery q, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        var today = DateTime.Today;
        var from = (q.DateFrom ?? FyStart(today)).Date;
        var to = (q.DateTo ?? today).Date;

        var p = new DynamicParameters();
        p.Add("From", from);
        p.Add("To", to);
        p.Add("PFrom", from.AddYears(-1));
        p.Add("PTo", to.AddYears(-1));
        p.Add("Customer", string.IsNullOrWhiteSpace(q.Customer) ? null : q.Customer);
        p.Add("SalesPerson", q.SalesPerson);
        p.Add("Item", string.IsNullOrWhiteSpace(q.Item) ? null : q.Item);

        // Every query reads the widened window [previous-year start, current end] and
        // splits current vs previous with conditional sums.
        const string from_ = @"
            FROM INV1 l JOIN OINV h ON h.DocEntry = l.DocEntry
            WHERE h.CANCELED = 'N' AND h.DocDate >= @PFrom AND h.DocDate <= @To
              AND (@Customer IS NULL OR h.CardCode = @Customer)
              AND (@SalesPerson IS NULL OR h.SlpCode = @SalesPerson)
              AND (@Item IS NULL OR l.ItemCode = @Item)";
        const string cur = "h.DocDate >= @From AND h.DocDate <= @To";
        const string prev = "h.DocDate >= @PFrom AND h.DocDate <= @PTo";

        var kpi = await db.QuerySingleAsync(new CommandDefinition($@"
            SELECT ISNULL(SUM(CASE WHEN {cur} THEN l.Quantity END), 0) AS Qty,
                   ISNULL(SUM(CASE WHEN {cur} THEN l.LineTotal END), 0) AS Val,
                   ISNULL(SUM(CASE WHEN {prev} THEN l.Quantity END), 0) AS PQty,
                   ISNULL(SUM(CASE WHEN {prev} THEN l.LineTotal END), 0) AS PVal
            {from_}", p, cancellationToken: ct));

        var dto = new SalesAnalyticsReportDto
        {
            DateFrom = from, DateTo = to,
            Quantity = Convert.ToDouble(kpi.Qty), Value = kpi.Val,
            PreviousQuantity = Convert.ToDouble(kpi.PQty), PreviousValue = kpi.PVal
        };
        dto.AverageRate = dto.Quantity > 0 ? Math.Round(dto.Value / (decimal)dto.Quantity, 2) : 0;
        dto.PreviousAverageRate = dto.PreviousQuantity > 0 ? Math.Round(dto.PreviousValue / (decimal)dto.PreviousQuantity, 2) : 0;

        dto.Trend = (await db.QueryAsync<AnalyticsPointDto>(new CommandDefinition($@"
            SELECT CONVERT(varchar(7), h.DocDate, 120) AS Label, SUM(l.LineTotal) AS Value, SUM(l.Quantity) AS Quantity
            {from_} AND {cur}
            GROUP BY CONVERT(varchar(7), h.DocDate, 120) ORDER BY 1", p, cancellationToken: ct))).ToList();

        dto.Customers = (await db.QueryAsync<AnalyticsComparisonDto>(new CommandDefinition($@"
            SELECT TOP 5 h.CardCode AS [Key], MAX(h.CardName) AS Name,
                   ISNULL(SUM(CASE WHEN {cur} THEN l.LineTotal END), 0) AS Value,
                   ISNULL(SUM(CASE WHEN {prev} THEN l.LineTotal END), 0) AS PreviousValue
            {from_}
            GROUP BY h.CardCode
            HAVING SUM(CASE WHEN {cur} THEN l.LineTotal END) > 0
            ORDER BY SUM(CASE WHEN {cur} THEN l.LineTotal END) DESC", p, cancellationToken: ct))).ToList();

        dto.Items = (await db.QueryAsync<AnalyticsComparisonDto>(new CommandDefinition($@"
            SELECT TOP 5 l.ItemCode AS [Key], MAX(l.Dscription) AS Name,
                   ISNULL(SUM(CASE WHEN {cur} THEN l.LineTotal END), 0) AS Value,
                   ISNULL(SUM(CASE WHEN {prev} THEN l.LineTotal END), 0) AS PreviousValue
            {from_} AND l.ItemCode IS NOT NULL
            GROUP BY l.ItemCode
            HAVING SUM(CASE WHEN {cur} THEN l.LineTotal END) > 0
            ORDER BY SUM(CASE WHEN {cur} THEN l.LineTotal END) DESC", p, cancellationToken: ct))).ToList();

        return dto;
    }

    // ---------------------------------------------------------------
    // TURNOVER BREAKUP — same sales definition as the Sales Dashboard (A/R
    // invoices, CANCELED = 'N', header DocTotal incl. GST). Location lives on
    // the invoice LINE and Branch on the header, so each invoice's DocTotal is
    // spread over its lines in proportion to line GTotal (equal split if every
    // line is zero). Filtering/grouping by location therefore still sums to the
    // exact DocTotal. One aggregate query; group totals and the grand total are
    // rolled up from it so every figure is consistent.
    // ---------------------------------------------------------------
    public async Task<TurnoverBreakupDto> GetTurnoverBreakupAsync(TurnoverQuery q, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        var today = DateTime.Today;
        var from = (q.DateFrom ?? FyStart(today)).Date;
        var to = (q.DateTo ?? today).Date;

        var p = new DynamicParameters();
        p.Add("From", from);
        p.Add("To", to);
        p.Add("Group", q.CustomerGroup);
        p.Add("Location", q.Location);
        p.Add("Branch", q.Branch);
        p.Add("Unassigned", "(Not assigned)");

        const string sql = @"
            WITH alloc AS (
                SELECT h.BPLId, c.GroupCode, l.LocCode,
                       CASE WHEN SUM(l.GTotal) OVER (PARTITION BY l.DocEntry) <> 0
                            THEN h.DocTotal * l.GTotal / SUM(l.GTotal) OVER (PARTITION BY l.DocEntry)
                            ELSE h.DocTotal / COUNT(*) OVER (PARTITION BY l.DocEntry) END AS Amt
                FROM OINV h
                JOIN INV1 l ON l.DocEntry = h.DocEntry
                LEFT JOIN OCRD c ON c.CardCode = h.CardCode
                WHERE h.CANCELED = 'N' AND h.DocDate >= @From AND h.DocDate <= @To
            )
            SELECT ISNULL(g.GroupName, @Unassigned) AS CustomerGroup,
                   ISNULL(lc.Location, @Unassigned) AS Location,
                   ISNULL(b.BPLName, @Unassigned) AS Branch,
                   SUM(a.Amt) AS SalesValue
            FROM alloc a
            LEFT JOIN OCRG g ON g.GroupCode = a.GroupCode
            LEFT JOIN OLCT lc ON lc.Code = a.LocCode
            LEFT JOIN OBPL b ON b.BPLId = a.BPLId
            WHERE (@Group IS NULL OR a.GroupCode = @Group)
              AND (@Location IS NULL OR a.LocCode = @Location)
              AND (@Branch IS NULL OR a.BPLId = @Branch)
            GROUP BY ISNULL(g.GroupName, @Unassigned), ISNULL(lc.Location, @Unassigned), ISNULL(b.BPLName, @Unassigned)
            HAVING SUM(a.Amt) <> 0
            ORDER BY SUM(a.Amt) DESC;

            SELECT GroupCode AS Code, GroupName AS Name FROM OCRG WHERE GroupType = 'C' ORDER BY GroupName;
            SELECT Code, Location AS Name FROM OLCT ORDER BY Location;
            SELECT BPLId AS Code, BPLName AS Name FROM OBPL ORDER BY BPLName;";

        using var multi = await db.QueryMultipleAsync(new CommandDefinition(sql, p, cancellationToken: ct));
        var rows = (await multi.ReadAsync<TurnoverGroupLocationBranchDto>()).ToList();

        var dto = new TurnoverBreakupDto
        {
            DateFrom = from, DateTo = to,
            GroupLocationBranchSales = rows,
            CustomerGroups = (await multi.ReadAsync<TurnoverOptionDto>()).ToList(),
            Locations = (await multi.ReadAsync<TurnoverOptionDto>()).ToList(),
            Branches = (await multi.ReadAsync<TurnoverOptionDto>()).ToList()
        };

        foreach (var r in rows) r.SalesValue = Math.Round(r.SalesValue, 2);
        dto.TotalTurnover = rows.Sum(r => r.SalesValue);
        decimal Pct(decimal v) => dto.TotalTurnover != 0 ? Math.Round(v / dto.TotalTurnover * 100, 2) : 0;
        foreach (var r in rows) r.Percentage = Pct(r.SalesValue);
        dto.CustomerGroupSales = rows
            .GroupBy(r => r.CustomerGroup)
            .Select(g => { var v = g.Sum(x => x.SalesValue); return new TurnoverGroupDto { CustomerGroup = g.Key, SalesValue = v, Percentage = Pct(v) }; })
            .OrderByDescending(g => g.SalesValue)
            .ToList();
        return dto;
    }
}
