using SAPB1.Api.DTOs.Common;
using SAPB1.Api.DTOs.Sales;

namespace SAPB1.Api.Interfaces;

/// <summary>
/// Read-only access to the SAP B1 Sales document chain (Quotation → Order →
/// Delivery → A/R Invoice → A/R Credit Memo / Incoming Payment), for the
/// company the current request is authenticated against (see
/// ICompanyConnectionFactory — every method here runs against that company,
/// never anything a client could choose per-request). No write operations —
/// see the class-level docs on the implementation for why.
/// </summary>
public interface ISalesService
{
    Task<SalesDashboardDto> GetDashboardAsync(CancellationToken ct = default);
    Task<SalesAnalyticsDto> GetAnalyticsAsync(CancellationToken ct = default);
    Task<SalesOverviewDto> GetOverviewAsync(CancellationToken ct = default);
    Task<OpenSalesOrdersDto> GetOpenOrdersBoardAsync(string? filter, string? search, int page, int pageSize, CancellationToken ct = default);

    Task<PagedResult<SalesQuotationDto>> GetQuotationsAsync(SalesDocumentQuery query, CancellationToken ct = default);
    Task<SalesQuotationDetailDto?> GetQuotationByEntryAsync(int docEntry, CancellationToken ct = default);

    Task<PagedResult<SalesOrderDto>> GetOrdersAsync(SalesDocumentQuery query, CancellationToken ct = default);
    Task<SalesOrderDetailDto?> GetOrderByEntryAsync(int docEntry, CancellationToken ct = default);

    Task<PagedResult<DeliveryDto>> GetDeliveriesAsync(SalesDocumentQuery query, CancellationToken ct = default);
    Task<DeliveryDetailDto?> GetDeliveryByEntryAsync(int docEntry, CancellationToken ct = default);

    Task<PagedResult<ArInvoiceDto>> GetInvoicesAsync(SalesDocumentQuery query, CancellationToken ct = default);
    Task<ArInvoiceDetailDto?> GetInvoiceByEntryAsync(int docEntry, CancellationToken ct = default);

    Task<PagedResult<ArCreditMemoDto>> GetCreditMemosAsync(SalesDocumentQuery query, CancellationToken ct = default);
    Task<ArCreditMemoDetailDto?> GetCreditMemoByEntryAsync(int docEntry, CancellationToken ct = default);

    Task<PagedResult<IncomingPaymentDto>> GetPaymentsAsync(SalesDocumentQuery query, CancellationToken ct = default);
    Task<IncomingPaymentDetailDto?> GetPaymentByEntryAsync(int docEntry, CancellationToken ct = default);
}
