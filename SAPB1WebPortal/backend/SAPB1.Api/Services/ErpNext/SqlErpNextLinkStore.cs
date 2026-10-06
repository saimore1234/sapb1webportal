using Dapper;
using Microsoft.Data.SqlClient;
using SAPB1.Api.Interfaces;

namespace SAPB1.Api.Services.ErpNext;

/// <summary>
/// dbo.ErpNextInvoiceLink in the portal database (never a SAP database). The unique
/// index on (CompanyCode, DocEntry) is the duplicate guard: ClaimAsync inserts the
/// 'Pushing' row first, so of two concurrent pushes exactly one wins the insert.
/// A 'Pushing' row older than <see cref="StaleAfterMinutes"/> is treated as abandoned
/// (e.g. the API restarted mid-push) and may be re-claimed; a 'Failed' row may be retried.
/// </summary>
public class SqlErpNextLinkStore : IErpNextLinkStore
{
    private const int StaleAfterMinutes = 10;

    private const string SelectSql = @"
        SELECT Id, CompanyCode, DocEntry, DocNum, SapB1Key, ErpNextCompany, PushStatus, ErpNextInvoiceName,
               ErpNextDocStatus, SapTotal, ErpNextGrandTotal, ReconStatus, ReconDetail, PushedAtUtc, PushedBy,
               LastError, LastSyncedAtUtc, UpdatedAt,
               Irn, AckNo, AckDate, EInvoiceStatus, EInvoiceAtUtc, EInvoiceBy, EInvoiceError,
               EwbNo, EwbDate, EwbValidUpto, EwbStatus, EwbAtUtc, EwbBy, EwbError,
               EInvoiceCancelledAtUtc, EInvoiceCancelReason, EInvoiceCancelledBy,
               EwbCancelledAtUtc, EwbCancelReason, EwbCancelledBy
        FROM ErpNextInvoiceLink
        WHERE CompanyCode = @CompanyCode AND DocEntry = @DocEntry";

    private readonly IPortalConnectionFactory _connectionFactory;

    public SqlErpNextLinkStore(IPortalConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory;
    }

    public async Task<ErpNextInvoiceLinkRow?> GetAsync(string companyCode, int docEntry, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        return await db.QuerySingleOrDefaultAsync<ErpNextInvoiceLinkRow>(
            new CommandDefinition(SelectSql, new { CompanyCode = companyCode, DocEntry = docEntry }, cancellationToken: ct));
    }

    public async Task<(LinkClaimOutcome Outcome, ErpNextInvoiceLinkRow Link)> ClaimAsync(
        string companyCode, int docEntry, int docNum, string sapKey, string erpNextCompany, string user, CancellationToken ct = default)
    {
        using var db = _connectionFactory.CreateConnection();
        var key = new { CompanyCode = companyCode, DocEntry = docEntry };

        // 1. Try to be the first: insert the 'Pushing' row. The unique index rejects a second claimer.
        const string insertSql = @"
            INSERT INTO ErpNextInvoiceLink (CompanyCode, DocEntry, DocNum, SapB1Key, ErpNextCompany, PushStatus, PushedBy)
            VALUES (@CompanyCode, @DocEntry, @DocNum, @SapKey, @ErpNextCompany, 'Pushing', @User)";
        try
        {
            await db.ExecuteAsync(new CommandDefinition(insertSql,
                new { CompanyCode = companyCode, DocEntry = docEntry, DocNum = docNum, SapKey = sapKey, ErpNextCompany = erpNextCompany, User = user },
                cancellationToken: ct));
            var created = await db.QuerySingleAsync<ErpNextInvoiceLinkRow>(new CommandDefinition(SelectSql, key, cancellationToken: ct));
            return (LinkClaimOutcome.Claimed, created);
        }
        catch (SqlException ex) when (ex.Number is 2601 or 2627)
        {
            // A row already exists — fall through and look at it.
        }

        var existing = await db.QuerySingleAsync<ErpNextInvoiceLinkRow>(new CommandDefinition(SelectSql, key, cancellationToken: ct));
        if (existing.PushStatus == "Pushed") return (LinkClaimOutcome.AlreadyPushed, existing);

        // 2. A previous attempt Failed, or its 'Pushing' claim went stale: take it over atomically.
        const string reclaimSql = @"
            UPDATE ErpNextInvoiceLink
            SET PushStatus = 'Pushing', LastError = NULL, PushedBy = @User, DocNum = @DocNum,
                ErpNextCompany = @ErpNextCompany, UpdatedAt = SYSUTCDATETIME()
            WHERE Id = @Id
              AND (PushStatus = 'Failed'
                   OR (PushStatus = 'Pushing' AND UpdatedAt < DATEADD(MINUTE, -@StaleAfterMinutes, SYSUTCDATETIME())))";
        var rows = await db.ExecuteAsync(new CommandDefinition(reclaimSql,
            new { existing.Id, User = user, DocNum = docNum, ErpNextCompany = erpNextCompany, StaleAfterMinutes },
            cancellationToken: ct));
        if (rows == 1)
        {
            var reclaimed = await db.QuerySingleAsync<ErpNextInvoiceLinkRow>(new CommandDefinition(SelectSql, key, cancellationToken: ct));
            return (LinkClaimOutcome.Claimed, reclaimed);
        }

        // Someone else holds a fresh claim (or it just finished).
        var current = await db.QuerySingleAsync<ErpNextInvoiceLinkRow>(new CommandDefinition(SelectSql, key, cancellationToken: ct));
        return (current.PushStatus == "Pushed" ? LinkClaimOutcome.AlreadyPushed : LinkClaimOutcome.InProgress, current);
    }

    public async Task MarkPushedAsync(int id, string invoiceName, string? docStatus, decimal sapTotal, decimal? erpNextTotal,
        string reconStatus, string reconDetail)
    {
        using var db = _connectionFactory.CreateConnection();
        const string sql = @"
            UPDATE ErpNextInvoiceLink
            SET PushStatus = 'Pushed', ErpNextInvoiceName = @InvoiceName, ErpNextDocStatus = @DocStatus,
                SapTotal = @SapTotal, ErpNextGrandTotal = @ErpNextTotal, ReconStatus = @ReconStatus, ReconDetail = @ReconDetail,
                PushedAtUtc = SYSUTCDATETIME(), LastSyncedAtUtc = SYSUTCDATETIME(), LastError = NULL, UpdatedAt = SYSUTCDATETIME()
            WHERE Id = @Id";
        await db.ExecuteAsync(sql, new
        {
            Id = id, InvoiceName = invoiceName, DocStatus = docStatus, SapTotal = sapTotal, ErpNextTotal = erpNextTotal,
            ReconStatus = reconStatus, ReconDetail = Truncate(reconDetail, 2000)
        });
    }

    public async Task MarkFailedAsync(int id, string error)
    {
        using var db = _connectionFactory.CreateConnection();
        const string sql = @"
            UPDATE ErpNextInvoiceLink
            SET PushStatus = 'Failed', LastError = @Error, UpdatedAt = SYSUTCDATETIME()
            WHERE Id = @Id AND PushStatus = 'Pushing'";
        await db.ExecuteAsync(sql, new { Id = id, Error = Truncate(error, 1000) });
    }


    // ------------------------------------------------------------------ e-invoice / e-way bill
    // The column names below are fixed constants chosen by `kind` — never built from input.

    public async Task<bool> BeginComplianceAsync(int id, string kind, string user)
    {
        var sql = kind switch
        {
            "EInvoice" => @"
                UPDATE ErpNextInvoiceLink
                SET EInvoiceStatus = 'Generating', EInvoiceBy = @User, EInvoiceError = NULL, UpdatedAt = SYSUTCDATETIME()
                WHERE Id = @Id AND PushStatus = 'Pushed'
                  AND (EInvoiceStatus IS NULL OR EInvoiceStatus = 'Failed'
                       OR (EInvoiceStatus = 'Generating' AND UpdatedAt < DATEADD(MINUTE, -@StaleAfterMinutes, SYSUTCDATETIME())))",
            "Ewb" => @"
                UPDATE ErpNextInvoiceLink
                SET EwbStatus = 'Generating', EwbBy = @User, EwbError = NULL, UpdatedAt = SYSUTCDATETIME()
                WHERE Id = @Id AND PushStatus = 'Pushed'
                  AND (EwbStatus IS NULL OR EwbStatus IN ('Failed', 'Cancelled')
                       OR (EwbStatus = 'Generating' AND UpdatedAt < DATEADD(MINUTE, -@StaleAfterMinutes, SYSUTCDATETIME())))",
            _ => throw new ArgumentException("Unknown compliance kind.", nameof(kind))
        };
        using var db = _connectionFactory.CreateConnection();
        return await db.ExecuteAsync(sql, new { Id = id, User = user, StaleAfterMinutes }) == 1;
    }

    public async Task MarkEInvoiceGeneratedAsync(int id, string irn, string? ackNo, DateTime? ackDate, string? erpNextDocStatus)
    {
        using var db = _connectionFactory.CreateConnection();
        const string sql = @"
            UPDATE ErpNextInvoiceLink
            SET Irn = @Irn, AckNo = @AckNo, AckDate = @AckDate, EInvoiceStatus = 'Generated', EInvoiceAtUtc = SYSUTCDATETIME(),
                EInvoiceError = NULL, ErpNextDocStatus = COALESCE(@DocStatus, ErpNextDocStatus),
                LastSyncedAtUtc = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
            WHERE Id = @Id";
        await db.ExecuteAsync(sql, new { Id = id, Irn = irn, AckNo = ackNo, AckDate = ackDate, DocStatus = erpNextDocStatus });
    }

    public async Task MarkEwayBillGeneratedAsync(int id, string ewbNo, DateTime? ewbDate, DateTime? validUpto, string? erpNextDocStatus)
    {
        using var db = _connectionFactory.CreateConnection();
        const string sql = @"
            UPDATE ErpNextInvoiceLink
            SET EwbNo = @EwbNo, EwbDate = @EwbDate, EwbValidUpto = @ValidUpto, EwbStatus = 'Generated', EwbAtUtc = SYSUTCDATETIME(),
                EwbError = NULL, ErpNextDocStatus = COALESCE(@DocStatus, ErpNextDocStatus),
                LastSyncedAtUtc = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
            WHERE Id = @Id";
        await db.ExecuteAsync(sql, new { Id = id, EwbNo = ewbNo, EwbDate = ewbDate, ValidUpto = validUpto, DocStatus = erpNextDocStatus });
    }

    public async Task MarkComplianceFailedAsync(int id, string kind, string error, string? erpNextDocStatus)
    {
        var sql = kind switch
        {
            "EInvoice" => @"
                UPDATE ErpNextInvoiceLink
                SET EInvoiceStatus = 'Failed', EInvoiceError = @Error, ErpNextDocStatus = COALESCE(@DocStatus, ErpNextDocStatus), UpdatedAt = SYSUTCDATETIME()
                WHERE Id = @Id AND EInvoiceStatus = 'Generating'",
            "Ewb" => @"
                UPDATE ErpNextInvoiceLink
                SET EwbStatus = 'Failed', EwbError = @Error, ErpNextDocStatus = COALESCE(@DocStatus, ErpNextDocStatus), UpdatedAt = SYSUTCDATETIME()
                WHERE Id = @Id AND EwbStatus = 'Generating'",
            _ => throw new ArgumentException("Unknown compliance kind.", nameof(kind))
        };
        using var db = _connectionFactory.CreateConnection();
        await db.ExecuteAsync(sql, new { Id = id, Error = Truncate(error, 1000), DocStatus = erpNextDocStatus });
    }

    /// <summary>Mirrors ERPNext onto the link row. A generation that is mid-flight is left alone; an IRN / e-way bill that
    /// ERPNext no longer shows (cancelled there) is recorded as Cancelled rather than silently kept.</summary>
    public async Task SyncAsync(int id, ErpNextSyncSnapshot s)
    {
        using var db = _connectionFactory.CreateConnection();
        const string sql = @"
            UPDATE ErpNextInvoiceLink
            SET ErpNextDocStatus = COALESCE(@DocStatus, ErpNextDocStatus),
                ErpNextGrandTotal = COALESCE(@GrandTotal, ErpNextGrandTotal),
                -- ERPNext clears the IRN / e-way bill number when they are cancelled; keep ours for the record.
                Irn = COALESCE(@Irn, Irn), AckNo = COALESCE(@AckNo, AckNo), AckDate = COALESCE(@AckDate, AckDate),
                EInvoiceStatus = CASE
                    WHEN @Irn IS NOT NULL THEN 'Generated'
                    WHEN EInvoiceStatus IN ('Generating', 'Cancelling') THEN EInvoiceStatus
                    WHEN EInvoiceStatus = 'Generated' THEN 'Cancelled'
                    ELSE EInvoiceStatus END,
                EwbNo = COALESCE(@EwbNo, EwbNo), EwbDate = COALESCE(@EwbDate, EwbDate), EwbValidUpto = COALESCE(@EwbValidUpto, EwbValidUpto),
                EwbStatus = CASE
                    WHEN @EwbNo IS NOT NULL THEN 'Generated'
                    WHEN EwbStatus IN ('Generating', 'Cancelling') THEN EwbStatus
                    WHEN EwbStatus = 'Generated' THEN 'Cancelled'
                    ELSE EwbStatus END,
                LastSyncedAtUtc = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
            WHERE Id = @Id";
        await db.ExecuteAsync(sql, new
        {
            Id = id, s.DocStatus, s.GrandTotal, s.Irn, s.AckNo, s.AckDate,
            s.EwbNo, s.EwbDate, s.EwbValidUpto
        });
    }

    // ------------------------------------------------------------------------------- cancellation
    // Column names below are fixed constants chosen by `kind` — never built from input.

    public async Task<bool> BeginCancelAsync(int id, string kind)
    {
        var sql = kind switch
        {
            "EInvoice" => @"
                UPDATE ErpNextInvoiceLink
                SET EInvoiceStatus = 'Cancelling', EInvoiceError = NULL, UpdatedAt = SYSUTCDATETIME()
                WHERE Id = @Id AND PushStatus = 'Pushed'
                  AND (EInvoiceStatus = 'Generated'
                       OR (EInvoiceStatus = 'Cancelling' AND UpdatedAt < DATEADD(MINUTE, -@StaleAfterMinutes, SYSUTCDATETIME())))",
            "Ewb" => @"
                UPDATE ErpNextInvoiceLink
                SET EwbStatus = 'Cancelling', EwbError = NULL, UpdatedAt = SYSUTCDATETIME()
                WHERE Id = @Id AND PushStatus = 'Pushed'
                  AND (EwbStatus = 'Generated'
                       OR (EwbStatus = 'Cancelling' AND UpdatedAt < DATEADD(MINUTE, -@StaleAfterMinutes, SYSUTCDATETIME())))",
            _ => throw new ArgumentException("Unknown compliance kind.", nameof(kind))
        };
        using var db = _connectionFactory.CreateConnection();
        return await db.ExecuteAsync(sql, new { Id = id, StaleAfterMinutes }) == 1;
    }

    public async Task MarkCancelledAsync(int id, string kind, string reason, string user, string? erpNextDocStatus)
    {
        var sql = kind switch
        {
            "EInvoice" => @"
                UPDATE ErpNextInvoiceLink
                SET EInvoiceStatus = 'Cancelled', EInvoiceCancelledAtUtc = SYSUTCDATETIME(), EInvoiceCancelReason = @Reason,
                    EInvoiceCancelledBy = @User, EInvoiceError = NULL, ErpNextDocStatus = COALESCE(@DocStatus, ErpNextDocStatus),
                    LastSyncedAtUtc = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
                WHERE Id = @Id",
            "Ewb" => @"
                UPDATE ErpNextInvoiceLink
                SET EwbStatus = 'Cancelled', EwbCancelledAtUtc = SYSUTCDATETIME(), EwbCancelReason = @Reason,
                    EwbCancelledBy = @User, EwbError = NULL, ErpNextDocStatus = COALESCE(@DocStatus, ErpNextDocStatus),
                    LastSyncedAtUtc = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
                WHERE Id = @Id",
            _ => throw new ArgumentException("Unknown compliance kind.", nameof(kind))
        };
        using var db = _connectionFactory.CreateConnection();
        await db.ExecuteAsync(sql, new { Id = id, Reason = Truncate(reason, 150), User = user, DocStatus = erpNextDocStatus });
    }

    public async Task MarkCancelFailedAsync(int id, string kind, string error)
    {
        var sql = kind switch
        {
            "EInvoice" => @"
                UPDATE ErpNextInvoiceLink
                SET EInvoiceStatus = 'Generated', EInvoiceError = @Error, UpdatedAt = SYSUTCDATETIME()
                WHERE Id = @Id AND EInvoiceStatus = 'Cancelling'",
            "Ewb" => @"
                UPDATE ErpNextInvoiceLink
                SET EwbStatus = 'Generated', EwbError = @Error, UpdatedAt = SYSUTCDATETIME()
                WHERE Id = @Id AND EwbStatus = 'Cancelling'",
            _ => throw new ArgumentException("Unknown compliance kind.", nameof(kind))
        };
        using var db = _connectionFactory.CreateConnection();
        await db.ExecuteAsync(sql, new { Id = id, Error = Truncate(error, 1000) });
    }

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];
}
