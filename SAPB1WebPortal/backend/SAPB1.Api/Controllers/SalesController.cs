using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SAPB1.Api.Auth;
using SAPB1.Api.DTOs.Common;
using SAPB1.Api.DTOs.Sales;
using SAPB1.Api.Interfaces;

namespace SAPB1.Api.Controllers;

/// <summary>
/// Read-only Sales document chain (Quotation → Order → Delivery → A/R Invoice
/// → A/R Credit Memo → Incoming Payment) for whichever company the caller's
/// JWT is scoped to — see ISalesService/SqlSalesService. No write endpoints:
/// this module never creates, edits or deletes SAP B1 documents.
/// </summary>
[ApiController]
[Route("api/sales")]
// Role list relaxed to plain [Authorize] — see CustomersController for why.
[Authorize]
[RequirePermission("Sales.View")]
public class SalesController : ControllerBase
{
    private readonly ISalesService _salesService;

    public SalesController(ISalesService salesService)
    {
        _salesService = salesService;
    }

    [HttpGet("dashboard")]
    public async Task<ActionResult<ApiResponse<SalesDashboardDto>>> GetDashboard(CancellationToken ct)
    {
        var result = await _salesService.GetDashboardAsync(ct);
        return Ok(ApiResponse<SalesDashboardDto>.Ok(result));
    }

    [HttpGet("analytics")]
    public async Task<ActionResult<ApiResponse<SalesAnalyticsDto>>> GetAnalytics(CancellationToken ct)
    {
        var result = await _salesService.GetAnalyticsAsync(ct);
        return Ok(ApiResponse<SalesAnalyticsDto>.Ok(result));
    }

    [HttpGet("overview")]
    public async Task<ActionResult<ApiResponse<SalesOverviewDto>>> GetOverview(CancellationToken ct)
    {
        var result = await _salesService.GetOverviewAsync(ct);
        return Ok(ApiResponse<SalesOverviewDto>.Ok(result));
    }

    /// <param name="filter">all | production | ready | pending | part (delivery/production bucket).</param>
    [HttpGet("overview/open-orders")]
    public async Task<ActionResult<ApiResponse<OpenSalesOrdersDto>>> GetOpenOrdersBoard(
        [FromQuery] string? filter, [FromQuery] string? search, [FromQuery] int page = 1, [FromQuery] int pageSize = 8, CancellationToken ct = default)
    {
        var result = await _salesService.GetOpenOrdersBoardAsync(filter, search, Math.Max(1, page), Math.Clamp(pageSize, 1, 50), ct);
        return Ok(ApiResponse<OpenSalesOrdersDto>.Ok(result));
    }

    [HttpGet("quotations")]
    public async Task<ActionResult<ApiResponse<PagedResult<SalesQuotationDto>>>> GetQuotations([FromQuery] SalesDocumentQuery query, CancellationToken ct)
    {
        var result = await _salesService.GetQuotationsAsync(query, ct);
        return Ok(ApiResponse<PagedResult<SalesQuotationDto>>.Ok(result));
    }

    [HttpGet("quotations/{docEntry:int}")]
    public async Task<ActionResult<ApiResponse<SalesQuotationDetailDto>>> GetQuotation(int docEntry, CancellationToken ct)
    {
        var result = await _salesService.GetQuotationByEntryAsync(docEntry, ct);
        if (result is null) return NotFound(ApiResponse<SalesQuotationDetailDto>.Fail($"Sales Quotation #{docEntry} was not found."));
        return Ok(ApiResponse<SalesQuotationDetailDto>.Ok(result));
    }

    [HttpGet("orders")]
    public async Task<ActionResult<ApiResponse<PagedResult<SalesOrderDto>>>> GetOrders([FromQuery] SalesDocumentQuery query, CancellationToken ct)
    {
        var result = await _salesService.GetOrdersAsync(query, ct);
        return Ok(ApiResponse<PagedResult<SalesOrderDto>>.Ok(result));
    }

    [HttpGet("orders/{docEntry:int}")]
    public async Task<ActionResult<ApiResponse<SalesOrderDetailDto>>> GetOrder(int docEntry, CancellationToken ct)
    {
        var result = await _salesService.GetOrderByEntryAsync(docEntry, ct);
        if (result is null) return NotFound(ApiResponse<SalesOrderDetailDto>.Fail($"Sales Order #{docEntry} was not found."));
        return Ok(ApiResponse<SalesOrderDetailDto>.Ok(result));
    }

    [HttpGet("deliveries")]
    public async Task<ActionResult<ApiResponse<PagedResult<DeliveryDto>>>> GetDeliveries([FromQuery] SalesDocumentQuery query, CancellationToken ct)
    {
        var result = await _salesService.GetDeliveriesAsync(query, ct);
        return Ok(ApiResponse<PagedResult<DeliveryDto>>.Ok(result));
    }

    [HttpGet("deliveries/{docEntry:int}")]
    public async Task<ActionResult<ApiResponse<DeliveryDetailDto>>> GetDelivery(int docEntry, CancellationToken ct)
    {
        var result = await _salesService.GetDeliveryByEntryAsync(docEntry, ct);
        if (result is null) return NotFound(ApiResponse<DeliveryDetailDto>.Fail($"Delivery #{docEntry} was not found."));
        return Ok(ApiResponse<DeliveryDetailDto>.Ok(result));
    }

    [HttpGet("invoices")]
    public async Task<ActionResult<ApiResponse<PagedResult<ArInvoiceDto>>>> GetInvoices([FromQuery] SalesDocumentQuery query, CancellationToken ct)
    {
        var result = await _salesService.GetInvoicesAsync(query, ct);
        return Ok(ApiResponse<PagedResult<ArInvoiceDto>>.Ok(result));
    }

    [HttpGet("invoices/{docEntry:int}")]
    public async Task<ActionResult<ApiResponse<ArInvoiceDetailDto>>> GetInvoice(int docEntry, CancellationToken ct)
    {
        var result = await _salesService.GetInvoiceByEntryAsync(docEntry, ct);
        if (result is null) return NotFound(ApiResponse<ArInvoiceDetailDto>.Fail($"A/R Invoice #{docEntry} was not found."));
        return Ok(ApiResponse<ArInvoiceDetailDto>.Ok(result));
    }

    [HttpGet("credit-memos")]
    public async Task<ActionResult<ApiResponse<PagedResult<ArCreditMemoDto>>>> GetCreditMemos([FromQuery] SalesDocumentQuery query, CancellationToken ct)
    {
        var result = await _salesService.GetCreditMemosAsync(query, ct);
        return Ok(ApiResponse<PagedResult<ArCreditMemoDto>>.Ok(result));
    }

    [HttpGet("credit-memos/{docEntry:int}")]
    public async Task<ActionResult<ApiResponse<ArCreditMemoDetailDto>>> GetCreditMemo(int docEntry, CancellationToken ct)
    {
        var result = await _salesService.GetCreditMemoByEntryAsync(docEntry, ct);
        if (result is null) return NotFound(ApiResponse<ArCreditMemoDetailDto>.Fail($"A/R Credit Memo #{docEntry} was not found."));
        return Ok(ApiResponse<ArCreditMemoDetailDto>.Ok(result));
    }

    [HttpGet("payments")]
    public async Task<ActionResult<ApiResponse<PagedResult<IncomingPaymentDto>>>> GetPayments([FromQuery] SalesDocumentQuery query, CancellationToken ct)
    {
        var result = await _salesService.GetPaymentsAsync(query, ct);
        return Ok(ApiResponse<PagedResult<IncomingPaymentDto>>.Ok(result));
    }

    [HttpGet("payments/{docEntry:int}")]
    public async Task<ActionResult<ApiResponse<IncomingPaymentDetailDto>>> GetPayment(int docEntry, CancellationToken ct)
    {
        var result = await _salesService.GetPaymentByEntryAsync(docEntry, ct);
        if (result is null) return NotFound(ApiResponse<IncomingPaymentDetailDto>.Fail($"Payment #{docEntry} was not found."));
        return Ok(ApiResponse<IncomingPaymentDetailDto>.Ok(result));
    }
}
