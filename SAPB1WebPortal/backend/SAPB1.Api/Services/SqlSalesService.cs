using System.Data;
using Dapper;
using SAPB1.Api.DTOs.Common;
using SAPB1.Api.DTOs.Sales;
using SAPB1.Api.Interfaces;

namespace SAPB1.Api.Services;

/// <summary>
/// Read-only SQL implementation of the SAP B1 Sales document chain, using the
/// same pattern as SqlSapB1Service/SqlPurchaseService: direct, parameterized
/// Dapper queries against whichever company ICompanyConnectionFactory
/// resolves for the current request. Deliberately READ-ONLY — writing sales
/// documents needs to go through SAP B1's own business logic, numbering and
/// approval rules (Service Layer/DI API), which direct SQL cannot safely
/// replicate; see ISapB1Service's XML docs for the same rationale applied to
/// Phase 1, and SqlPurchaseService for the identical rationale on Purchase.
///
/// TABLES USED (verified against this project's actual STEST company
/// database via INFORMATION_SCHEMA.COLUMNS before writing any query here —
/// column names are NOT assumed from generic SAP B1 documentation):
///
///   OQUT/QUT1  Sales Quotation header/lines
///   ORDR/RDR1  Sales Order header/lines
///   ODLN/DLN1  Delivery header/lines
///   OINV/INV1  A/R Invoice header/lines
///   ORIN/RIN1  A/R Credit Memo header/lines
///   ORCT       Incoming Payment header (customer payments; no DocType split
///              like OVPM since ORCT is customer-only by definition)
///   RCT2       Payment-to-invoice application/reconciliation lines
///   OCRD       Business Partners (customer code/name)
///   OSLP       Sales Employees
///   OWHS       Warehouses
///
/// Every header table here (OQUT/ORDR/ODLN/OINV/ORIN) uses the exact same
/// standard SAP B1 marketing-document column names already relied on by
/// SqlPurchaseService (DocEntry, DocNum, CardCode, CardName, DocDate,
/// DocDueDate, DocStatus, DocTotal, DocCur, SlpCode, Comments, VatSum,
/// DiscSum, PaidToDate, ObjType, CANCELED) — confirmed identical column-by-
/// column against this database, not assumed from memory.
///
/// Document relationships (BaseType/BaseEntry/BaseLine, TargetType/TrgetEntry)
/// use the standard, version-stable SAP B1 DI API BoObjectTypes object-type
/// codes (the same numbering family already confirmed correct in this exact
/// installation by SqlPurchaseService for Purchase Order=22/GRPO=20/A P
/// Invoice=18/A P Credit Memo=19). Sales Order=17 is additionally confirmed
/// directly against real data in this database (SELECT DISTINCT ObjType FROM
/// ORDR); Quotation=23/Delivery=15/Invoice=13/Credit Memo=14 follow the same
/// stable numbering but had zero rows across every configured company
/// database at verification time, so — exactly like SqlPurchaseService's
/// ORPC=19 note — they are included for completeness but unverified against
/// real data here. A controlled gap, not a crash: if a company's data uses a
/// different code, that document's related-document links simply won't
/// resolve.
/// </summary>
public class SqlSalesService : ISalesService
{
    private readonly ICompanyConnectionFactory _connectionFactory;
    private readonly ILogger<SqlSalesService> _logger;

    public SqlSalesService(ICompanyConnectionFactory connectionFactory, ILogger<SqlSalesService> logger)
    {
        _connectionFactory = connectionFactory;
        _logger = logger;
    }

    private static readonly Dictionary<int, (string Label, string Route, string HeaderTable, string LineTable)> DocTypeMap = new()
    {
        [23] = ("Sales Quotation", "quotations", "OQUT", "QUT1"),
        [17] = ("Sales Order", "orders", "ORDR", "RDR1"),
        [15] = ("Delivery", "deliveries", "ODLN", "DLN1"),
        [13] = ("A/R Invoice", "invoices", "OINV", "INV1"),
        [14] = ("A/R Credit Memo", "credit-memos", "ORIN", "RIN1")
    };

    private static string MapStatus(string? docStatus) => docStatus switch
    {
        "O" => "Open",
        "C" => "Closed",
        _ => docStatus ?? "Unknown"
    };

    // ---------------------------------------------------------------
    // Shared filter builder — every list query below uses the same
    // search/date/status/customer/salesEmployee/warehouse parameters, always
    // bound through Dapper parameters, never string-concatenated.
    // ---------------------------------------------------------------
    private static (string WhereSql, DynamicParameters Parameters) BuildFilters(
        SalesDocumentQuery query, bool includeSalesEmployee, bool includeWarehouseExists, string? lineTableForWarehouse)
    {
        var statusCode = query.Status?.Trim().ToLowerInvariant() switch
        {
            "open" => "O",
            "closed" => "C",
            _ => (string?)null
        };

        var sql = @"
            WHERE (@Search IS NULL OR CAST(c.DocNum AS NVARCHAR(20)) LIKE @SearchLike
                   OR c.CardCode LIKE @SearchLike OR cust.CardName LIKE @SearchLike)
              AND (@DateFrom IS NULL OR c.DocDate >= @DateFrom)
              AND (@DateTo IS NULL OR c.DocDate <= @DateTo)
              AND (@Status IS NULL OR c.DocStatus = @Status)
              AND (@Customer IS NULL OR c.CardCode = @Customer)";

        if (includeSalesEmployee)
        {
            sql += " AND (@SalesEmployee IS NULL OR c.SlpCode = @SalesEmployeeCode)";
        }

        if (includeWarehouseExists && lineTableForWarehouse is not null)
        {
            sql += $" AND (@Warehouse IS NULL OR EXISTS (SELECT 1 FROM {lineTableForWarehouse} l WHERE l.DocEntry = c.DocEntry AND l.WhsCode = @Warehouse))";
        }

        var p = new DynamicParameters();
        p.Add("Search", query.Search);
        p.Add("SearchLike", query.Search is null ? null : $"%{query.Search}%");
        p.Add("DateFrom", query.DateFrom);
        p.Add("DateTo", query.DateTo);
        p.Add("Status", statusCode);
        p.Add("Customer", query.Customer);
        p.Add("SalesEmployee", query.SalesEmployee);
        p.Add("SalesEmployeeCode", query.SalesEmployee);
        p.Add("Warehouse", query.Warehouse);
        p.Add("Skip", query.Skip);
        p.Add("PageSize", query.PageSize);
        return (sql, p);
    }

    // ---------------------------------------------------------------
    // Document relationships — resolved from the real BaseType/BaseEntry
    // (what this document was created from) and a reverse search across
    // every other document type's line table (what was created FROM this
    // document), using only the object-type codes verified in DocTypeMap.
    // ---------------------------------------------------------------
    private async Task<List<RelatedDocumentDto>> GetRelatedDocumentsAsync(
        IDbConnection db, string lineTable, int docEntry, int thisObjType, CancellationToken ct)
    {
        var related = new List<RelatedDocumentDto>();

        var baseSql = $@"SELECT DISTINCT BaseType, BaseEntry FROM {lineTable}
                          WHERE DocEntry = @DocEntry AND BaseType IS NOT NULL AND BaseEntry IS NOT NULL AND BaseEntry >= 0";
        var bases = (await db.QueryAsync<(int BaseType, int BaseEntry)>(
            new CommandDefinition(baseSql, new { DocEntry = docEntry }, cancellationToken: ct))).Distinct();

        foreach (var b in bases)
        {
            if (!DocTypeMap.TryGetValue(b.BaseType, out var info)) continue;
            var docNum = await db.ExecuteScalarAsync<int?>(
                new CommandDefinition($"SELECT DocNum FROM {info.HeaderTable} WHERE DocEntry = @E", new { E = b.BaseEntry }, cancellationToken: ct));
            if (docNum is null) continue;
            related.Add(new RelatedDocumentDto { DocumentType = info.Label, DocEntry = b.BaseEntry, DocNum = docNum.Value, RouteSegment = info.Route, Direction = "Base" });
        }

        foreach (var (_, info) in DocTypeMap)
        {
            var targetSql = $@"SELECT DISTINCT DocEntry FROM {info.LineTable} WHERE BaseType = @ThisType AND BaseEntry = @DocEntry";
            var targetEntries = await db.QueryAsync<int>(
                new CommandDefinition(targetSql, new { ThisType = thisObjType, DocEntry = docEntry }, cancellationToken: ct));
            foreach (var entry in targetEntries)
            {
                var docNum = await db.ExecuteScalarAsync<int?>(
                    new CommandDefinition($"SELECT DocNum FROM {info.HeaderTable} WHERE DocEntry = @E", new { E = entry }, cancellationToken: ct));
                if (docNum is null) continue;
                related.Add(new RelatedDocumentDto { DocumentType = info.Label, DocEntry = entry, DocNum = docNum.Value, RouteSegment = info.Route, Direction = "Target" });
            }
        }

        return related;
    }

    // ---------------------------------------------------------------
    // SALES QUOTATIONS (OQUT / QUT1)
    // ---------------------------------------------------------------
    public async Task<PagedResult<SalesQuotationDto>> GetQuotationsAsync(SalesDocumentQuery query, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        var (whereSql, p) = BuildFilters(query, includeSalesEmployee: true, includeWarehouseExists: true, lineTableForWarehouse: "QUT1");

        var countSql = $"SELECT COUNT(*) FROM OQUT c LEFT JOIN OCRD cust ON cust.CardCode = c.CardCode {whereSql}";
        var total = await db.ExecuteScalarAsync<int>(new CommandDefinition(countSql, p, cancellationToken: ct));

        var listSql = $@"
            SELECT c.DocEntry, c.DocNum, c.CardCode AS CustomerCode, cust.CardName AS CustomerName,
                   c.DocDate AS PostingDate, c.DocDueDate AS DueDate, s.SlpName AS SalesEmployee,
                   c.DocStatus AS Status, c.DocTotal AS Total, c.DocCur AS Currency
            FROM OQUT c
            LEFT JOIN OCRD cust ON cust.CardCode = c.CardCode
            LEFT JOIN OSLP s ON s.SlpCode = c.SlpCode
            {whereSql}
            ORDER BY c.DocDate DESC, c.DocEntry DESC
            OFFSET @Skip ROWS FETCH NEXT @PageSize ROWS ONLY";

        var rows = (await db.QueryAsync(new CommandDefinition(listSql, p, cancellationToken: ct))).ToList();
        var items = rows.Select(r => new SalesQuotationDto
        {
            DocEntry = r.DocEntry, DocNum = r.DocNum, CustomerCode = r.CustomerCode, CustomerName = r.CustomerName,
            PostingDate = r.PostingDate, DueDate = r.DueDate, SalesEmployee = r.SalesEmployee,
            Status = MapStatus(r.Status), Total = r.Total, Currency = r.Currency
        }).ToList();

        return new PagedResult<SalesQuotationDto> { Items = items, Page = query.Page, PageSize = query.PageSize, TotalCount = total };
    }

    public async Task<SalesQuotationDetailDto?> GetQuotationByEntryAsync(int docEntry, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();

        const string headerSql = @"
            SELECT c.DocEntry, c.DocNum, c.CardCode AS CustomerCode, cust.CardName AS CustomerName,
                   c.DocDate AS PostingDate, c.DocDueDate AS DueDate, s.SlpName AS SalesEmployee,
                   c.DocStatus AS Status, c.Comments AS Remarks, c.DocCur AS Currency,
                   c.DocTotal AS GrandTotal, c.VatSum AS Tax, c.DiscSum AS Discount
            FROM OQUT c
            LEFT JOIN OCRD cust ON cust.CardCode = c.CardCode
            LEFT JOIN OSLP s ON s.SlpCode = c.SlpCode
            WHERE c.DocEntry = @DocEntry";
        var header = await db.QuerySingleOrDefaultAsync(new CommandDefinition(headerSql, new { DocEntry = docEntry }, cancellationToken: ct));
        if (header is null) return null;

        const string linesSql = @"
            SELECT l.LineNum, l.ItemCode, i.ItemName, l.Quantity, NULL AS OpenQuantity, NULL AS DeliveredQuantity, NULL AS OrderedQuantity,
                   l.WhsCode AS Warehouse, l.Price, l.DiscPrcnt AS DiscountPercent, l.TaxCode, l.LineTotal
            FROM QUT1 l
            LEFT JOIN OITM i ON i.ItemCode = l.ItemCode
            WHERE l.DocEntry = @DocEntry
            ORDER BY l.LineNum";
        var lines = (await db.QueryAsync<SalesDocumentLineDto>(new CommandDefinition(linesSql, new { DocEntry = docEntry }, cancellationToken: ct))).ToList();

        var related = await GetRelatedDocumentsAsync(db, "QUT1", docEntry, thisObjType: 23, ct);

        return new SalesQuotationDetailDto
        {
            DocEntry = header.DocEntry, DocNum = header.DocNum, CustomerCode = header.CustomerCode, CustomerName = header.CustomerName,
            PostingDate = header.PostingDate, DueDate = header.DueDate, SalesEmployee = header.SalesEmployee,
            Status = MapStatus(header.Status), Remarks = header.Remarks, Currency = header.Currency,
            GrandTotal = header.GrandTotal, Tax = header.Tax, Discount = header.Discount,
            Subtotal = header.GrandTotal + header.Discount - header.Tax,
            Lines = lines, RelatedDocuments = related
        };
    }

    // ---------------------------------------------------------------
    // SALES ORDERS (ORDR / RDR1)
    // ---------------------------------------------------------------
    public async Task<PagedResult<SalesOrderDto>> GetOrdersAsync(SalesDocumentQuery query, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        var (whereSql, p) = BuildFilters(query, includeSalesEmployee: true, includeWarehouseExists: true, lineTableForWarehouse: "RDR1");

        var countSql = $"SELECT COUNT(*) FROM ORDR c LEFT JOIN OCRD cust ON cust.CardCode = c.CardCode {whereSql}";
        var total = await db.ExecuteScalarAsync<int>(new CommandDefinition(countSql, p, cancellationToken: ct));

        var listSql = $@"
            SELECT c.DocEntry, c.DocNum, c.CardCode AS CustomerCode, cust.CardName AS CustomerName,
                   c.DocDate AS PostingDate, c.DocDueDate AS DueDate, s.SlpName AS SalesEmployee,
                   c.DocStatus AS Status, c.DocTotal AS Total, c.DocCur AS Currency
            FROM ORDR c
            LEFT JOIN OCRD cust ON cust.CardCode = c.CardCode
            LEFT JOIN OSLP s ON s.SlpCode = c.SlpCode
            {whereSql}
            ORDER BY c.DocDate DESC, c.DocEntry DESC
            OFFSET @Skip ROWS FETCH NEXT @PageSize ROWS ONLY";

        var rows = (await db.QueryAsync(new CommandDefinition(listSql, p, cancellationToken: ct))).ToList();
        var items = rows.Select(r => new SalesOrderDto
        {
            DocEntry = r.DocEntry, DocNum = r.DocNum, CustomerCode = r.CustomerCode, CustomerName = r.CustomerName,
            PostingDate = r.PostingDate, DueDate = r.DueDate, SalesEmployee = r.SalesEmployee,
            Status = MapStatus(r.Status), Total = r.Total, Currency = r.Currency
        }).ToList();

        return new PagedResult<SalesOrderDto> { Items = items, Page = query.Page, PageSize = query.PageSize, TotalCount = total };
    }

    public async Task<SalesOrderDetailDto?> GetOrderByEntryAsync(int docEntry, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();

        const string headerSql = @"
            SELECT c.DocEntry, c.DocNum, c.CardCode AS CustomerCode, cust.CardName AS CustomerName,
                   c.DocDate AS PostingDate, c.DocDueDate AS DueDate, s.SlpName AS SalesEmployee,
                   c.DocStatus AS Status, c.Comments AS Remarks, c.DocCur AS Currency,
                   c.DocTotal AS GrandTotal, c.VatSum AS Tax, c.DiscSum AS Discount
            FROM ORDR c
            LEFT JOIN OCRD cust ON cust.CardCode = c.CardCode
            LEFT JOIN OSLP s ON s.SlpCode = c.SlpCode
            WHERE c.DocEntry = @DocEntry";
        var header = await db.QuerySingleOrDefaultAsync(new CommandDefinition(headerSql, new { DocEntry = docEntry }, cancellationToken: ct));
        if (header is null) return null;

        const string linesSql = @"
            SELECT l.LineNum, l.ItemCode, i.ItemName, l.Quantity, l.OpenQty AS OpenQuantity, l.DelivrdQty AS DeliveredQuantity, NULL AS OrderedQuantity,
                   l.WhsCode AS Warehouse, l.Price, l.DiscPrcnt AS DiscountPercent, l.TaxCode, l.LineTotal
            FROM RDR1 l
            LEFT JOIN OITM i ON i.ItemCode = l.ItemCode
            WHERE l.DocEntry = @DocEntry
            ORDER BY l.LineNum";
        var lines = (await db.QueryAsync<SalesDocumentLineDto>(new CommandDefinition(linesSql, new { DocEntry = docEntry }, cancellationToken: ct))).ToList();

        var related = await GetRelatedDocumentsAsync(db, "RDR1", docEntry, thisObjType: 17, ct);

        return new SalesOrderDetailDto
        {
            DocEntry = header.DocEntry, DocNum = header.DocNum, CustomerCode = header.CustomerCode, CustomerName = header.CustomerName,
            PostingDate = header.PostingDate, DueDate = header.DueDate, SalesEmployee = header.SalesEmployee,
            Status = MapStatus(header.Status), Remarks = header.Remarks, Currency = header.Currency,
            GrandTotal = header.GrandTotal, Tax = header.Tax, Discount = header.Discount,
            Subtotal = header.GrandTotal + header.Discount - header.Tax,
            Lines = lines, RelatedDocuments = related
        };
    }

    // ---------------------------------------------------------------
    // DELIVERIES (ODLN / DLN1)
    // ---------------------------------------------------------------
    public async Task<PagedResult<DeliveryDto>> GetDeliveriesAsync(SalesDocumentQuery query, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        var (whereSql, p) = BuildFilters(query, includeSalesEmployee: true, includeWarehouseExists: true, lineTableForWarehouse: "DLN1");

        var countSql = $"SELECT COUNT(*) FROM ODLN c LEFT JOIN OCRD cust ON cust.CardCode = c.CardCode {whereSql}";
        var total = await db.ExecuteScalarAsync<int>(new CommandDefinition(countSql, p, cancellationToken: ct));

        var listSql = $@"
            SELECT c.DocEntry, c.DocNum, c.CardCode AS CustomerCode, cust.CardName AS CustomerName,
                   c.DocDate AS PostingDate, c.DocDueDate AS DueDate, s.SlpName AS SalesEmployee,
                   (SELECT TOP 1 l.WhsCode FROM DLN1 l WHERE l.DocEntry = c.DocEntry ORDER BY l.LineNum) AS Warehouse,
                   c.DocStatus AS Status, c.DocTotal AS Total, c.DocCur AS Currency
            FROM ODLN c
            LEFT JOIN OCRD cust ON cust.CardCode = c.CardCode
            LEFT JOIN OSLP s ON s.SlpCode = c.SlpCode
            {whereSql}
            ORDER BY c.DocDate DESC, c.DocEntry DESC
            OFFSET @Skip ROWS FETCH NEXT @PageSize ROWS ONLY";

        var rows = (await db.QueryAsync(new CommandDefinition(listSql, p, cancellationToken: ct))).ToList();
        var items = rows.Select(r => new DeliveryDto
        {
            DocEntry = r.DocEntry, DocNum = r.DocNum, CustomerCode = r.CustomerCode, CustomerName = r.CustomerName,
            PostingDate = r.PostingDate, DueDate = r.DueDate, SalesEmployee = r.SalesEmployee, Warehouse = r.Warehouse,
            Status = MapStatus(r.Status), Total = r.Total, Currency = r.Currency
        }).ToList();

        return new PagedResult<DeliveryDto> { Items = items, Page = query.Page, PageSize = query.PageSize, TotalCount = total };
    }

    public async Task<DeliveryDetailDto?> GetDeliveryByEntryAsync(int docEntry, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();

        const string headerSql = @"
            SELECT c.DocEntry, c.DocNum, c.CardCode AS CustomerCode, cust.CardName AS CustomerName,
                   c.DocDate AS PostingDate, c.DocDueDate AS DueDate, s.SlpName AS SalesEmployee,
                   c.DocStatus AS Status, c.Comments AS Remarks, c.DocCur AS Currency,
                   c.DocTotal AS GrandTotal, c.VatSum AS Tax, c.DiscSum AS Discount
            FROM ODLN c
            LEFT JOIN OCRD cust ON cust.CardCode = c.CardCode
            LEFT JOIN OSLP s ON s.SlpCode = c.SlpCode
            WHERE c.DocEntry = @DocEntry";
        var header = await db.QuerySingleOrDefaultAsync(new CommandDefinition(headerSql, new { DocEntry = docEntry }, cancellationToken: ct));
        if (header is null) return null;

        const string linesSql = @"
            SELECT l.LineNum, l.ItemCode, i.ItemName, l.Quantity, l.OpenQty AS OpenQuantity, l.DelivrdQty AS DeliveredQuantity, l.OrderedQty AS OrderedQuantity,
                   l.WhsCode AS Warehouse, l.Price, l.DiscPrcnt AS DiscountPercent, l.TaxCode, l.LineTotal
            FROM DLN1 l
            LEFT JOIN OITM i ON i.ItemCode = l.ItemCode
            WHERE l.DocEntry = @DocEntry
            ORDER BY l.LineNum";
        var lines = (await db.QueryAsync<SalesDocumentLineDto>(new CommandDefinition(linesSql, new { DocEntry = docEntry }, cancellationToken: ct))).ToList();

        var related = await GetRelatedDocumentsAsync(db, "DLN1", docEntry, thisObjType: 15, ct);

        return new DeliveryDetailDto
        {
            DocEntry = header.DocEntry, DocNum = header.DocNum, CustomerCode = header.CustomerCode, CustomerName = header.CustomerName,
            PostingDate = header.PostingDate, DueDate = header.DueDate, SalesEmployee = header.SalesEmployee,
            Status = MapStatus(header.Status), Remarks = header.Remarks, Currency = header.Currency,
            GrandTotal = header.GrandTotal, Tax = header.Tax, Discount = header.Discount,
            Subtotal = header.GrandTotal + header.Discount - header.Tax,
            Lines = lines, RelatedDocuments = related
        };
    }

    // ---------------------------------------------------------------
    // A/R INVOICES (OINV / INV1)
    // ---------------------------------------------------------------
    public async Task<PagedResult<ArInvoiceDto>> GetInvoicesAsync(SalesDocumentQuery query, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        var (whereSql, p) = BuildFilters(query, includeSalesEmployee: true, includeWarehouseExists: true, lineTableForWarehouse: "INV1");

        var countSql = $"SELECT COUNT(*) FROM OINV c LEFT JOIN OCRD cust ON cust.CardCode = c.CardCode {whereSql}";
        var total = await db.ExecuteScalarAsync<int>(new CommandDefinition(countSql, p, cancellationToken: ct));

        var listSql = $@"
            SELECT c.DocEntry, c.DocNum, c.CardCode AS CustomerCode, cust.CardName AS CustomerName,
                   c.DocDate AS PostingDate, c.DocDueDate AS DueDate, s.SlpName AS SalesEmployee,
                   c.DocStatus AS Status, c.DocTotal AS Total, c.PaidToDate AS Paid, c.DocCur AS Currency
            FROM OINV c
            LEFT JOIN OCRD cust ON cust.CardCode = c.CardCode
            LEFT JOIN OSLP s ON s.SlpCode = c.SlpCode
            {whereSql}
            ORDER BY c.DocDate DESC, c.DocEntry DESC
            OFFSET @Skip ROWS FETCH NEXT @PageSize ROWS ONLY";

        var rows = (await db.QueryAsync(new CommandDefinition(listSql, p, cancellationToken: ct))).ToList();
        var items = rows.Select(r => new ArInvoiceDto
        {
            DocEntry = r.DocEntry, DocNum = r.DocNum, CustomerCode = r.CustomerCode, CustomerName = r.CustomerName,
            PostingDate = r.PostingDate, DueDate = r.DueDate, SalesEmployee = r.SalesEmployee,
            Status = MapStatus(r.Status), Total = r.Total, Paid = r.Paid, Balance = r.Total - r.Paid, Currency = r.Currency
        }).ToList();

        return new PagedResult<ArInvoiceDto> { Items = items, Page = query.Page, PageSize = query.PageSize, TotalCount = total };
    }

    public async Task<ArInvoiceDetailDto?> GetInvoiceByEntryAsync(int docEntry, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();

        const string headerSql = @"
            SELECT c.DocEntry, c.DocNum, c.CardCode AS CustomerCode, cust.CardName AS CustomerName,
                   c.DocDate AS PostingDate, c.DocDueDate AS DueDate, s.SlpName AS SalesEmployee,
                   c.DocStatus AS Status, c.Comments AS Remarks, c.DocCur AS Currency,
                   c.DocTotal AS GrandTotal, c.VatSum AS Tax, c.DiscSum AS Discount, c.PaidToDate AS Paid
            FROM OINV c
            LEFT JOIN OCRD cust ON cust.CardCode = c.CardCode
            LEFT JOIN OSLP s ON s.SlpCode = c.SlpCode
            WHERE c.DocEntry = @DocEntry";
        var header = await db.QuerySingleOrDefaultAsync(new CommandDefinition(headerSql, new { DocEntry = docEntry }, cancellationToken: ct));
        if (header is null) return null;

        const string linesSql = @"
            SELECT l.LineNum, l.ItemCode, i.ItemName, l.Quantity, NULL AS OpenQuantity, NULL AS DeliveredQuantity, NULL AS OrderedQuantity,
                   l.WhsCode AS Warehouse, l.Price, l.DiscPrcnt AS DiscountPercent, l.TaxCode, l.LineTotal
            FROM INV1 l
            LEFT JOIN OITM i ON i.ItemCode = l.ItemCode
            WHERE l.DocEntry = @DocEntry
            ORDER BY l.LineNum";
        var lines = (await db.QueryAsync<SalesDocumentLineDto>(new CommandDefinition(linesSql, new { DocEntry = docEntry }, cancellationToken: ct))).ToList();

        var related = await GetRelatedDocumentsAsync(db, "INV1", docEntry, thisObjType: 13, ct);

        return new ArInvoiceDetailDto
        {
            DocEntry = header.DocEntry, DocNum = header.DocNum, CustomerCode = header.CustomerCode, CustomerName = header.CustomerName,
            PostingDate = header.PostingDate, DueDate = header.DueDate, SalesEmployee = header.SalesEmployee,
            Status = MapStatus(header.Status), Remarks = header.Remarks, Currency = header.Currency,
            GrandTotal = header.GrandTotal, Tax = header.Tax, Discount = header.Discount,
            Subtotal = header.GrandTotal + header.Discount - header.Tax,
            Paid = header.Paid, Balance = header.GrandTotal - header.Paid,
            Lines = lines, RelatedDocuments = related
        };
    }

    // ---------------------------------------------------------------
    // A/R CREDIT MEMOS (ORIN / RIN1)
    // ---------------------------------------------------------------
    public async Task<PagedResult<ArCreditMemoDto>> GetCreditMemosAsync(SalesDocumentQuery query, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        var (whereSql, p) = BuildFilters(query, includeSalesEmployee: false, includeWarehouseExists: true, lineTableForWarehouse: "RIN1");

        var countSql = $"SELECT COUNT(*) FROM ORIN c LEFT JOIN OCRD cust ON cust.CardCode = c.CardCode {whereSql}";
        var total = await db.ExecuteScalarAsync<int>(new CommandDefinition(countSql, p, cancellationToken: ct));

        var listSql = $@"
            SELECT c.DocEntry, c.DocNum, c.CardCode AS CustomerCode, cust.CardName AS CustomerName,
                   c.DocDate AS PostingDate, c.DocStatus AS Status, c.DocTotal AS Total, c.DocCur AS Currency
            FROM ORIN c
            LEFT JOIN OCRD cust ON cust.CardCode = c.CardCode
            {whereSql}
            ORDER BY c.DocDate DESC, c.DocEntry DESC
            OFFSET @Skip ROWS FETCH NEXT @PageSize ROWS ONLY";

        var rows = (await db.QueryAsync(new CommandDefinition(listSql, p, cancellationToken: ct))).ToList();
        var items = rows.Select(r => new ArCreditMemoDto
        {
            DocEntry = r.DocEntry, DocNum = r.DocNum, CustomerCode = r.CustomerCode, CustomerName = r.CustomerName,
            PostingDate = r.PostingDate, Status = MapStatus(r.Status), Total = r.Total, Currency = r.Currency
        }).ToList();

        return new PagedResult<ArCreditMemoDto> { Items = items, Page = query.Page, PageSize = query.PageSize, TotalCount = total };
    }

    public async Task<ArCreditMemoDetailDto?> GetCreditMemoByEntryAsync(int docEntry, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();

        const string headerSql = @"
            SELECT c.DocEntry, c.DocNum, c.CardCode AS CustomerCode, cust.CardName AS CustomerName,
                   c.DocDate AS PostingDate, c.DocStatus AS Status, c.Comments AS Remarks, c.DocCur AS Currency,
                   c.DocTotal AS GrandTotal, c.VatSum AS Tax, c.DiscSum AS Discount
            FROM ORIN c
            LEFT JOIN OCRD cust ON cust.CardCode = c.CardCode
            WHERE c.DocEntry = @DocEntry";
        var header = await db.QuerySingleOrDefaultAsync(new CommandDefinition(headerSql, new { DocEntry = docEntry }, cancellationToken: ct));
        if (header is null) return null;

        const string linesSql = @"
            SELECT l.LineNum, l.ItemCode, i.ItemName, l.Quantity, NULL AS OpenQuantity, NULL AS DeliveredQuantity, NULL AS OrderedQuantity,
                   l.WhsCode AS Warehouse, l.Price, l.DiscPrcnt AS DiscountPercent, l.TaxCode, l.LineTotal
            FROM RIN1 l
            LEFT JOIN OITM i ON i.ItemCode = l.ItemCode
            WHERE l.DocEntry = @DocEntry
            ORDER BY l.LineNum";
        var lines = (await db.QueryAsync<SalesDocumentLineDto>(new CommandDefinition(linesSql, new { DocEntry = docEntry }, cancellationToken: ct))).ToList();

        var related = await GetRelatedDocumentsAsync(db, "RIN1", docEntry, thisObjType: 14, ct);

        return new ArCreditMemoDetailDto
        {
            DocEntry = header.DocEntry, DocNum = header.DocNum, CustomerCode = header.CustomerCode, CustomerName = header.CustomerName,
            PostingDate = header.PostingDate, Status = MapStatus(header.Status), Remarks = header.Remarks, Currency = header.Currency,
            GrandTotal = header.GrandTotal, Tax = header.Tax, Discount = header.Discount,
            Subtotal = header.GrandTotal + header.Discount - header.Tax,
            Lines = lines, RelatedDocuments = related
        };
    }

    // ---------------------------------------------------------------
    // INCOMING PAYMENTS (ORCT; RCT2 for applications)
    // ---------------------------------------------------------------
    public async Task<PagedResult<IncomingPaymentDto>> GetPaymentsAsync(SalesDocumentQuery query, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();

        var statusCode = query.Status?.Trim().ToLowerInvariant() switch { "cancelled" => "Y", "completed" => "N", _ => (string?)null };

        const string filterSql = @"
            WHERE (@Search IS NULL OR CAST(c.DocNum AS NVARCHAR(20)) LIKE @SearchLike OR c.CardCode LIKE @SearchLike OR cust.CardName LIKE @SearchLike)
              AND (@DateFrom IS NULL OR c.DocDate >= @DateFrom)
              AND (@DateTo IS NULL OR c.DocDate <= @DateTo)
              AND (@Customer IS NULL OR c.CardCode = @Customer)
              AND (@Status IS NULL OR c.Canceled = @Status)";

        var p = new DynamicParameters();
        p.Add("Search", query.Search);
        p.Add("SearchLike", query.Search is null ? null : $"%{query.Search}%");
        p.Add("DateFrom", query.DateFrom);
        p.Add("DateTo", query.DateTo);
        p.Add("Customer", query.Customer);
        p.Add("Status", statusCode);
        p.Add("Skip", query.Skip);
        p.Add("PageSize", query.PageSize);

        var countSql = $"SELECT COUNT(*) FROM ORCT c LEFT JOIN OCRD cust ON cust.CardCode = c.CardCode {filterSql}";
        var total = await db.ExecuteScalarAsync<int>(new CommandDefinition(countSql, p, cancellationToken: ct));

        var listSql = $@"
            SELECT c.DocEntry, c.DocNum, c.CardCode AS CustomerCode, cust.CardName AS CustomerName, c.DocDate AS PostingDate,
                   c.DocTotal AS Amount, c.DocCurr AS Currency, c.Canceled,
                   CASE WHEN c.CashSum > 0 THEN 1 ELSE 0 END AS HasCash,
                   CASE WHEN c.CheckSum > 0 THEN 1 ELSE 0 END AS HasCheck,
                   CASE WHEN c.TrsfrSum > 0 THEN 1 ELSE 0 END AS HasTransfer
            FROM ORCT c
            LEFT JOIN OCRD cust ON cust.CardCode = c.CardCode
            {filterSql}
            ORDER BY c.DocDate DESC, c.DocEntry DESC
            OFFSET @Skip ROWS FETCH NEXT @PageSize ROWS ONLY";

        var rows = (await db.QueryAsync(new CommandDefinition(listSql, p, cancellationToken: ct))).ToList();
        var items = rows.Select(r => new IncomingPaymentDto
        {
            DocEntry = r.DocEntry, DocNum = r.DocNum, CustomerCode = r.CustomerCode, CustomerName = r.CustomerName,
            PostingDate = r.PostingDate, Amount = r.Amount, Currency = r.Currency,
            PaymentType = DescribePaymentType((bool)(r.HasCash == 1), (bool)(r.HasCheck == 1), (bool)(r.HasTransfer == 1)),
            Status = r.Canceled == "Y" ? "Cancelled" : "Completed"
        }).ToList();

        return new PagedResult<IncomingPaymentDto> { Items = items, Page = query.Page, PageSize = query.PageSize, TotalCount = total };
    }

    public async Task<IncomingPaymentDetailDto?> GetPaymentByEntryAsync(int docEntry, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();

        const string headerSql = @"
            SELECT c.DocEntry, c.DocNum, c.CardCode AS CustomerCode, cust.CardName AS CustomerName, c.DocDate AS PostingDate,
                   c.DocTotal AS Amount, c.DocCurr AS Currency, c.Canceled, c.Comments AS Remarks,
                   c.CashSum, c.CheckSum, c.TrsfrSum, c.TrsfrAcct AS BankAccount
            FROM ORCT c
            LEFT JOIN OCRD cust ON cust.CardCode = c.CardCode
            WHERE c.DocEntry = @DocEntry";
        var header = await db.QuerySingleOrDefaultAsync(new CommandDefinition(headerSql, new { DocEntry = docEntry }, cancellationToken: ct));
        if (header is null) return null;

        const string appliedSql = @"
            SELECT p.InvoiceId AS InvoiceDocEntry, i.DocNum AS InvoiceDocNum, p.SumApplied AS AmountApplied
            FROM RCT2 p
            LEFT JOIN OINV i ON i.DocEntry = p.InvoiceId
            WHERE p.DocEntry = @DocEntry AND p.InvoiceId IS NOT NULL AND p.InvoiceId > 0";
        var applied = (await db.QueryAsync<ArInvoiceApplicationDto>(new CommandDefinition(appliedSql, new { DocEntry = docEntry }, cancellationToken: ct))).ToList();

        return new IncomingPaymentDetailDto
        {
            DocEntry = header.DocEntry, DocNum = header.DocNum, CustomerCode = header.CustomerCode, CustomerName = header.CustomerName,
            PostingDate = header.PostingDate, Amount = header.Amount, Currency = header.Currency, Remarks = header.Remarks,
            PaymentType = DescribePaymentType((decimal)header.CashSum > 0, (decimal)header.CheckSum > 0, (decimal)header.TrsfrSum > 0),
            Status = header.Canceled == "Y" ? "Cancelled" : "Completed",
            CashAmount = header.CashSum, CheckAmount = header.CheckSum, TransferAmount = header.TrsfrSum,
            BankAccount = header.BankAccount,
            AppliedInvoices = applied
        };
    }

    private static string DescribePaymentType(bool cash, bool check, bool transfer)
    {
        var count = (cash ? 1 : 0) + (check ? 1 : 0) + (transfer ? 1 : 0);
        if (count > 1) return "Mixed";
        if (cash) return "Cash";
        if (check) return "Check";
        if (transfer) return "Bank Transfer";
        return "Other";
    }

    // ---------------------------------------------------------------
    // DASHBOARD
    // ---------------------------------------------------------------
    public async Task<SalesDashboardDto> GetDashboardAsync(CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();

        const string sql = @"
            SELECT
                (SELECT COUNT(*) FROM OQUT) AS TotalQuotations,
                (SELECT COUNT(*) FROM OQUT WHERE DocStatus = 'O') AS OpenQuotations,
                (SELECT COUNT(*) FROM ORDR) AS TotalSalesOrders,
                (SELECT COUNT(*) FROM ORDR WHERE DocStatus = 'O') AS OpenSalesOrders,
                (SELECT COUNT(*) FROM ORDR WHERE YEAR(DocDate) = YEAR(GETDATE()) AND MONTH(DocDate) = MONTH(GETDATE())) AS SalesOrdersThisMonth,
                (SELECT COUNT(*) FROM ORDR WHERE YEAR(DocDate) = YEAR(GETDATE())) AS SalesOrdersThisYear,
                (SELECT COUNT(*) FROM ODLN) AS TotalDeliveries,
                (SELECT COUNT(*) FROM ODLN WHERE DocStatus = 'O') AS PendingDeliveries,
                (SELECT COUNT(*) FROM OINV) AS TotalArInvoices,
                (SELECT COUNT(*) FROM OINV WHERE DocStatus = 'O') AS OpenArInvoices,
                (SELECT COUNT(*) FROM OINV WHERE DocStatus = 'O' AND DocDueDate < GETDATE()) AS OverdueArInvoices,
                (SELECT ISNULL(SUM(DocTotal - PaidToDate), 0) FROM OINV WHERE DocStatus = 'O') AS OutstandingReceivables,
                (SELECT ISNULL(SUM(DocTotal), 0) FROM OINV WHERE YEAR(DocDate) = YEAR(GETDATE()) AND MONTH(DocDate) = MONTH(GETDATE())) AS MonthlySalesValue,
                (SELECT ISNULL(SUM(DocTotal), 0) FROM OINV WHERE YEAR(DocDate) = YEAR(GETDATE())) AS YearlySalesValue,
                (SELECT ISNULL(SUM(DocTotal), 0) FROM ORDR WHERE DocStatus = 'O') AS OpenSalesOrderValue,
                (SELECT ISNULL(SUM(DocTotal), 0) FROM ORCT WHERE YEAR(DocDate) = YEAR(GETDATE()) AND MONTH(DocDate) = MONTH(GETDATE()) AND Canceled = 'N') AS IncomingPaymentsThisMonth";

        return await db.QuerySingleAsync<SalesDashboardDto>(new CommandDefinition(sql, cancellationToken: ct));
    }

    // ---------------------------------------------------------------
    // ANALYTICS
    // ---------------------------------------------------------------
    public async Task<SalesAnalyticsDto> GetAnalyticsAsync(CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();

        const string byMonthSql = @"
            SELECT CONVERT(varchar(7), DocDate, 120) AS Period, SUM(DocTotal) AS Value
            FROM OINV
            WHERE DocDate >= DATEADD(MONTH, -11, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
            GROUP BY CONVERT(varchar(7), DocDate, 120)
            ORDER BY Period";
        var byMonth = (await db.QueryAsync<SalesByPeriodDto>(new CommandDefinition(byMonthSql, cancellationToken: ct))).ToList();

        const string topCustomersSql = @"
            SELECT TOP 10 c.CardCode AS CustomerCode, cust.CardName AS CustomerName, SUM(c.DocTotal) AS Value
            FROM OINV c
            LEFT JOIN OCRD cust ON cust.CardCode = c.CardCode
            GROUP BY c.CardCode, cust.CardName
            ORDER BY SUM(c.DocTotal) DESC";
        var topCustomers = (await db.QueryAsync<SalesByCustomerDto>(new CommandDefinition(topCustomersSql, cancellationToken: ct))).ToList();

        const string topItemsSql = @"
            SELECT TOP 10 l.ItemCode, i.ItemName, SUM(l.LineTotal) AS Value, SUM(l.Quantity) AS Quantity
            FROM INV1 l
            LEFT JOIN OITM i ON i.ItemCode = l.ItemCode
            GROUP BY l.ItemCode, i.ItemName
            ORDER BY SUM(l.LineTotal) DESC";
        var topItems = (await db.QueryAsync<SalesByItemDto>(new CommandDefinition(topItemsSql, cancellationToken: ct))).ToList();

        const string byWarehouseSql = @"
            SELECT l.WhsCode AS WarehouseCode, w.WhsName AS WarehouseName, SUM(l.LineTotal) AS Value
            FROM INV1 l
            LEFT JOIN OWHS w ON w.WhsCode = l.WhsCode
            WHERE l.WhsCode IS NOT NULL
            GROUP BY l.WhsCode, w.WhsName
            ORDER BY SUM(l.LineTotal) DESC";
        var byWarehouse = (await db.QueryAsync<SalesByWarehouseDto>(new CommandDefinition(byWarehouseSql, cancellationToken: ct))).ToList();

        const string byEmployeeSql = @"
            SELECT TOP 10 c.SlpCode AS SalesEmployeeCode, s.SlpName AS SalesEmployeeName, SUM(c.DocTotal) AS Value
            FROM OINV c
            LEFT JOIN OSLP s ON s.SlpCode = c.SlpCode
            WHERE c.SlpCode IS NOT NULL
            GROUP BY c.SlpCode, s.SlpName
            ORDER BY SUM(c.DocTotal) DESC";
        var byEmployee = (await db.QueryAsync<SalesByEmployeeDto>(new CommandDefinition(byEmployeeSql, cancellationToken: ct))).ToList();

        const string summarySql = @"
            SELECT
                (SELECT ISNULL(SUM(DocTotal), 0) FROM OQUT WHERE DocStatus = 'O') AS OpenQuotationValue,
                (SELECT ISNULL(SUM(DocTotal), 0) FROM ORDR WHERE DocStatus = 'O') AS OpenSalesOrderValue,
                (SELECT ISNULL(SUM(DocTotal), 0) FROM ODLN WHERE DocStatus = 'O') AS OpenDeliveryValue,
                (SELECT ISNULL(SUM(DocTotal), 0) FROM OINV WHERE DocStatus = 'O') AS OpenArInvoiceValue,
                (SELECT ISNULL(SUM(DocTotal - PaidToDate), 0) FROM OINV WHERE DocStatus = 'O') AS OutstandingReceivables,
                (SELECT ISNULL(SUM(DocTotal), 0) FROM ORCT WHERE Canceled = 'N') AS IncomingPaymentsValue";
        var summary = await db.QuerySingleAsync(new CommandDefinition(summarySql, cancellationToken: ct));

        return new SalesAnalyticsDto
        {
            SalesByMonth = byMonth,
            TopCustomers = topCustomers,
            TopItems = topItems,
            SalesByWarehouse = byWarehouse,
            SalesBySalesEmployee = byEmployee,
            OpenQuotationValue = summary.OpenQuotationValue,
            OpenSalesOrderValue = summary.OpenSalesOrderValue,
            OpenDeliveryValue = summary.OpenDeliveryValue,
            OpenArInvoiceValue = summary.OpenArInvoiceValue,
            OutstandingReceivables = summary.OutstandingReceivables,
            IncomingPaymentsValue = summary.IncomingPaymentsValue
        };
    }

    // ---------------------------------------------------------------
    // SALES OVERVIEW (client-approved dashboard — stage 1)
    // Financial year runs Apr–Mar. All figures are real documents; cancelled
    // invoices (CANCELED <> 'N') are excluded.
    // ---------------------------------------------------------------
    private static (DateTime FyStart, DateTime FyEnd) CurrentFy(DateTime today)
    {
        var startYear = today.Month >= 4 ? today.Year : today.Year - 1;
        return (new DateTime(startYear, 4, 1), new DateTime(startYear + 1, 3, 31));
    }

    public async Task<SalesOverviewDto> GetOverviewAsync(CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();

        var today = DateTime.Today;
        var (fyStart, fyEnd) = CurrentFy(today);
        var prevFyStart = fyStart.AddYears(-1);
        var monthsIntoFy = (today.Year * 12 + today.Month - 1) - (fyStart.Year * 12 + fyStart.Month - 1);
        var quarterStart = fyStart.AddMonths(monthsIntoFy / 3 * 3);

        var p = new DynamicParameters();
        p.Add("FyStart", fyStart);
        p.Add("FyEnd", fyEnd);
        p.Add("PrevFyStart", prevFyStart);
        p.Add("QuarterStart", quarterStart);
        p.Add("OverdueCutoff", today.AddDays(-60));

        const string kpiSql = @"
            SELECT
                (SELECT COUNT(*) FROM OCRD WHERE CardType = 'C' AND frozenFor = 'N') AS TotalCustomers,
                (SELECT COUNT(*) FROM OCRD WHERE CardType = 'C' AND CreateDate >= @QuarterStart) AS NewCustomersThisQuarter,
                (SELECT COUNT(*) FROM ORDR WHERE DocStatus = 'O' AND CANCELED = 'N') AS OpenSalesOrders,
                (SELECT ISNULL(SUM(DocTotal), 0) FROM ORDR WHERE DocStatus = 'O' AND CANCELED = 'N') AS OpenSalesOrderValue,
                (SELECT COUNT(*) FROM ODLN WHERE DocStatus = 'O' AND CANCELED = 'N') AS PendingInvoices,
                (SELECT ISNULL(SUM(DocTotal), 0) FROM ODLN WHERE DocStatus = 'O' AND CANCELED = 'N') AS PendingInvoiceValue,
                (SELECT ISNULL(SUM(DocTotal - PaidToDate), 0) FROM OINV WHERE DocStatus = 'O' AND CANCELED = 'N') AS TotalOutstanding,
                (SELECT ISNULL(SUM(DocTotal - PaidToDate), 0) FROM OINV WHERE DocStatus = 'O' AND CANCELED = 'N' AND DocDate < @OverdueCutoff) AS OverdueOutstanding";
        var dto = await db.QuerySingleAsync<SalesOverviewDto>(new CommandDefinition(kpiSql, p, cancellationToken: ct));

        dto.FyStart = fyStart;
        dto.FyEnd = fyEnd;
        dto.FyLabel = $"FY {fyStart.Year}-{(fyEnd.Year % 100):00}";
        dto.OverdueDaysThreshold = 60;

        // Monthly: this FY vs previous FY. Value comes from headers and quantity from
        // lines in separate queries, so header totals are never multiplied by line count.
        const string monthValueSql = @"
            SELECT CONVERT(varchar(7), DocDate, 120) AS Period, SUM(DocTotal) AS Value
            FROM OINV
            WHERE CANCELED = 'N' AND DocDate >= @PrevFyStart AND DocDate <= @FyEnd
            GROUP BY CONVERT(varchar(7), DocDate, 120)";
        const string monthQtySql = @"
            SELECT CONVERT(varchar(7), h.DocDate, 120) AS Period, SUM(l.Quantity) AS Quantity
            FROM OINV h JOIN INV1 l ON l.DocEntry = h.DocEntry
            WHERE h.CANCELED = 'N' AND h.DocDate >= @PrevFyStart AND h.DocDate <= @FyEnd
            GROUP BY CONVERT(varchar(7), h.DocDate, 120)";
        var values = (await db.QueryAsync<(string Period, decimal Value)>(new CommandDefinition(monthValueSql, p, cancellationToken: ct)))
            .ToDictionary(x => x.Period, x => x.Value);
        var qtys = (await db.QueryAsync<(string Period, double Quantity)>(new CommandDefinition(monthQtySql, p, cancellationToken: ct)))
            .ToDictionary(x => x.Period, x => x.Quantity);

        for (var i = 0; i < 12; i++)
        {
            var m = fyStart.AddMonths(i);
            var key = m.ToString("yyyy-MM");
            var prevKey = m.AddYears(-1).ToString("yyyy-MM");
            dto.Monthly.Add(new SalesOverviewMonthDto
            {
                Period = key,
                Label = m.ToString("MMM"),
                Value = values.GetValueOrDefault(key),
                Quantity = qtys.GetValueOrDefault(key),
                PreviousValue = values.GetValueOrDefault(prevKey),
                PreviousQuantity = qtys.GetValueOrDefault(prevKey)
            });
        }

        const string personSql = @"
            SELECT TOP 8 h.SlpCode AS SalesEmployeeCode, s.SlpName AS SalesEmployeeName, SUM(h.DocTotal) AS Value
            FROM OINV h LEFT JOIN OSLP s ON s.SlpCode = h.SlpCode
            WHERE h.CANCELED = 'N' AND h.DocDate >= @FyStart AND h.DocDate <= @FyEnd
            GROUP BY h.SlpCode, s.SlpName
            ORDER BY SUM(h.DocTotal) DESC";
        dto.SalesPersons = (await db.QueryAsync<SalesByEmployeeDto>(new CommandDefinition(personSql, p, cancellationToken: ct))).ToList();

        const string customerSql = @"
            SELECT TOP 8 h.CardCode AS CustomerCode, MAX(h.CardName) AS CustomerName, SUM(h.DocTotal) AS Value
            FROM OINV h
            WHERE h.CANCELED = 'N' AND h.DocDate >= @FyStart AND h.DocDate <= @FyEnd
            GROUP BY h.CardCode
            ORDER BY SUM(h.DocTotal) DESC";
        dto.TopCustomers = (await db.QueryAsync<SalesByCustomerDto>(new CommandDefinition(customerSql, p, cancellationToken: ct))).ToList();

        const string itemSql = @"
            SELECT TOP 6 l.ItemCode, MAX(l.Dscription) AS ItemName, SUM(l.LineTotal) AS Value, SUM(l.Quantity) AS Quantity
            FROM INV1 l JOIN OINV h ON h.DocEntry = l.DocEntry
            WHERE h.CANCELED = 'N' AND h.DocDate >= @FyStart AND h.DocDate <= @FyEnd AND l.ItemCode IS NOT NULL
            GROUP BY l.ItemCode
            ORDER BY SUM(l.LineTotal) DESC";
        dto.TopItems = (await db.QueryAsync<SalesByItemDto>(new CommandDefinition(itemSql, p, cancellationToken: ct))).ToList();

        return dto;
    }

    /// <summary>
    /// Open sales orders with delivery progress (RDR1 open vs ordered qty) and,
    /// when a linked production order exists (OWOR.OriginType 'S' / OriginNum =
    /// the order's DocNum), production status and % complete. Companies that
    /// don't use production simply get null there — never a made-up value.
    /// </summary>
    public async Task<OpenSalesOrdersDto> GetOpenOrdersBoardAsync(string? filter, string? search, int page, int pageSize, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();

        const string sql = @"
            SELECT TOP 2000
                h.DocEntry, h.DocNum, h.DocDate AS PostingDate, h.CardCode AS CustomerCode, h.CardName AS CustomerName,
                c.City, h.DocDueDate AS Eta, h.DocTotal AS Total,
                (SELECT TOP 1 l.Dscription FROM RDR1 l WHERE l.DocEntry = h.DocEntry ORDER BY l.LineNum) AS Item,
                (SELECT TOP 1 l.unitMsr FROM RDR1 l WHERE l.DocEntry = h.DocEntry ORDER BY l.LineNum) AS Uom,
                (SELECT COUNT(*) FROM RDR1 l WHERE l.DocEntry = h.DocEntry) AS LineCount,
                (SELECT ISNULL(SUM(l.Quantity), 0) FROM RDR1 l WHERE l.DocEntry = h.DocEntry) AS OrderedQty,
                (SELECT ISNULL(SUM(l.OpenQty), 0) FROM RDR1 l WHERE l.DocEntry = h.DocEntry AND l.LineStatus = 'O') AS PendingQty,
                (SELECT COUNT(*) FROM OWOR w WHERE w.OriginType = 'S' AND w.OriginNum = h.DocNum AND w.Status <> 'C') AS ProdOrders,
                (SELECT COUNT(*) FROM OWOR w WHERE w.OriginType = 'S' AND w.OriginNum = h.DocNum AND w.Status = 'R') AS ProdReleased,
                (SELECT ISNULL(SUM(w.PlannedQty), 0) FROM OWOR w WHERE w.OriginType = 'S' AND w.OriginNum = h.DocNum AND w.Status <> 'C') AS ProdPlanned,
                (SELECT ISNULL(SUM(w.CmpltQty), 0) FROM OWOR w WHERE w.OriginType = 'S' AND w.OriginNum = h.DocNum AND w.Status <> 'C') AS ProdComplete
            FROM ORDR h
            LEFT JOIN OCRD c ON c.CardCode = h.CardCode
            WHERE h.DocStatus = 'O' AND h.CANCELED = 'N'
            ORDER BY h.DocDate DESC, h.DocEntry DESC";

        var raw = (await db.QueryAsync(new CommandDefinition(sql, cancellationToken: ct))).ToList();

        var rows = new List<OpenSalesOrderRowDto>();
        foreach (var r in raw)
        {
            double ordered = Convert.ToDouble(r.OrderedQty);
            double pending = Convert.ToDouble(r.PendingQty);
            int prodOrders = Convert.ToInt32(r.ProdOrders);
            double planned = Convert.ToDouble(r.ProdPlanned);
            double done = Convert.ToDouble(r.ProdComplete);

            string? prodStatus = null;
            double? progress = null;
            if (prodOrders > 0)
            {
                progress = planned > 0 ? Math.Min(100, Math.Round(done / planned * 100, 0)) : 0;
                prodStatus = progress >= 100 ? "Ready" : Convert.ToInt32(r.ProdReleased) > 0 ? "In Production" : "Pending";
            }

            rows.Add(new OpenSalesOrderRowDto
            {
                DocEntry = r.DocEntry, DocNum = r.DocNum, PostingDate = r.PostingDate,
                CustomerCode = r.CustomerCode, CustomerName = r.CustomerName, City = r.City,
                Item = r.Item, Uom = r.Uom, LineCount = r.LineCount,
                OrderedQty = ordered, PendingQty = pending,
                ProductionStatus = prodStatus, ProductionProgress = progress,
                Eta = r.Eta, Total = r.Total,
                DeliveryStatus = pending <= 0 ? "Dispatched" : pending >= ordered ? "Not Dispatched" : "Part Dispatched"
            });
        }

        var result = new OpenSalesOrdersDto
        {
            TotalOpen = rows.Count,
            TotalValue = rows.Sum(x => x.Total),
            InProduction = rows.Count(x => x.ProductionStatus == "In Production"),
            Ready = rows.Count(x => x.ProductionStatus == "Ready"),
            Pending = rows.Count(x => x.ProductionStatus == "Pending"),
            PartDispatched = rows.Count(x => x.DeliveryStatus == "Part Dispatched")
        };

        IEnumerable<OpenSalesOrderRowDto> filtered = rows;
        filtered = filter?.Trim().ToLowerInvariant() switch
        {
            "production" => filtered.Where(x => x.ProductionStatus == "In Production"),
            "ready" => filtered.Where(x => x.ProductionStatus == "Ready"),
            "pending" => filtered.Where(x => x.ProductionStatus == "Pending"),
            "part" => filtered.Where(x => x.DeliveryStatus == "Part Dispatched"),
            _ => filtered
        };
        if (!string.IsNullOrWhiteSpace(search))
        {
            var t = search.Trim();
            filtered = filtered.Where(x =>
                x.DocNum.ToString().Contains(t, StringComparison.OrdinalIgnoreCase)
                || (x.CustomerName?.Contains(t, StringComparison.OrdinalIgnoreCase) ?? false)
                || (x.Item?.Contains(t, StringComparison.OrdinalIgnoreCase) ?? false));
        }

        var list = filtered.ToList();
        result.TotalCount = list.Count;
        result.Rows = list.Skip((page - 1) * pageSize).Take(pageSize).ToList();
        return result;
    }
}
