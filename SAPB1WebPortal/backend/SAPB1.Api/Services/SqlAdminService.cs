using Dapper;
using Microsoft.Data.SqlClient;
using System.Text.RegularExpressions;
using SAPB1.Api.Auth;
using SAPB1.Api.DTOs.Admin;
using SAPB1.Api.Interfaces;

namespace SAPB1.Api.Services;

/// <summary>
/// Dapper-based CRUD over the portal's own Users/Roles/Permissions tables
/// (SAPB1PortalAdmin), following the same query style as SqlSapB1Service —
/// parameterized SQL, explicit column lists, never string concatenation.
/// </summary>
public class SqlAdminService : IAdminService
{
    private readonly IPortalConnectionFactory _connectionFactory;

    public SqlAdminService(IPortalConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory;
    }

    public async Task<PortalUserRecord?> GetUserByUsernameAsync(string username, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        const string sql = @"
            SELECT u.Id, u.Username, u.DisplayName, u.PasswordHash, u.IsActive, r.Name AS RoleName
            FROM Users u
            LEFT JOIN UserRoles ur ON ur.UserId = u.Id
            LEFT JOIN Roles r ON r.Id = ur.RoleId
            WHERE u.Username = @Username";

        return await db.QuerySingleOrDefaultAsync<PortalUserRecord>(
            new CommandDefinition(sql, new { Username = username }, cancellationToken: ct));
    }

    public async Task RecordLoginAsync(int userId, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        await db.ExecuteAsync(new CommandDefinition(
            "UPDATE Users SET LastLoginAt = SYSUTCDATETIME() WHERE Id = @Id", new { Id = userId }, cancellationToken: ct));
    }

    public async Task<List<UserListItemDto>> GetUsersAsync(CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        const string sql = @"
            SELECT u.Id, u.Username, u.DisplayName, r.Name AS RoleName, u.IsActive, u.CreatedAt, u.LastLoginAt
            FROM Users u
            LEFT JOIN UserRoles ur ON ur.UserId = u.Id
            LEFT JOIN Roles r ON r.Id = ur.RoleId
            ORDER BY u.Username";

        return (await db.QueryAsync<UserListItemDto>(new CommandDefinition(sql, cancellationToken: ct))).ToList();
    }

    public async Task<int> CreateUserAsync(CreateUserDto dto, string passwordHash, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        const string insertSql = @"
            INSERT INTO Users (Username, DisplayName, PasswordHash, IsActive, CreatedAt, UpdatedAt)
            OUTPUT INSERTED.Id
            VALUES (@Username, @DisplayName, @PasswordHash, 1, SYSUTCDATETIME(), SYSUTCDATETIME())";

        var id = await db.ExecuteScalarAsync<int>(new CommandDefinition(
            insertSql, new { dto.Username, dto.DisplayName, PasswordHash = passwordHash }, cancellationToken: ct));

        await db.ExecuteAsync(new CommandDefinition(
            "INSERT INTO UserRoles (UserId, RoleId) VALUES (@UserId, @RoleId)",
            new { UserId = id, dto.RoleId }, cancellationToken: ct));

        return id;
    }

    public async Task<bool> UpdateUserAsync(int id, UpdateUserDto dto, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        var rows = await db.ExecuteAsync(new CommandDefinition(
            "UPDATE Users SET DisplayName = @DisplayName, IsActive = @IsActive, UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id",
            new { Id = id, dto.DisplayName, dto.IsActive }, cancellationToken: ct));

        if (rows == 0) return false;

        await db.ExecuteAsync(new CommandDefinition("DELETE FROM UserRoles WHERE UserId = @Id", new { Id = id }, cancellationToken: ct));
        await db.ExecuteAsync(new CommandDefinition(
            "INSERT INTO UserRoles (UserId, RoleId) VALUES (@UserId, @RoleId)",
            new { UserId = id, dto.RoleId }, cancellationToken: ct));

        return true;
    }

    public async Task<bool> ResetPasswordAsync(int id, string passwordHash, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        var rows = await db.ExecuteAsync(new CommandDefinition(
            "UPDATE Users SET PasswordHash = @PasswordHash, UpdatedAt = SYSUTCDATETIME() WHERE Id = @Id",
            new { Id = id, PasswordHash = passwordHash }, cancellationToken: ct));
        return rows > 0;
    }

    public async Task<bool> DeleteUserAsync(int id, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        var rows = await db.ExecuteAsync(new CommandDefinition("DELETE FROM Users WHERE Id = @Id", new { Id = id }, cancellationToken: ct));
        return rows > 0;
    }

    public async Task<List<RoleListItemDto>> GetRolesAsync(CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        const string sql = @"
            SELECT r.Id, r.Name, r.Description, r.IsSystemRole,
                   (SELECT COUNT(*) FROM UserRoles ur WHERE ur.RoleId = r.Id) AS UserCount
            FROM Roles r
            ORDER BY r.Name";

        return (await db.QueryAsync<RoleListItemDto>(new CommandDefinition(sql, cancellationToken: ct))).ToList();
    }

    public async Task<int> CreateRoleAsync(CreateRoleDto dto, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        const string sql = @"
            INSERT INTO Roles (Name, Description, IsSystemRole)
            OUTPUT INSERTED.Id
            VALUES (@Name, @Description, 0)";

        return await db.ExecuteScalarAsync<int>(new CommandDefinition(sql, dto, cancellationToken: ct));
    }

    public async Task<bool> UpdateRoleAsync(int id, CreateRoleDto dto, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        // IsSystemRole = 0 guard: the seeded Administrator role can't be renamed/redescribed.
        var rows = await db.ExecuteAsync(new CommandDefinition(
            "UPDATE Roles SET Name = @Name, Description = @Description WHERE Id = @Id AND IsSystemRole = 0",
            new { Id = id, dto.Name, dto.Description }, cancellationToken: ct));
        return rows > 0;
    }

    public async Task<List<PermissionDto>> GetPermissionsAsync(CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        const string sql = "SELECT Id, Module, Action, PermissionKey, Description FROM Permissions ORDER BY Module, Action";
        return (await db.QueryAsync<PermissionDto>(new CommandDefinition(sql, cancellationToken: ct))).ToList();
    }

    public async Task<RolePermissionsDto?> GetRolePermissionsAsync(int roleId, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        var role = await db.QuerySingleOrDefaultAsync<(int Id, string Name)>(
            new CommandDefinition("SELECT Id, Name FROM Roles WHERE Id = @Id", new { Id = roleId }, cancellationToken: ct));
        if (role.Name is null) return null;

        var keys = await db.QueryAsync<string>(new CommandDefinition(@"
            SELECT p.PermissionKey
            FROM RolePermissions rp
            JOIN Permissions p ON p.Id = rp.PermissionId
            WHERE rp.RoleId = @RoleId", new { RoleId = roleId }, cancellationToken: ct));

        var rules = await ReadPageRulesAsync(db, roleId, ct);

        return new RolePermissionsDto { RoleId = role.Id, RoleName = role.Name, PermissionKeys = keys.ToList(), PagePermissions = rules.ToList() };
    }

    // Keys are identifiers from the navigation registry, not user text - still validated so
    // nothing odd is ever persisted.
    private static readonly Regex KeyPattern = new(@"^[A-Za-z][A-Za-z0-9_-]{0,49}$", RegexOptions.Compiled);
    private static readonly Regex PageKeyPattern = new(@"^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$", RegexOptions.Compiled);

    public async Task<bool> UpdateRolePermissionsAsync(int roleId, List<string> permissionKeys, List<PagePermissionDto>? pagePermissions, CancellationToken ct = default)
    {
        // "Module.Action" pairs; anything malformed is dropped.
        var moduleKeys = permissionKeys
            .Select(k => k.Split('.'))
            .Where(p => p.Length == 2 && KeyPattern.IsMatch(p[0]) && KeyPattern.IsMatch(p[1]))
            .Select(p => (Module: p[0], Action: p[1], Key: $"{p[0]}.{p[1]}"))
            .DistinctBy(p => p.Key, StringComparer.OrdinalIgnoreCase)
            .ToList();

        using var db = _connectionFactory.CreateConnection();
        db.Open();
        using var tx = db.BeginTransaction();

        // Administrator (IsSystemRole = 1) always keeps every permission - never editable.
        var isSystemRole = await db.ExecuteScalarAsync<bool>(new CommandDefinition(
            "SELECT IsSystemRole FROM Roles WHERE Id = @Id", new { Id = roleId }, transaction: tx, cancellationToken: ct));
        if (isSystemRole)
        {
            tx.Rollback();
            return false;
        }

        // Modules/actions are data-driven: a key the Permissions table has never seen
        // (e.g. a module added to navigation later) is registered on first use.
        foreach (var m in moduleKeys)
        {
            await db.ExecuteAsync(new CommandDefinition(@"
                IF NOT EXISTS (SELECT 1 FROM Permissions WHERE PermissionKey = @Key)
                    INSERT INTO Permissions (Module, Action, PermissionKey, Description)
                    VALUES (@Module, @Action, @Key, @Action + ' access to ' + @Module)",
                new { m.Module, m.Action, m.Key }, transaction: tx, cancellationToken: ct));
        }

        await db.ExecuteAsync(new CommandDefinition(
            "DELETE FROM RolePermissions WHERE RoleId = @RoleId", new { RoleId = roleId }, transaction: tx, cancellationToken: ct));

        if (moduleKeys.Count > 0)
        {
            await db.ExecuteAsync(new CommandDefinition(@"
                INSERT INTO RolePermissions (RoleId, PermissionId)
                SELECT @RoleId, p.Id FROM Permissions p WHERE p.PermissionKey IN @Keys",
                new { RoleId = roleId, Keys = moduleKeys.Select(m => m.Key).ToList() }, transaction: tx, cancellationToken: ct));
        }

        // Page rules are upserted per (module, page, action); rules for pages not in the payload
        // (e.g. pages since removed from navigation) are left alone - orphaned, never deleted.
        if (pagePermissions is { Count: > 0 })
        {
            try
            {
                await db.ExecuteScalarAsync<int>(new CommandDefinition("SELECT COUNT(*) FROM RolePagePermissions", transaction: tx, cancellationToken: ct));
            }
            catch (SqlException ex) when (ex.Number == InvalidObjectName)
            {
                throw new InvalidOperationException("Page-level permissions are not set up in the portal database yet. Run db/005_CreatePagePermissions.sql as a database administrator, then save again.");
            }

            foreach (var r in pagePermissions.Where(r => KeyPattern.IsMatch(r.ModuleKey) && PageKeyPattern.IsMatch(r.PageKey) && KeyPattern.IsMatch(r.Action)))
            {
                await db.ExecuteAsync(new CommandDefinition(@"
                    MERGE RolePagePermissions AS t
                    USING (SELECT @RoleId AS RoleId, @ModuleKey AS ModuleKey, @PageKey AS PageKey, @Action AS Action) AS s
                       ON t.RoleId = s.RoleId AND t.ModuleKey = s.ModuleKey AND t.PageKey = s.PageKey AND t.Action = s.Action
                    WHEN MATCHED THEN UPDATE SET IsGranted = @IsGranted, UpdatedAt = SYSUTCDATETIME()
                    WHEN NOT MATCHED THEN INSERT (RoleId, ModuleKey, PageKey, Action, IsGranted)
                         VALUES (@RoleId, @ModuleKey, @PageKey, @Action, @IsGranted);",
                    new { RoleId = roleId, r.ModuleKey, r.PageKey, r.Action, r.IsGranted }, transaction: tx, cancellationToken: ct));
            }
        }

        tx.Commit();
        return true;
    }

    public async Task<RoleAccess> GetRoleAccessAsync(string roleName, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        var role = await db.QuerySingleOrDefaultAsync<RoleLookup>(new CommandDefinition(
            "SELECT Id, IsSystemRole FROM Roles WHERE Name = @RoleName", new { RoleName = roleName }, cancellationToken: ct));
        if (role is null) return new RoleAccess(false);
        if (role.IsSystemRole) return new RoleAccess(true);

        var keys = await db.QueryAsync<string>(new CommandDefinition(@"
            SELECT p.PermissionKey FROM RolePermissions rp
            JOIN Permissions p ON p.Id = rp.PermissionId
            WHERE rp.RoleId = @RoleId", new { RoleId = role.Id }, cancellationToken: ct));

        var rules = await ReadPageRulesAsync(db, role.Id, ct);

        return new RoleAccess(false, keys,
            rules.Select(r => new KeyValuePair<string, bool>(RoleAccess.PageKey(r.ModuleKey, r.PageKey, r.Action), r.IsGranted)));
    }

    private const int InvalidObjectName = 208;

    /// <summary>Page rules for a role. If dbo.RolePagePermissions hasn't been created yet
    /// (db/005 not applied) there are simply no rules, so every page inherits its module grant.</summary>
    private static async Task<List<PagePermissionDto>> ReadPageRulesAsync(System.Data.IDbConnection db, int roleId, CancellationToken ct)
    {
        try
        {
            return (await db.QueryAsync<PagePermissionDto>(new CommandDefinition(
                "SELECT ModuleKey, PageKey, Action, IsGranted FROM RolePagePermissions WHERE RoleId = @RoleId",
                new { RoleId = roleId }, cancellationToken: ct))).ToList();
        }
        catch (SqlException ex) when (ex.Number == InvalidObjectName)
        {
            return new List<PagePermissionDto>();
        }
    }

    private sealed class RoleLookup
    {
        public int Id { get; set; }
        public bool IsSystemRole { get; set; }
    }
}
