namespace SAPB1.Api.DTOs.Admin;

public class UserListItemDto
{
    public int Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string? RoleName { get; set; }
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? LastLoginAt { get; set; }
}

public class CreateUserDto
{
    public string Username { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public int RoleId { get; set; }
}

public class UpdateUserDto
{
    public string DisplayName { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    public int RoleId { get; set; }
}

public class ResetPasswordDto
{
    public string NewPassword { get; set; } = string.Empty;
}

public class RoleListItemDto
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public bool IsSystemRole { get; set; }
    public int UserCount { get; set; }
}

public class CreateRoleDto
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
}

public class PermissionDto
{
    public int Id { get; set; }
    public string Module { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
    public string PermissionKey { get; set; } = string.Empty;
    public string? Description { get; set; }
}

public class RolePermissionsDto
{
    public int RoleId { get; set; }
    public string RoleName { get; set; } = string.Empty;
    /// <summary>Module-level grants, "{moduleKey}.{action}".</summary>
    public List<string> PermissionKeys { get; set; } = new();
    /// <summary>Explicit page-level rules; a page with no rule inherits the module grant.</summary>
    public List<PagePermissionDto> PagePermissions { get; set; } = new();
}

public class PagePermissionDto
{
    public string ModuleKey { get; set; } = string.Empty;
    public string PageKey { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
    public bool IsGranted { get; set; }
}

public class UpdateRolePermissionsDto
{
    public List<string> PermissionKeys { get; set; } = new();
    /// <summary>Null = leave existing page rules untouched (older clients).</summary>
    public List<PagePermissionDto>? PagePermissions { get; set; }
}

/// <summary>The currently authenticated user's identity + resolved permission set — GET /api/auth/me.</summary>
public class CurrentUserDto
{
    public string Username { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public string Company { get; set; } = string.Empty;
    public string CompanyName { get; set; } = string.Empty;
    /// <summary>True for the portal's built-in admin superuser — implies every permission without a DB lookup.</summary>
    public bool IsSuperUser { get; set; }
    public List<string> Permissions { get; set; } = new();
    /// <summary>Explicit page rules, key "{module}.{page}.{action}" -> granted.</summary>
    public Dictionary<string, bool> PageRules { get; set; } = new();
}
