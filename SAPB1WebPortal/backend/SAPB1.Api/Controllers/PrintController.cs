using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SAPB1.Api.Auth;
using SAPB1.Api.DTOs.Common;
using SAPB1.Api.Interfaces;
using SAPB1.Api.Models;
using SAPB1.Api.Services;

namespace SAPB1.Api.Controllers;

/// <summary>
/// GET /api/print/{documentType}/{docEntry} returns the PDF produced by the
/// company's EXISTING SAP B1 Crystal layout. The company is taken only from the
/// JWT (ICompanyContext); there is deliberately no company/database parameter.
/// Read-only.
/// </summary>
[ApiController]
[Route("api/print")]
[Authorize]
public class PrintController : ControllerBase
{
    private readonly ISapB1PrintService _print;
    private readonly IAdminService _admin;

    public PrintController(ISapB1PrintService print, IAdminService admin)
    {
        _print = print;
        _admin = admin;
    }

    /// <summary>Every Crystal layout SAP B1 holds for this document type in the caller's company (default first).</summary>
    [HttpGet("{documentType}/{docEntry:int}/layouts")]
    public async Task<IActionResult> Layouts(string documentType, int docEntry, CancellationToken ct)
    {
        if (!SapB1PrintService.IsKnown(documentType))
            return NotFound(ApiResponse<object>.Fail("This document type cannot be printed."));
        if (await CheckPermissionAsync(documentType, ct) is { } denied) return denied;

        var result = await _print.GetLayoutsAsync(documentType, docEntry, ct);
        if (result.Failure == PrintFailure.DocumentNotFound)
            return NotFound(ApiResponse<object>.Fail("The document was not found."));
        return Ok(ApiResponse<IReadOnlyList<PrintLayout>>.Ok(result.Layouts));
    }

    /// <summary>Same permission the document's module already requires to view it.</summary>
    private async Task<IActionResult?> CheckPermissionAsync(string documentType, CancellationToken ct)
    {
        var permission = SapB1PrintService.PermissionFor(documentType)!;
        var access = await RoleAccessResolver.ResolveAsync(HttpContext);
        var parts = permission.Split('.');
        return access is null || !access.Allows(parts[0], null, parts[1])
            ? RoleAccessResolver.Forbidden()
            : null;
    }

    [HttpGet("{documentType}/{docEntry:int}")]
    public async Task<IActionResult> Print(string documentType, int docEntry, [FromQuery] string? layout, CancellationToken ct)
    {
        if (!SapB1PrintService.IsKnown(documentType))
            return NotFound(ApiResponse<object>.Fail("This document type cannot be printed."));

        if (await CheckPermissionAsync(documentType, ct) is { } denied) return denied;

        var result = await _print.PrintDocumentAsync(documentType, docEntry, layout, ct);
        if (result.Success)
        {
            Response.Headers["Content-Disposition"] = $"inline; filename=\"{result.FileName}\"";
            Response.Headers["X-Report-Name"] = Uri.EscapeDataString(result.ReportName);
            return File(result.Content, result.ContentType);
        }

        return result.Failure switch
        {
            PrintFailure.DocumentNotFound => NotFound(ApiResponse<object>.Fail("The document was not found.")),
            PrintFailure.NoLayoutConfigured => NotFound(new ApiResponse<object> { Success = false, Message = "No SAP Business One print layout is configured for this document.", Errors = new() { "NO_LAYOUT" } }),
            _ => StatusCode(502, new ApiResponse<object> { Success = false, Message = "Unable to render the configured SAP Business One print format.", Errors = new() { "RENDER_FAILED" } })
        };
    }
}
