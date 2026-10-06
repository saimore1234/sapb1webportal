using Microsoft.AspNetCore.Mvc.Filters;

namespace SAPB1.Api.Auth;

/// <summary>
/// Global, convention-based page-level enforcement so no endpoint needs a hand-written
/// check. For a request to /api/{module}/{page}/..., it looks up the caller's explicit
/// page rule for (module, page, action) — the same keys the Roles screen writes, which
/// the frontend derives from the navigation registry. The action comes from the HTTP verb
/// (GET→View, POST→Create, PUT/PATCH→Edit, DELETE→Delete).
///
/// Only page-level rules are evaluated here: module grants stay enforced by each
/// controller's [RequirePermission]. A page with no rule inherits, so unconfigured
/// pages/modules (including new ones) behave exactly as before. Endpoints that need a
/// different mapping use [RequirePermission(module, page, action)] explicitly.
/// </summary>
public class PageAccessFilter : IAsyncAuthorizationFilter
{
    // Auth and admin endpoints carry their own explicit permission attributes.
    private static readonly string[] SkippedModules = { "auth", "admin" };

    public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
    {
        var segments = context.HttpContext.Request.Path.Value?
            .Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments is null || segments.Length < 3 || !segments[0].Equals("api", StringComparison.OrdinalIgnoreCase))
            return;
        if (SkippedModules.Contains(segments[1], StringComparer.OrdinalIgnoreCase)) return;

        var access = await RoleAccessResolver.ResolveAsync(context.HttpContext);
        if (access is null || access.IsFullAccess) return; // unauthenticated: [Authorize] rejects it

        var action = context.HttpContext.Request.Method switch
        {
            "GET" or "HEAD" or "OPTIONS" => RoleAccess.ViewAction,
            "POST" => "Create",
            "PUT" or "PATCH" => "Edit",
            "DELETE" => "Delete",
            _ => RoleAccess.ViewAction
        };

        if (!access.PageAllows(segments[1], segments[2], action))
            context.Result = RoleAccessResolver.Forbidden();
    }
}
