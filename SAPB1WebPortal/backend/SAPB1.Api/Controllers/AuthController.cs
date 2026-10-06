using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SAPB1.Api.Auth;
using SAPB1.Api.DTOs.Admin;
using SAPB1.Api.DTOs.Auth;
using SAPB1.Api.DTOs.Common;
using SAPB1.Api.Interfaces;
using SAPB1.Api.Models;

namespace SAPB1.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly IAuthService _authService;
    private readonly ITokenService _tokenService;
    private readonly ICompanyRegistry _companyRegistry;
    private readonly ITokenRevocationStore _revocationStore;
    private readonly IAdminService _adminService;
    private readonly ILogger<AuthController> _logger;

    public AuthController(
        IAuthService authService,
        ITokenService tokenService,
        ICompanyRegistry companyRegistry,
        ITokenRevocationStore revocationStore,
        IAdminService adminService,
        ILogger<AuthController> logger)
    {
        _authService = authService;
        _tokenService = tokenService;
        _companyRegistry = companyRegistry;
        _revocationStore = revocationStore;
        _adminService = adminService;
        _logger = logger;
    }

    /// <summary>
    /// GET /api/auth/companies — public list of configured SAP B1 company
    /// databases for the login dropdown. Never returns connection strings, SQL
    /// credentials, or Service Layer URLs.
    /// </summary>
    [HttpGet("companies")]
    [AllowAnonymous]
    public ActionResult<ApiResponse<List<CompanyOptionDto>>> GetCompanies()
    {
        var companies = _companyRegistry.GetPublicCompanyList()
            .Select(c => new CompanyOptionDto { Code = c.Code, Name = c.Name })
            .OrderBy(c => c.Name)
            .ToList();

        return Ok(ApiResponse<List<CompanyOptionDto>>.Ok(companies));
    }

    /// <summary>
    /// POST /api/auth/login — validates the chosen company against the
    /// server-side allow-list, then verifies the SAP B1 username/password
    /// against that company's real SAP Business One Service Layer, and returns
    /// a JWT scoped to that company. Every later request derives its company
    /// context only from this token — never from anything the client sends
    /// per-request.
    /// </summary>
    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<ActionResult<ApiResponse<LoginResponseDto>>> Login([FromBody] LoginRequestDto request, CancellationToken ct)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponse<LoginResponseDto>.Fail("Company, username and password are required."));

        var (success, user) = await _authService.ValidateCredentialsAsync(request.CompanyDb, request.Username, request.Password, ct);
        if (!success || user is null)
        {
            // Intentionally generic — do not reveal whether the company or username exists.
            return Unauthorized(ApiResponse<LoginResponseDto>.Fail("Invalid company, username or password."));
        }

        var (token, expiresAtUtc) = _tokenService.GenerateToken(user);

        var response = new LoginResponseDto
        {
            Token = token,
            Username = user.Username,
            Company = user.CompanyCode,
            CompanyName = user.CompanyName,
            Role = user.Role,
            ExpiresAtUtc = expiresAtUtc,
            ExpiresIn = Math.Max(0, (int)(expiresAtUtc - DateTime.UtcNow).TotalSeconds)
        };

        return Ok(ApiResponse<LoginResponseDto>.Ok(response, "Login successful."));
    }

    /// <summary>
    /// POST /api/auth/logout — revokes the caller's current JWT immediately
    /// (see ITokenRevocationStore) instead of leaving it valid until its
    /// natural expiry. Requires a valid bearer token.
    /// </summary>
    [HttpPost("logout")]
    [Authorize]
    public ActionResult<ApiResponse<object>> Logout()
    {
        var jti = User.FindFirstValue(JwtRegisteredClaimNames.Jti);
        var expClaim = User.FindFirstValue(JwtRegisteredClaimNames.Exp);

        if (!string.IsNullOrEmpty(jti) && long.TryParse(expClaim, out var expUnixSeconds))
        {
            var expiresAtUtc = DateTimeOffset.FromUnixTimeSeconds(expUnixSeconds).UtcDateTime;
            _revocationStore.Revoke(jti, expiresAtUtc);
        }

        return Ok(ApiResponse<object>.Ok(new { }, "Logged out."));
    }

    /// <summary>
    /// GET /api/auth/me — the caller's identity plus their resolved permission set,
    /// for the frontend to gate navigation/buttons (UX only; the backend enforces
    /// permissions independently via RequirePermissionAttribute on every endpoint).
    /// The portal Admin superuser gets IsSuperUser=true instead of a DB lookup —
    /// it is never a row in the Users table.
    /// </summary>
    [HttpGet("me")]
    [Authorize]
    public async Task<ActionResult<ApiResponse<CurrentUserDto>>> Me(CancellationToken ct)
    {
        var isAdmin = User.IsInRole(Roles.Admin);
        var role = User.FindFirstValue(ClaimTypes.Role) ?? string.Empty;

        var access = isAdmin ? new RoleAccess(true) : await _adminService.GetRoleAccessAsync(role, ct);

        var dto = new CurrentUserDto
        {
            Username = User.Identity?.Name ?? string.Empty,
            Role = role,
            Company = User.FindFirstValue(AppClaimTypes.CompanyDb) ?? string.Empty,
            CompanyName = User.FindFirstValue(AppClaimTypes.CompanyName) ?? string.Empty,
            IsSuperUser = access.IsFullAccess,
            Permissions = access.ModuleKeys.ToList(),
            PageRules = access.PageRules.ToDictionary(kv => kv.Key, kv => kv.Value)
        };

        return Ok(ApiResponse<CurrentUserDto>.Ok(dto));
    }
}
