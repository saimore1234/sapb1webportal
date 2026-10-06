using System.Text.Json.Nodes;
using SAPB1.Api.DTOs.ErpNext;
using SAPB1.Api.Interfaces;

namespace SAPB1.Api.Services.ErpNext;

/// <summary>
/// One-time setup actions for a company's ERPNext site: verify connectivity and
/// configuration, and create the custom fields the push relies on. Both are
/// safe to re-run. Neither touches SAP.
/// </summary>
public class ErpNextAdminService : IErpNextAdminService
{
    private readonly IErpNextConfigProvider _configProvider;
    private readonly IErpNextClient _client;
    private readonly IErpNextActionLog _actionLog;
    private readonly ICompanyContext _companyContext;

    public ErpNextAdminService(
        IErpNextConfigProvider configProvider,
        IErpNextClient client,
        IErpNextActionLog actionLog,
        ICompanyContext companyContext)
    {
        _configProvider = configProvider;
        _client = client;
        _actionLog = actionLog;
        _companyContext = companyContext;
    }

    // Custom fields on ERPNext. sap_b1_key is the duplicate-safety key
    // "{CompanyCode}|{DocEntry}" (Sales Invoice) / "{CompanyCode}|{CardCode|ItemCode|address}" (masters).
    //
    // Unique is enforced by the database ONLY on Sales Invoice — the one document where a duplicate is
    // costly and where every row will carry a value. On Customer/Address/Item the field is indexed and the
    // push looks it up before creating; a unique index there could collide with blank values on records
    // already in the site.
    private sealed record FieldSpec(string DocType, string FieldName, string Label, string InsertAfter, bool Unique);

    private static readonly FieldSpec[] Fields =
    {
        new("Sales Invoice", "sap_b1_key",    "SAP B1 Key",    "po_no",         Unique: true),
        new("Sales Invoice", "sap_b1_docnum", "SAP B1 DocNum", "sap_b1_key",    Unique: false),
        new("Customer",      "sap_b1_key",    "SAP B1 Key",    "customer_name", Unique: false),
        new("Address",       "sap_b1_key",    "SAP B1 Key",    "address_title", Unique: false),
        new("Item",          "sap_b1_key",    "SAP B1 Key",    "item_name",     Unique: false),
    };

    // -------------------------------------------------------------
    // TEST CONNECTION
    // -------------------------------------------------------------
    public async Task<ErpNextCheckResultDto> TestConnectionAsync(CancellationToken ct = default)
    {
        var cfg = _configProvider.GetForCurrentCompany();
        var result = new ErpNextCheckResultDto
        {
            CompanyCode = _companyContext.CompanyCode,
            BaseUrl = cfg.BaseUrl,
            ErpNextCompany = cfg.Company
        };

        // 1. Credentials work. If this fails nothing else can be checked.
        var authOk = await RunCheckAsync(result, "API credentials", async () =>
        {
            var node = await _client.GetAsync(cfg, "/api/method/frappe.auth.get_logged_user", null, ct);
            var user = node?["message"]?.GetValue<string>();
            return string.IsNullOrWhiteSpace(user) ? (false, "No user returned.") : (true, $"Authenticated as {user}.");
        });

        if (authOk)
        {
            // 2. The configured ERPNext company exists.
            await RunCheckAsync(result, "ERPNext company", async () =>
            {
                var doc = await _client.GetDocAsync(cfg, "Company", cfg.Company, ct);
                if (doc is null) return (false, $"Company '{cfg.Company}' was not found on the site.");
                var currency = doc["default_currency"]?.GetValue<string>();
                return (true, $"Found '{cfg.Company}' (currency {currency ?? "n/a"}).");
            });

            // 3. India Compliance is installed (its GST Settings single doctype exists).
            await RunCheckAsync(result, "India Compliance", async () =>
            {
                var doc = await _client.GetDocAsync(cfg, "GST Settings", "GST Settings", ct);
                return doc is null
                    ? (false, "GST Settings was not found — India Compliance does not appear to be installed.")
                    : (true, "GST Settings is present.");
            });

            // 4. The configured company GSTIN is present (format already validated by the config provider).
            AddCheck(result, "Company GSTIN configured", !string.IsNullOrWhiteSpace(cfg.CompanyGstin),
                string.IsNullOrWhiteSpace(cfg.CompanyGstin)
                    ? "CompanyGstin is not configured — push is blocked until it is set (it must equal the SAP branch GSTIN)."
                    : $"{cfg.CompanyGstin}");

            // 5. Tax templates named in config exist on the site.
            foreach (var (label, name) in new[] { ("Intra-state tax template", cfg.TaxTemplateIntra), ("Inter-state tax template", cfg.TaxTemplateInter) })
            {
                if (string.IsNullOrWhiteSpace(name))
                {
                    AddCheck(result, label, false, "Not configured.");
                    continue;
                }
                await RunCheckAsync(result, label, async () =>
                {
                    var doc = await _client.GetDocAsync(cfg, "Sales Taxes and Charges Template", name, ct);
                    return doc is null ? (false, $"'{name}' was not found.") : (true, $"'{name}' found.");
                });
            }

            // 6. Every Item Tax Template named in TaxCodeMap exists.
            if (cfg.TaxCodeMap.Count == 0)
            {
                AddCheck(result, "Tax code map", false, "TaxCodeMap is empty — every SAP TaxCode must map to an Item Tax Template.");
            }
            foreach (var (sapCode, templateName) in cfg.TaxCodeMap)
            {
                await RunCheckAsync(result, $"Item Tax Template for {sapCode}", async () =>
                {
                    var doc = await _client.GetDocAsync(cfg, "Item Tax Template", templateName, ct);
                    return doc is null ? (false, $"'{templateName}' was not found.") : (true, $"'{templateName}' found.");
                });
            }

            // 7. The custom fields exist (informational — fixed by running Create custom fields).
            foreach (var f in Fields)
            {
                await RunCheckAsync(result, $"Custom field {f.DocType}.{f.FieldName}", async () =>
                {
                    var doc = await _client.GetDocAsync(cfg, "Custom Field", $"{f.DocType}-{f.FieldName}", ct);
                    return doc is null ? (false, "Missing — run Create custom fields.") : (true, "Present.");
                });
            }
        }

        result.Success = result.Checks.All(c => c.Ok);
        await _actionLog.LogAsync(_companyContext.CompanyCode, null, "TestConnection", result.Success,
            result.Success ? "All checks passed." : $"{result.Checks.Count(c => !c.Ok)} of {result.Checks.Count} checks failed.", ct);
        return result;
    }

    // -------------------------------------------------------------
    // CREATE CUSTOM FIELDS
    // -------------------------------------------------------------
    public async Task<ErpNextCustomFieldsResultDto> CreateCustomFieldsAsync(CancellationToken ct = default)
    {
        var cfg = _configProvider.GetForCurrentCompany();
        var result = new ErpNextCustomFieldsResultDto();

        foreach (var f in Fields)
        {
            var item = new ErpNextCustomFieldResultDto { DocType = f.DocType, FieldName = f.FieldName };
            try
            {
                var existing = await _client.GetDocAsync(cfg, "Custom Field", $"{f.DocType}-{f.FieldName}", ct);
                if (existing is not null)
                {
                    item.Outcome = "AlreadyExists";
                }
                else
                {
                    var body = new JsonObject
                    {
                        ["dt"] = f.DocType,
                        ["fieldname"] = f.FieldName,
                        ["label"] = f.Label,
                        ["fieldtype"] = "Data",
                        ["insert_after"] = f.InsertAfter,
                        ["unique"] = f.Unique ? 1 : 0,
                        ["read_only"] = 1,
                        ["no_copy"] = 1,
                        ["search_index"] = 1,
                        ["description"] = "Set by the SAP B1 Web Portal integration. Do not edit."
                    };
                    await _client.PostAsync(cfg, "/api/resource/Custom%20Field", body, ct);
                    item.Outcome = "Created";
                }
            }
            catch (ErpNextException ex)
            {
                item.Outcome = "Failed";
                item.Detail = ex.Message;
            }
            result.Fields.Add(item);
        }

        result.Success = result.Fields.All(f => f.Outcome != "Failed");
        await _actionLog.LogAsync(_companyContext.CompanyCode, null, "CreateCustomFields", result.Success,
            string.Join(", ", result.Fields.Select(f => $"{f.DocType}.{f.FieldName}={f.Outcome}")), ct);
        return result;
    }

    // -------------------------------------------------------------
    private static void AddCheck(ErpNextCheckResultDto result, string name, bool ok, string detail) =>
        result.Checks.Add(new ErpNextCheckDto { Name = name, Ok = ok, Detail = detail });

    private static async Task<bool> RunCheckAsync(ErpNextCheckResultDto result, string name, Func<Task<(bool Ok, string Detail)>> check)
    {
        try
        {
            var (ok, detail) = await check();
            AddCheck(result, name, ok, detail);
            return ok;
        }
        catch (ErpNextException ex)
        {
            AddCheck(result, name, false, ex.Message);
            return false;
        }
    }
}
