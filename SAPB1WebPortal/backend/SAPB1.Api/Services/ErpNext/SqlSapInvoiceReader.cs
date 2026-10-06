using System.Data;
using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Data.SqlClient;
using SAPB1.Api.Interfaces;

namespace SAPB1.Api.Services.ErpNext;

/// <summary>
/// Read-only Dapper reads of one A/R Invoice for the ERPNext push, against the
/// CURRENT company's SAP database (ICompanyConnectionFactory). Uses the SAP
/// India-localization columns confirmed in discovery; if a required column or
/// table is missing at runtime it throws <see cref="SapDataException"/> naming it
/// rather than guessing. The OINV user fields are the one exception: they are
/// optional extras, read only for the ones that exist in this company's database.
/// </summary>
public class SqlSapInvoiceReader : ISapInvoiceReader
{
    private static readonly string[] OptionalUdfs =
    {
        "U_Transporter", "U_GateInVehicleNo", "U_LRNo", "U_LrDate", "U_RoadPermitNo", "U_PORefNo"
    };

    private static readonly Regex MissingObject = new(@"Invalid (column|object) name '([^']+)'", RegexOptions.Compiled);

    private readonly ICompanyConnectionFactory _connectionFactory;

    public SqlSapInvoiceReader(ICompanyConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory;
    }

    public async Task<SapInvoiceData?> ReadAsync(int docEntry, CancellationToken ct = default)
    {
        try
        {
            using var db = _connectionFactory.CreateConnection();
            return await ReadCoreAsync(db, docEntry, ct);
        }
        catch (SqlException ex) when (ex.Number is 207 or 208)
        {
            var m = MissingObject.Match(ex.Message);
            var what = m.Success ? $"{m.Groups[1].Value} '{m.Groups[2].Value}'" : "a column or table";
            throw new SapDataException(
                $"This SAP database is missing {what}, which the ERPNext integration expects (SAP India localization). " +
                "Nothing was guessed or sent.");
        }
    }

    private static async Task<SapInvoiceData?> ReadCoreAsync(IDbConnection db, int docEntry, CancellationToken ct)
    {
        var p = new { DocEntry = docEntry };

        const string headerSql = @"
            SELECT h.DocEntry, h.DocNum, h.CardCode, COALESCE(NULLIF(h.CardName, N''), c.CardName) AS CardName,
                   h.DocDate, h.DocDueDate, h.DocCur, h.DocRate,
                   h.DocTotal, h.DocTotalFC, h.Comments, h.NumAtCard, h.PayToCode, h.ShipToCode,
                   h.GSTTranTyp, h.ShipState, h.CANCELED AS Canceled, h.DocStatus
            FROM OINV h
            LEFT JOIN OCRD c ON c.CardCode = h.CardCode
            WHERE h.DocEntry = @DocEntry";
        var header = await db.QuerySingleOrDefaultAsync<SapInvoiceHeader>(new CommandDefinition(headerSql, p, cancellationToken: ct));
        if (header is null) return null;

        var data = new SapInvoiceData { Header = header };

        const string gstSql = @"
            SELECT BpGSTN, BpGSTType, BpStateCod, LocGSTN, LocGSTType, LocStaGSTN
            FROM INV12
            WHERE DocEntry = @DocEntry";
        data.Gst = await db.QuerySingleOrDefaultAsync<SapInvoiceGstInfo>(new CommandDefinition(gstSql, p, cancellationToken: ct));

        // HSN: INV1.HsnEntry -> OCHP.AbsEntry (code = ChapterID); SAC: INV1.SacEntry -> OSAC.AbsEntry (code = ServCode).
        // When the line value is null/0, fall back to the item master (OITM.ChapterID / OITM.SACEntry).
        const string linesSql = @"
            SELECT l.LineNum, l.ItemCode, l.Dscription, l.Quantity, l.Price, l.DiscPrcnt, l.TaxCode, l.LineTotal,
                   l.unitMsr AS UnitMsr, l.WhsCode, l.HsnEntry, l.SacEntry,
                   ch.ChapterID AS HsnCode, sc.ServCode AS SacCode
            FROM INV1 l
            LEFT JOIN OITM i  ON i.ItemCode = l.ItemCode
            LEFT JOIN OCHP ch ON ch.AbsEntry = COALESCE(NULLIF(l.HsnEntry, 0), NULLIF(i.ChapterID, 0))
            LEFT JOIN OSAC sc ON sc.AbsEntry = COALESCE(NULLIF(l.SacEntry, 0), NULLIF(i.SACEntry, 0))
            WHERE l.DocEntry = @DocEntry
            ORDER BY l.LineNum";
        data.Lines = (await db.QueryAsync<SapInvoiceLine>(new CommandDefinition(linesSql, p, cancellationToken: ct))).ToList();

        const string taxSql = @"
            SELECT LineNum, StcCode, StaCode, staType AS StaType, TaxRate, TaxSum, BaseSum
            FROM INV4
            WHERE DocEntry = @DocEntry
            ORDER BY LineNum";
        data.TaxLines = (await db.QueryAsync<SapInvoiceTaxLine>(new CommandDefinition(taxSql, p, cancellationToken: ct))).ToList();

        // Bill-to ('B', Address = PayToCode) and ship-to ('S', Address = ShipToCode) of the customer.
        const string addressSql = @"
            SELECT a.AdresType, a.Address, a.Street, a.Block, a.Building, a.City, a.ZipCode,
                   a.State AS StateCode, st.Name AS StateName,
                   a.Country AS CountryCode, cy.Name AS CountryName,
                   a.GSTRegnNo, a.GSTType
            FROM CRD1 a
            LEFT JOIN OCST st ON st.Code = a.State AND st.Country = a.Country
            LEFT JOIN OCRY cy ON cy.Code = a.Country
            WHERE a.CardCode = @CardCode
              AND ((a.AdresType = 'B' AND a.Address = @PayTo) OR (a.AdresType = 'S' AND a.Address = @ShipTo))";
        data.Addresses = (await db.QueryAsync<SapInvoiceAddress>(new CommandDefinition(
            addressSql, new { header.CardCode, PayTo = header.PayToCode, ShipTo = header.ShipToCode }, cancellationToken: ct))).ToList();

        const string stateSql = "SELECT Name FROM OCST WHERE Code = @Code AND Country = N'IN'";
        if (!string.IsNullOrWhiteSpace(data.Gst?.BpStateCod))
        {
            data.BpStateName = await db.ExecuteScalarAsync<string?>(new CommandDefinition(stateSql, new { Code = data.Gst!.BpStateCod }, cancellationToken: ct));
        }
        if (!string.IsNullOrWhiteSpace(header.ShipState))
        {
            data.ShipStateName = await db.ExecuteScalarAsync<string?>(new CommandDefinition(stateSql, new { Code = header.ShipState }, cancellationToken: ct));
        }

        await ReadOptionalUdfsAsync(db, docEntry, data, ct);
        return data;
    }

    /// <summary>Reads only the whitelisted OINV user fields that actually exist in this database.</summary>
    private static async Task ReadOptionalUdfsAsync(IDbConnection db, int docEntry, SapInvoiceData data, CancellationToken ct)
    {
        const string existsSql = "SELECT name FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.OINV') AND name IN @Names";
        var present = (await db.QueryAsync<string>(new CommandDefinition(existsSql, new { Names = OptionalUdfs }, cancellationToken: ct))).ToList();
        if (present.Count == 0) return;

        // Column names come from the hard-coded whitelist above (matched against sys.columns), never from input.
        var columns = OptionalUdfs.Where(u => present.Contains(u, StringComparer.OrdinalIgnoreCase)).ToList();
        var sql = $"SELECT {string.Join(", ", columns.Select(c => $"h.[{c}]"))} FROM OINV h WHERE h.DocEntry = @DocEntry";
        var row = (IDictionary<string, object>?)await db.QuerySingleOrDefaultAsync(new CommandDefinition(sql, new { DocEntry = docEntry }, cancellationToken: ct));
        if (row is null) return;

        foreach (var (key, value) in row)
        {
            data.Udfs[key] = value is DBNull ? null : value;
        }
    }
}
