using Dapper;
using SAPB1.Api.Interfaces;

namespace SAPB1.Api.Services;

/// <summary>
/// Applies db/005_CreatePagePermissions.sql idempotently at startup so page-level
/// permissions work without a manual migration step. Non-fatal: if the portal DB login
/// lacks DDL rights it logs a warning and the script can be run by hand.
/// </summary>
public class PortalSchemaBootstrapper : IHostedService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<PortalSchemaBootstrapper> _logger;

    public PortalSchemaBootstrapper(IServiceScopeFactory scopes, ILogger<PortalSchemaBootstrapper> logger)
    {
        _scopes = scopes;
        _logger = logger;
    }

    private const string Sql = @"
IF OBJECT_ID('dbo.RolePagePermissions', 'U') IS NULL
CREATE TABLE dbo.RolePagePermissions (
    RoleId INT NOT NULL,
    ModuleKey NVARCHAR(50) NOT NULL,
    PageKey NVARCHAR(100) NOT NULL,
    Action NVARCHAR(50) NOT NULL,
    IsGranted BIT NOT NULL,
    UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_RolePagePermissions PRIMARY KEY (RoleId, ModuleKey, PageKey, Action),
    CONSTRAINT FK_RolePagePermissions_Roles FOREIGN KEY (RoleId) REFERENCES dbo.Roles(Id) ON DELETE CASCADE
);";

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var scope = _scopes.CreateScope();
            using var db = scope.ServiceProvider.GetRequiredService<IPortalConnectionFactory>().CreateConnection();
            await db.ExecuteAsync(new CommandDefinition(Sql, cancellationToken: cancellationToken));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not ensure dbo.RolePagePermissions; run db/005_CreatePagePermissions.sql manually.");
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
