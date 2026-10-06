using System.Text.Json.Nodes;
using SAPB1.Api.DTOs.ErpNext;

namespace SAPB1.Api.Services.ErpNext;

/// <summary>
/// Compares what ERPNext computed with what SAP charged. ERPNext + India Compliance do
/// the GST; this only checks that the result agrees with SAP, to the paisa-level tolerance
/// below, for the grand total and per tax type (CGST / SGST / IGST, plus CESS).
/// Tax amounts are compared in company currency (base_tax_amount), matching SAP's INV4.
/// </summary>
public static class ErpNextReconciler
{
    public const decimal Tolerance = 0.05m;

    public static (string Status, string Detail, decimal? ErpNextTotal) Reconcile(JsonNode erpInvoice, ErpNextPreviewDto preview)
    {
        var differences = new List<string>();
        var notes = new List<string>();

        // ---- grand total (accept either the exact or the rounded total, since SAP may or may not round)
        var grand = Dec(erpInvoice["grand_total"]);
        var rounded = Dec(erpInvoice["rounded_total"]);
        decimal? erpTotal = grand;
        var sapTotal = preview.SapTotal;
        var totalOk = grand is not null && Math.Abs(grand.Value - sapTotal) <= Tolerance
                      || rounded is { } r && r != 0 && Math.Abs(r - sapTotal) <= Tolerance;
        if (totalOk)
        {
            notes.Add($"Total: SAP {sapTotal:0.00} = ERPNext {grand:0.00}.");
        }
        else
        {
            differences.Add($"Total: SAP {sapTotal:0.00} vs ERPNext {grand?.ToString("0.00") ?? "n/a"}.");
        }

        // ---- per tax type
        var erpTax = new Dictionary<string, decimal>();
        foreach (var row in erpInvoice["taxes"] as JsonArray ?? new JsonArray())
        {
            if (row is null) continue;
            var type = ClassifyAccountHead(row["account_head"]?.GetValue<string>(), row["description"]?.GetValue<string>());
            var amount = Dec(row["base_tax_amount"]) ?? Dec(row["tax_amount"]) ?? 0m;
            erpTax[type] = erpTax.GetValueOrDefault(type) + amount;
        }

        foreach (var type in new[] { "CGST", "SGST", "IGST", "CESS" }
                     .Union(preview.SapTaxSummary.Keys).Union(erpTax.Keys).Distinct())
        {
            var sap = preview.SapTaxSummary.GetValueOrDefault(type);
            var erp = erpTax.GetValueOrDefault(type);
            if (sap == 0 && erp == 0) continue;
            if (Math.Abs(sap - erp) > Tolerance)
            {
                differences.Add($"{type}: SAP {sap:0.00} vs ERPNext {erp:0.00}.");
            }
            else
            {
                notes.Add($"{type}: SAP {sap:0.00} = ERPNext {erp:0.00}.");
            }
        }

        return differences.Count == 0
            ? ("Match", string.Join(" ", notes), erpTotal)
            : ("Mismatch", $"Differences over {Tolerance:0.00}: " + string.Join(" ", differences), erpTotal);
    }

    /// <summary>
    /// ERPNext GST account names carry the tax type anywhere in the name ("3300012 - IGST on Sales - TTCPL"), unlike SAP's
    /// INV4 codes which start with it, so this matches by containment. UTGST is reported under SGST, as in the SAP summary.
    /// </summary>
    private static string ClassifyAccountHead(string? accountHead, string? description)
    {
        foreach (var text in new[] { accountHead, description })
        {
            var t = (text ?? string.Empty).ToUpperInvariant();
            if (t.Contains("IGST")) return "IGST";
            if (t.Contains("CGST")) return "CGST";
            if (t.Contains("SGST") || t.Contains("UTGST")) return "SGST";
            if (t.Contains("CESS")) return "CESS";
        }
        return "Other";
    }

    private static decimal? Dec(JsonNode? node)
    {
        if (node is null) return null;
        try { return node.GetValue<decimal>(); }
        catch (Exception ex) when (ex is FormatException or InvalidOperationException)
        {
            // ERPNext returns JSON numbers as double.
            try { return (decimal)node.GetValue<double>(); }
            catch (Exception ex2) when (ex2 is FormatException or InvalidOperationException) { return null; }
        }
    }
}
