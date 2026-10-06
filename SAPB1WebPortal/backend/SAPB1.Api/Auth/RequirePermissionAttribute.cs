using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using SAPB1.Api.DTOs.Common;
using SAPB1.Api.Interfaces;
using SAPB1.Api.Models;

namespace SAPB1.Api.Auth;

/// <summary>
/// Stacks ON TOP OF the existing [Authorize(Roles = "...")] attributes — it never
/// replaces them. Only after the existing role check passes does this run.
///
/// Usage (generic — no module/page names live in this class):
///   [RequirePermission("Sales.View")]                        module-level, "{module}.{action}"
///   [RequirePermission("Sales", "orders", "Create")]         page-level, explicit
/// Both forms go through RoleAccess.Allows, the single place the rules live.
///
/// The portal's built-in Admin (the one config-based login, never a row in the
/// Users table) and any full-access role (the built-in Administrator) always pass,
/// including for modules/pages added later. Every other role's permissions are
/// resolved fresh from the database on every request (cached for that request only) —
/// never embedded in the JWT — so changes take effect on the next request.
///
/// On failure, returns 403 with a generic message — never the internal reason.
/// </summary>
public class RequirePermissionAttribute : Attribute, IFilterFactory
{
    private readonly string _module;
    private readonly string? _page;
    private readonly string _action;

    public RequirePermissionAttribute(string permissionKey)
    {
        var parts = permissionKey.Split('.');
        if (parts.Length != 2) throw new ArgumentException("Expected \"Module.Action\".", nameof(permissionKey));
        _module = parts[0];
        _action = parts[1];
    }

    public RequirePermissionAttribute(string module, string page, string action)
    {
        _module = module;
        _page = page;
        _action = action;
    }

    public bool IsReusable => false;

    public IFilterMetadata CreateInstance(IServiceProvider serviceProvider) =>
        new RequirePermissionFilter(_module, _page, _action);

    private class RequirePermissionFilter : IAsyncAuthorizationFilter
    {
        private readonly string _module;
        private readonly string? _page;
        private readonly string _action;

        public RequirePermissionFilter(string module, string? page, string action)
        {
            _module = module;
            _page = page;
            _action = action;
        }

        public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
        {
            var access = await RoleAccessResolver.ResolveAsync(context.HttpContext);
            if (access is null || !access.Allows(_module, _page, _action))
                context.Result = RoleAccessResolver.Forbidden();
        }
    }
}

/// <summary>Resolves (and caches for the duration of one request) the caller's RoleAccess.</summary>
public static class RoleAccessResolver
{
    private const string ItemKey = "__RoleAccess";

    public static async Task<RoleAccess?> ResolveAsync(HttpContext http)
    {
        if (http.Items.TryGetValue(ItemKey, out var cached)) return cached as RoleAccess;

        var user = http.User;
        RoleAccess? access = null;
        if (user.Identity?.IsAuthenticated == true)
        {
            // The portal superuser — same bypass every existing Roles="Admin,..." check already grants.
            if (user.IsInRole(Roles.Admin))
            {
                access = new RoleAccess(true);
            }
            else
            {
                var role = user.FindFirstValue(ClaimTypes.Role);
                if (!string.IsNullOrWhiteSpace(role))
                {
                    var admin = http.RequestServices.GetRequiredService<IAdminService>();
                    access = await admin.GetRoleAccessAsync(role, http.RequestAborted);
                }
            }
        }

        http.Items[ItemKey] = access;
        return access;
    }

    public static ObjectResult Forbidden() =>
        new(ApiResponse<object>.Fail("You do not have permission to perform this action.")) { StatusCode = 403 };
}
