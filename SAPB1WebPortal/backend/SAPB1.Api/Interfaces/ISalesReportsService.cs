using SAPB1.Api.DTOs.Sales;

namespace SAPB1.Api.Interfaces;

/// <summary>Read-only data behind the Sales → Reports pages and the Sales Dashboard sections.</summary>
public interface ISalesReportsService
{
    Task<InvoiceRegisterDto> GetInvoiceRegisterAsync(InvoiceRegisterQuery query, CancellationToken ct = default);
    Task<CustomerOutstandingDto> GetCustomerOutstandingAsync(CancellationToken ct = default);
    Task<List<CustomerLookupDto>> LookupCustomersAsync(string? search, CancellationToken ct = default);
    Task<CustomerLedgerDto?> GetCustomerLedgerAsync(string customer, DateTime? from, DateTime? to, CancellationToken ct = default);
    Task<SalesAnalyticsOptionsDto> GetAnalyticsOptionsAsync(CancellationToken ct = default);
    Task<SalesAnalyticsReportDto> GetSalesAnalyticsAsync(SalesAnalyticsQuery query, CancellationToken ct = default);
    Task<TurnoverBreakupDto> GetTurnoverBreakupAsync(TurnoverQuery query, CancellationToken ct = default);
}
