using Dapper;
using SAPB1.Api.Interfaces;

namespace SAPB1.Api.Services.ErpNext;

/// <summary>Writes dbo.ErpNextActionLog in the portal database (same shape/style as SqlAuditLogService).</summary>
public class SqlErpNextActionLog : IErpNextActionLog
{
    private readonly IPortalConnectionFactory _connectionFactory;
    private readonly IHttpContextAccessor _httpContextAccessor;

    public SqlErpNextActionLog(IPortalConnectionFactory connectionFactory, IHttpContextAccessor httpContextAccessor)
    {
        _connectionFactory = connectionFactory;
        _httpContextAccessor = httpContextAccessor;
    }

    public async Task LogAsync(string companyCode, int? docEntry, string action, bool success, string? detail, CancellationToken ct = default)
    {
        var performedBy = _httpContextAccessor.HttpContext?.User?.Identity?.Name;
        if (string.IsNullOrWhiteSpace(performedBy)) performedBy = "system";

        using var db = _connectionFactory.CreateConnection();
        const string sql = @"
            INSERT INTO ErpNextActionLog (CompanyCode, DocEntry, Action, PerformedBy, PerformedAtUtc, Success, Detail)
            VALUES (@CompanyCode, @DocEntry, @Action, @PerformedBy, SYSUTCDATETIME(), @Success, @Detail)";

        await db.ExecuteAsync(new CommandDefinition(sql, new
        {
            CompanyCode = companyCode,
            DocEntry = docEntry,
            Action = action,
            PerformedBy = performedBy,
            Success = success,
            Detail = detail is { Length: > 1000 } ? detail[..1000] : detail
        }, cancellationToken: ct));
    }
}
