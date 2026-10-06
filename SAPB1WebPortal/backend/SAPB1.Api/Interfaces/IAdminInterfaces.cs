using System.Data;
using SAPB1.Api.DTOs.Admin;

namespace SAPB1.Api.Interfaces;

/// <summary>Opens a connection to the portal's OWN database (Users/Roles/Permissions) —
/// separate from every SAP B1 company database, and not scoped by ICompanyContext,
/// since RBAC data is global across companies (confirmed with the project owner).</summary>
public interface IPortalConnectionFactory
{
    IDbConnection CreateConnection();
}

/// <summary>A portal user record as read from the database, including the password
/// hash — internal use only (login/reset-password checks). Never returned from an
/// API response; UserListItemDto is what controllers expose.</summary>
public class PortalUserRecord
{
    public int Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    public string? RoleName { get; set; }
}

/// <summary>
/// CRUD over the portal's Users/Roles/Permissions tables, plus the one method the
/// login flow depends on (GetUserByUsernameAsync). This is the ONLY thing that reads
/// or writes SAPB1PortalAdmin — everything else in the app still talks exclusively
/// to per-company SAP B1 databases via ICompanyConnectionFactory.
/// </summary>
public interface IAdminService
{
    Task<PortalUserRecord?> GetUserByUsernameAsync(string username, CancellationToken ct = default);
    Task RecordLoginAsync(int userId, CancellationToken ct = default);

    Task<List<UserListItemDto>> GetUsersAsync(CancellationToken ct = default);
    Task<int> CreateUserAsync(CreateUserDto dto, string passwordHash, CancellationToken ct = default);
    Task<bool> UpdateUserAsync(int id, UpdateUserDto dto, CancellationToken ct = default);
    Task<bool> ResetPasswordAsync(int id, string passwordHash, CancellationToken ct = default);
    Task<bool> DeleteUserAsync(int id, CancellationToken ct = default);

    Task<List<RoleListItemDto>> GetRolesAsync(CancellationToken ct = default);
    Task<int> CreateRoleAsync(CreateRoleDto dto, CancellationToken ct = default);
    Task<bool> UpdateRoleAsync(int id, CreateRoleDto dto, CancellationToken ct = default);

    Task<List<PermissionDto>> GetPermissionsAsync(CancellationToken ct = default);
    Task<RolePermissionsDto?> GetRolePermissionsAsync(int roleId, CancellationToken ct = default);
    Task<bool> UpdateRolePermissionsAsync(int roleId, List<string> permissionKeys, List<PagePermissionDto>? pagePermissions, CancellationToken ct = default);

    /// <summary>Resolved access for a role name - the single method every authorization
    /// check (RequirePermissionAttribute, page filter, /auth/me) uses. Unknown role =
    /// no access; the built-in Administrator (IsSystemRole) = full access.</summary>
    Task<SAPB1.Api.Auth.RoleAccess> GetRoleAccessAsync(string roleName, CancellationToken ct = default);
}
