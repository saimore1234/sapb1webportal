using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SAPB1.Api.Auth;
using SAPB1.Api.DTOs.Common;
using SAPB1.Api.DTOs.ErpNext;
using SAPB1.Api.Interfaces;
using SAPB1.Api.Services.ErpNext;

namespace SAPB1.Api.Controllers;

/// <summary>
/// ERPNext integration. The company (and therefore the ERPNext site, company
/// and credentials) always comes from the caller's JWT via server-side
/// configuration — no action accepts a company, URL or credential. Nothing here
/// writes to SAP B1.
/// </summary>
[ApiController]
[Route("api/erpnext")]
[Authorize]
public class ErpNextController : ControllerBase
{
    private readonly IErpNextAdminService _adminService;
    private readonly IErpNextInvoiceService _invoiceService;
    private readonly IErpNextComplianceService _complianceService;

    public ErpNextController(IErpNextAdminService adminService, IErpNextInvoiceService invoiceService, IErpNextComplianceService complianceService)
    {
        _adminService = adminService;
        _invoiceService = invoiceService;
        _complianceService = complianceService;
    }

    /// <summary>POST /api/erpnext/test-connection — checks credentials, company, India Compliance, tax templates and custom fields.</summary>
    [HttpPost("test-connection")]
    [RequirePermission("ErpNext.Admin")]
    public Task<ActionResult<ApiResponse<ErpNextCheckResultDto>>> TestConnection(CancellationToken ct) =>
        Run<ErpNextCheckResultDto>(async () =>
        {
            var result = await _adminService.TestConnectionAsync(ct);
            return Ok(ApiResponse<ErpNextCheckResultDto>.Ok(result,
                result.Success ? "All ERPNext checks passed." : "Some ERPNext checks failed — see the check list."));
        });

    /// <summary>POST /api/erpnext/setup/custom-fields — idempotently creates the sap_b1_* custom fields on the ERPNext site.</summary>
    [HttpPost("setup/custom-fields")]
    [RequirePermission("ErpNext.Admin")]
    public Task<ActionResult<ApiResponse<ErpNextCustomFieldsResultDto>>> CreateCustomFields(CancellationToken ct) =>
        Run<ErpNextCustomFieldsResultDto>(async () =>
        {
            var result = await _adminService.CreateCustomFieldsAsync(ct);
            return Ok(ApiResponse<ErpNextCustomFieldsResultDto>.Ok(result,
                result.Success ? "Custom fields are in place." : "Some custom fields could not be created — see the field list."));
        });

    /// <summary>
    /// POST /api/erpnext/invoices/{docEntry}/preview — reads the A/R Invoice from SAP and returns the ERPNext
    /// Sales Invoice payload it would send, plus every problem that would block the push. Does NOT call ERPNext.
    /// </summary>
    [HttpPost("invoices/{docEntry:int}/preview")]
    [RequirePermission("ErpNext.Admin")]
    public Task<ActionResult<ApiResponse<ErpNextPreviewDto>>> Preview(int docEntry, CancellationToken ct) =>
        Run<ErpNextPreviewDto>(async () =>
        {
            var result = await _invoiceService.PreviewAsync(docEntry, ct);
            if (result is null) return NotFound(ApiResponse<ErpNextPreviewDto>.Fail($"A/R Invoice #{docEntry} was not found."));
            return Ok(ApiResponse<ErpNextPreviewDto>.Ok(result,
                result.IsValid ? "Invoice maps cleanly." : $"{result.Problems.Count} problem(s) would block the push — see problems."));
        });

    /// <summary>GET /api/erpnext/invoices/{docEntry} — the stored ERPNext link status (NotPushed / Pushing / Pushed / Failed). Does not call ERPNext.</summary>
    [HttpGet("invoices/{docEntry:int}")]
    [RequirePermission("ErpNext.View")]
    public Task<ActionResult<ApiResponse<ErpNextLinkStatusDto>>> GetStatus(int docEntry, CancellationToken ct) =>
        Run<ErpNextLinkStatusDto>(async () =>
            Ok(ApiResponse<ErpNextLinkStatusDto>.Ok(await _invoiceService.GetStatusAsync(docEntry, ct))));

    /// <summary>
    /// POST /api/erpnext/invoices/{docEntry}/push — creates a DRAFT Sales Invoice in ERPNext (never submits).
    /// Safe to repeat: a second call returns the existing ERPNext invoice instead of creating another.
    /// </summary>
    [HttpPost("invoices/{docEntry:int}/push")]
    [RequirePermission("ErpNext.Push")]
    public Task<ActionResult<ApiResponse<ErpNextPushResultDto>>> Push(int docEntry, CancellationToken ct) =>
        Run<ErpNextPushResultDto>(async () =>
        {
            var result = await _invoiceService.PushAsync(docEntry, ct);
            if (result is null) return NotFound(ApiResponse<ErpNextPushResultDto>.Fail($"A/R Invoice #{docEntry} was not found."));

            return result.Outcome switch
            {
                "Blocked" => new BadRequestObjectResult(ApiResponse<ErpNextPushResultDto>.Fail(
                    "The invoice was not sent to ERPNext because of validation problems.", result.Problems)),
                "InProgress" => new ConflictObjectResult(ApiResponse<ErpNextPushResultDto>.Fail(result.Problems[0])),
                "AlreadyPushed" => Ok(ApiResponse<ErpNextPushResultDto>.Ok(result,
                    $"Already pushed as {result.InvoiceName}. Nothing was created.")),
                "Adopted" => Ok(ApiResponse<ErpNextPushResultDto>.Ok(result,
                    $"{result.InvoiceName} already existed in ERPNext from an earlier attempt and is now linked.")),
                _ => Ok(ApiResponse<ErpNextPushResultDto>.Ok(result,
                    $"Draft Sales Invoice {result.InvoiceName} created."))
            };
        });

    /// <summary>POST /api/erpnext/invoices/{docEntry}/refresh — re-reads the invoice from ERPNext (status, IRN, e-way bill) and updates the stored link.</summary>
    [HttpPost("invoices/{docEntry:int}/refresh")]
    [RequirePermission("ErpNext.View")]
    public Task<ActionResult<ApiResponse<ErpNextLinkStatusDto>>> Refresh(int docEntry, CancellationToken ct) =>
        Run<ErpNextLinkStatusDto>(async () =>
            Ok(ApiResponse<ErpNextLinkStatusDto>.Ok(await _complianceService.RefreshAsync(docEntry, ct), "Status refreshed from ERPNext.")));

    /// <summary>
    /// POST /api/erpnext/invoices/{docEntry}/e-invoice — registers the invoice with the GST e-invoice portal through ERPNext
    /// (submitting the draft first if needed). Body must carry confirm=true. NOT reversible after 24 hours.
    /// </summary>
    [HttpPost("invoices/{docEntry:int}/e-invoice")]
    [RequirePermission("ErpNext.EInvoice")]
    public Task<ActionResult<ApiResponse<ErpNextComplianceResultDto>>> GenerateEInvoice(
        int docEntry, [FromBody] ErpNextEInvoiceRequestDto? request, CancellationToken ct) =>
        Run<ErpNextComplianceResultDto>(async () =>
        {
            var result = await _complianceService.GenerateEInvoiceAsync(docEntry, request ?? new ErpNextEInvoiceRequestDto(), ct);
            return Ok(ApiResponse<ErpNextComplianceResultDto>.Ok(result, result.Outcome == "AlreadyGenerated"
                ? $"An e-invoice already exists for this invoice (IRN {result.Status.Irn})."
                : $"E-invoice generated. IRN {result.Status.Irn}."));
        });

    /// <summary>POST /api/erpnext/invoices/{docEntry}/e-waybill — generates the e-way bill through ERPNext with the given transport details.</summary>
    [HttpPost("invoices/{docEntry:int}/e-waybill")]
    [RequirePermission("ErpNext.EwayBill")]
    public Task<ActionResult<ApiResponse<ErpNextComplianceResultDto>>> GenerateEwayBill(
        int docEntry, [FromBody] ErpNextEwayBillRequestDto? request, CancellationToken ct) =>
        Run<ErpNextComplianceResultDto>(async () =>
        {
            var result = await _complianceService.GenerateEwayBillAsync(docEntry, request ?? new ErpNextEwayBillRequestDto(), ct);
            return Ok(ApiResponse<ErpNextComplianceResultDto>.Ok(result, result.Outcome == "AlreadyGenerated"
                ? $"An e-way bill already exists for this invoice ({result.Status.EwbNo})."
                : $"E-way bill generated: {result.Status.EwbNo}."));
        });

    /// <summary>
    /// POST /api/erpnext/invoices/{docEntry}/e-invoice/cancel — cancels the IRN (and any e-way bill with it) on the GST portal, within
    /// 24 hours of generation. Body: reason, optional remark, confirm=true. NOT reversible; the invoice number can never get a new IRN.
    /// </summary>
    [HttpPost("invoices/{docEntry:int}/e-invoice/cancel")]
    [RequirePermission("ErpNext.Cancel")]
    public Task<ActionResult<ApiResponse<ErpNextComplianceResultDto>>> CancelEInvoice(
        int docEntry, [FromBody] ErpNextCancelRequestDto? request, CancellationToken ct) =>
        Run<ErpNextComplianceResultDto>(async () =>
        {
            var result = await _complianceService.CancelEInvoiceAsync(docEntry, request ?? new ErpNextCancelRequestDto(), ct);
            return Ok(ApiResponse<ErpNextComplianceResultDto>.Ok(result, "E-invoice cancelled."));
        });

    /// <summary>POST /api/erpnext/invoices/{docEntry}/e-waybill/cancel — cancels the e-way bill within 24 hours of generation. NOT reversible.</summary>
    [HttpPost("invoices/{docEntry:int}/e-waybill/cancel")]
    [RequirePermission("ErpNext.Cancel")]
    public Task<ActionResult<ApiResponse<ErpNextComplianceResultDto>>> CancelEwayBill(
        int docEntry, [FromBody] ErpNextCancelRequestDto? request, CancellationToken ct) =>
        Run<ErpNextComplianceResultDto>(async () =>
        {
            var result = await _complianceService.CancelEwayBillAsync(docEntry, request ?? new ErpNextCancelRequestDto(), ct);
            return Ok(ApiResponse<ErpNextComplianceResultDto>.Ok(result, "E-way bill cancelled."));
        });

    /// <summary>GET /api/erpnext/invoices/{docEntry}/e-invoice/qr — the signed QR string for the invoice's e-invoice (the portal draws the code from it).</summary>
    [HttpGet("invoices/{docEntry:int}/e-invoice/qr")]
    [RequirePermission("ErpNext.View")]
    public Task<ActionResult<ApiResponse<ErpNextEInvoiceQrDto>>> GetEInvoiceQr(int docEntry, CancellationToken ct) =>
        Run<ErpNextEInvoiceQrDto>(async () =>
        {
            var result = await _complianceService.GetEInvoiceQrAsync(docEntry, ct);
            if (result is null) return NotFound(ApiResponse<ErpNextEInvoiceQrDto>.Fail("This invoice has no active e-invoice QR code."));
            return Ok(ApiResponse<ErpNextEInvoiceQrDto>.Ok(result));
        });

    /// <summary>GET /api/erpnext/invoices/{docEntry}/transport-defaults — pre-fill for the e-way bill form, from the SAP invoice's transport fields.</summary>
    [HttpGet("invoices/{docEntry:int}/transport-defaults")]
    [RequirePermission("ErpNext.EwayBill")]
    public Task<ActionResult<ApiResponse<ErpNextTransportDefaultsDto>>> GetTransportDefaults(int docEntry, CancellationToken ct) =>
        Run<ErpNextTransportDefaultsDto>(async () =>
        {
            var result = await _complianceService.GetTransportDefaultsAsync(docEntry, ct);
            if (result is null) return NotFound(ApiResponse<ErpNextTransportDefaultsDto>.Fail($"A/R Invoice #{docEntry} was not found."));
            return Ok(ApiResponse<ErpNextTransportDefaultsDto>.Ok(result));
        });

    /// <summary>Maps integration failures to safe, specific responses instead of the middleware's generic 500.</summary>
    private static async Task<ActionResult<ApiResponse<T>>> Run<T>(Func<Task<ActionResult<ApiResponse<T>>>> action)
    {
        try
        {
            return await action();
        }
        catch (ErpNextConfigException ex)
        {
            return new BadRequestObjectResult(ApiResponse<T>.Fail(ex.Message));
        }
        catch (ErpNextBlockedException ex)
        {
            return new BadRequestObjectResult(ApiResponse<T>.Fail(ex.Message, ex.Problems.ToList()));
        }
        catch (SapDataException ex)
        {
            return new BadRequestObjectResult(ApiResponse<T>.Fail(ex.Message));
        }
        catch (ErpNextException ex)
        {
            return new ObjectResult(ApiResponse<T>.Fail(ex.Message)) { StatusCode = StatusCodes.Status502BadGateway };
        }
    }
}
