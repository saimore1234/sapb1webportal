namespace SAPB1.Api.Auth;

/// <summary>
/// A role's resolved permissions plus THE single place the permission rules live
/// (server side; src/permissions/evaluate.ts mirrors it for UI hiding). Nothing here
/// knows any module or page name — keys are opaque strings from the data.
///
/// Rules:
///  - full-access roles (the built-in Administrator, IsSystemRole) allow everything,
///    including modules/pages added in the future — no rows needed;
///  - an action on a module needs the module grant AND the module's View;
///  - an action on a page additionally needs the page grant AND the page's View,
///    where a page with no explicit rule inherits (= allowed by the module grant).
/// </summary>
public sealed class RoleAccess
{
    public const string ViewAction = "View";

    private readonly HashSet<string> _moduleGrants;
    private readonly Dictionary<string, bool> _pageRules;

    public bool IsFullAccess { get; }

    public IReadOnlyCollection<string> ModuleKeys => _moduleGrants;
    public IReadOnlyDictionary<string, bool> PageRules => _pageRules;

    public RoleAccess(bool isFullAccess, IEnumerable<string>? moduleKeys = null, IEnumerable<KeyValuePair<string, bool>>? pageRules = null)
    {
        IsFullAccess = isFullAccess;
        _moduleGrants = new HashSet<string>(moduleKeys ?? Enumerable.Empty<string>(), StringComparer.OrdinalIgnoreCase);
        _pageRules = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
        if (pageRules is not null)
            foreach (var kv in pageRules) _pageRules[kv.Key] = kv.Value;
    }

    public static string ModuleKey(string module, string action) => $"{module}.{action}";
    public static string PageKey(string module, string page, string action) => $"{module}.{page}.{action}";

    public bool Allows(string module, string? page, string action)
    {
        if (IsFullAccess) return true;
        if (!ModuleGranted(module, action)) return false;
        if (!ModuleGranted(module, ViewAction)) return false;
        return page is null || PageGranted(module, page, action);
    }

    /// <summary>Page-level rules only — used by the convention filter, since module
    /// grants are already enforced by each controller's own [RequirePermission].</summary>
    public bool PageAllows(string module, string page, string action) =>
        IsFullAccess || PageGranted(module, page, action);

    private bool ModuleGranted(string module, string action) => _moduleGrants.Contains(ModuleKey(module, action));

    private bool PageGranted(string module, string page, string action)
    {
        if (!PageRule(module, page, action)) return false;
        return string.Equals(action, ViewAction, StringComparison.OrdinalIgnoreCase) || PageRule(module, page, ViewAction);
    }

    private bool PageRule(string module, string page, string action) =>
        !_pageRules.TryGetValue(PageKey(module, page, action), out var granted) || granted;
}
