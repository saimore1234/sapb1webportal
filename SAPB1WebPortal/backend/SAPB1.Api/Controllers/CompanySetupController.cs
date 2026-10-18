using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SAPB1.Api.Auth;
using SAPB1.Api.DTOs.Admin;
using SAPB1.Api.DTOs.Common;
using SAPB1.Api.Interfaces;

namespace SAPB1.Api.Controllers;

/// <summary>
/// Login-page company setup: lets the portal admin add and test a SAP B1
/// company/server before anyone can sign in (e.g. a fresh install with no
/// companies in the dropdown). Anonymous at the HTTP level, but every action
/// re-verifies the portal admin credential (Auth:PortalUsername /
/// Auth:PortalPasswordHash) sent in the body — without that, this endpoint
/// would let anyone create tenants or use the server to probe arbitrary
/// SQL/SAP hosts. Delegates to the same IServerConfigurationService as
/// Administration → Server / Company Configuration.
/// </summary>
[ApiController]
[Route("api/auth/company-setup")]
[AllowAnonymous]
public class CompanySetupController : ControllerBase
{
    private readonly IServerConfigurationService _service;
    private readonly IConfiguration _configuration;
    private readonly ILogger<CompanySetupController> _logger;

    public CompanySetupController(IServerConfigurationService service, IConfiguration configuration, ILogger<CompanySetupController> logger)
    {
        _service = service;
        _configuration = configuration;
        _logger = logger;
    }

    [HttpPost("test")]
    public async Task<ActionResult<ApiResponse<TestAllResultDto>>> TestAll([FromBody] CompanySetupRequest<TestConnectionDto> request, CancellationToken ct)
    {
        if (!IsPortalAdmin(request)) return AdminRejected<TestAllResultDto>();
        var result = await _service.TestAllAsync(null, request.Configuration, ct);
        return Ok(ApiResponse<TestAllResultDto>.Ok(result));
    }

    [HttpPost("test-sql")]
    public async Task<ActionResult<ApiResponse<TestConnectionResultDto>>> TestSql([FromBody] CompanySetupRequest<TestConnectionDto> request, CancellationToken ct)
    {
        if (!IsPortalAdmin(request)) return AdminRejected<TestConnectionResultDto>();
        var result = await _service.TestSqlAsync(null, request.Configuration, ct);
        return Ok(ApiResponse<TestConnectionResultDto>.Ok(result));
    }

    [HttpPost("test-sap")]
    public async Task<ActionResult<ApiResponse<TestConnectionResultDto>>> TestSap([FromBody] CompanySetupRequest<TestConnectionDto> request, CancellationToken ct)
    {
        if (!IsPortalAdmin(request)) return AdminRejected<TestConnectionResultDto>();
        var result = await _service.TestSapAsync(null, request.Configuration, ct);
        return Ok(ApiResponse<TestConnectionResultDto>.Ok(result));
    }

    [HttpPost]
    public async Task<ActionResult<ApiResponse<object>>> Create([FromBody] CompanySetupRequest<CreateServerConfigurationDto> request, CancellationToken ct)
    {
        if (!IsPortalAdmin(request)) return AdminRejected<object>();

        var dto = request.Configuration;
        if (string.IsNullOrWhiteSpace(dto.CompanyCode) || string.IsNullOrWhiteSpace(dto.CompanyName)
            || string.IsNullOrWhiteSpace(dto.SapCompanyDb) || string.IsNullOrWhiteSpace(dto.ServiceLayerUrl)
            || string.IsNullOrWhiteSpace(dto.SapUsername) || string.IsNullOrWhiteSpace(dto.SapPassword)
            || string.IsNullOrWhiteSpace(dto.SqlServer) || string.IsNullOrWhiteSpace(dto.SqlDatabase)
            || string.IsNullOrWhiteSpace(dto.SqlUsername) || string.IsNullOrWhiteSpace(dto.SqlPassword))
        {
            return BadRequest(ApiResponse<object>.Fail("Company code/name, SAP details, and SQL details (including both passwords) are required."));
        }

        try
        {
            var id = await _service.CreateAsync(dto, ct);
            return Ok(ApiResponse<object>.Ok(new { id, code = dto.CompanyCode }, "Company configuration created."));
        }
        catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number == 2601 || ex.Number == 2627)
        {
            return BadRequest(ApiResponse<object>.Fail($"A configuration for company code '{dto.CompanyCode}' already exists."));
        }
    }

    private bool IsPortalAdmin<T>(CompanySetupRequest<T> request) where T : new()
    {
        var portalUsername = _configuration["Auth:PortalUsername"];
        var portalPasswordHash = _configuration["Auth:PortalPasswordHash"];
        if (string.IsNullOrWhiteSpace(portalUsername) || string.IsNullOrWhiteSpace(portalPasswordHash)
            || string.IsNullOrEmpty(request.AdminUsername) || string.IsNullOrEmpty(request.AdminPassword))
        {
            return false;
        }

        var ok = string.Equals(request.AdminUsername, portalUsername, StringComparison.OrdinalIgnoreCase)
                 && PasswordHasher.Verify(request.AdminPassword, portalPasswordHash);
        if (!ok) _logger.LogWarning("Company setup rejected: bad portal admin credentials.");
        return ok;
    }

    private ActionResult AdminRejected<T>() =>
        Unauthorized(ApiResponse<T>.Fail("Invalid portal administrator username or password."));
}

public class CompanySetupRequest<T> where T : new()
{
    public string AdminUsername { get; set; } = string.Empty;
    public string AdminPassword { get; set; } = string.Empty;
    public T Configuration { get; set; } = new();
}
