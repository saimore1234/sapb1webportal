using System.Text.Json.Nodes;
using SAPB1.Api.DTOs.ErpNext;
using SAPB1.Api.Interfaces;

namespace SAPB1.Api.Services.ErpNext;

/// <summary>
/// Invoice-level ERPNext operations: preview (reads SAP only) and push (creates a DRAFT
/// Sales Invoice in ERPNext). Nothing here writes to SAP, and the push never submits.
///
/// Push order, and why:
///  1. Validate with the same mapper the preview uses — a blocked invoice sends nothing.
///  2. CLAIM the link row ('Pushing', unique per company+DocEntry) before touching ERPNext,
///     so two simultaneous pushes cannot both create an invoice.
///  3. Look up ERPNext by sap_b1_key before creating — covers a previous attempt that timed
///     out after ERPNext had already saved the invoice.
///  4. Find-or-create Customer, Addresses, Item, then insert the draft invoice.
///  5. Read back ERPNext's totals and reconcile with SAP; record the result on the link.
/// </summary>
public class ErpNextInvoiceService : IErpNextInvoiceService
{
    private readonly ICompanyContext _companyContext;
    private readonly IErpNextConfigProvider _configProvider;
    private readonly ISapInvoiceReader _reader;
    private readonly IErpNextClient _client;
    private readonly ErpNextMasterSync _masters;
    private readonly IErpNextLinkStore _links;
    private readonly IErpNextActionLog _actionLog;
    private readonly ILogger<ErpNextInvoiceService> _logger;

    public ErpNextInvoiceService(
        ICompanyContext companyContext,
        IErpNextConfigProvider configProvider,
        ISapInvoiceReader reader,
        IErpNextClient client,
        ErpNextMasterSync masters,
        IErpNextLinkStore links,
        IErpNextActionLog actionLog,
        ILogger<ErpNextInvoiceService> logger)
    {
        _companyContext = companyContext;
        _configProvider = configProvider;
        _reader = reader;
        _client = client;
        _masters = masters;
        _links = links;
        _actionLog = actionLog;
        _logger = logger;
    }

    // ------------------------------------------------------------------ preview
    public async Task<ErpNextPreviewDto?> PreviewAsync(int docEntry, CancellationToken ct = default)
    {
        // Missing ERPNext settings are reported as a problem on the preview rather than failing the call,
        // so the SAP-side data can still be checked before ERPNext is configured for a company.
        var cfg = _configProvider.TryGetForCurrentCompany(out var configError);

        var sap = await _reader.ReadAsync(docEntry, ct);
        if (sap is null) return null;

        var preview = ErpNextInvoiceMapper.Map(_companyContext.CompanyCode, sap, cfg, configError);

        await _actionLog.LogAsync(_companyContext.CompanyCode, docEntry, "Preview", preview.IsValid,
            preview.IsValid ? "Clean." : $"{preview.Problems.Count} problem(s), {preview.Warnings.Count} warning(s).", ct);
        return preview;
    }

    // --------------------------------------------------------------------- status
    public async Task<ErpNextLinkStatusDto> GetStatusAsync(int docEntry, CancellationToken ct = default)
    {
        var companyCode = _companyContext.CompanyCode;
        var link = await _links.GetAsync(companyCode, docEntry, ct);
        if (link is null) return new ErpNextLinkStatusDto { DocEntry = docEntry };

        // Config may be absent (read-only status must still work); the URL is just a convenience.
        var cfg = _configProvider.TryGetForCurrentCompany(out _);
        return new ErpNextLinkStatusDto
        {
            DocEntry = docEntry,
            Status = link.PushStatus,
            InvoiceName = link.ErpNextInvoiceName,
            ErpNextDocStatus = link.ErpNextDocStatus,
            InvoiceUrl = InvoiceUrl(cfg, link.ErpNextInvoiceName),
            SapTotal = link.SapTotal,
            ErpNextGrandTotal = link.ErpNextGrandTotal,
            ReconStatus = link.ReconStatus,
            ReconDetail = link.ReconDetail,
            PushedAtUtc = link.PushedAtUtc,
            PushedBy = link.PushedBy,
            LastError = link.LastError,
            Irn = link.Irn,
            AckNo = link.AckNo,
            AckDate = link.AckDate,
            EInvoiceStatus = link.EInvoiceStatus,
            EInvoiceError = link.EInvoiceError,
            EInvoiceBy = link.EInvoiceBy,
            EwbNo = link.EwbNo,
            EwbDate = link.EwbDate,
            EwbValidUpto = link.EwbValidUpto,
            EwbStatus = link.EwbStatus,
            EwbError = link.EwbError,
            EwbBy = link.EwbBy,
            EInvoiceCancelledAtUtc = link.EInvoiceCancelledAtUtc,
            EInvoiceCancelReason = link.EInvoiceCancelReason,
            EInvoiceCancelledBy = link.EInvoiceCancelledBy,
            EwbCancelledAtUtc = link.EwbCancelledAtUtc,
            EwbCancelReason = link.EwbCancelReason,
            EwbCancelledBy = link.EwbCancelledBy,
            EInvoiceCancellableUntil = link.EInvoiceStatus == "Generated" ? link.AckDate?.AddHours(24) : null,
            EwbCancellableUntil = link.EwbStatus == "Generated" ? link.EwbDate?.AddHours(24) : null
        };
    }

    // ------------------------------------------------------------------------ push
    public async Task<ErpNextPushResultDto?> PushAsync(int docEntry, CancellationToken ct = default)
    {
        var companyCode = _companyContext.CompanyCode;
        var cfg = _configProvider.GetForCurrentCompany();

        var sap = await _reader.ReadAsync(docEntry, ct);
        if (sap is null) return null;

        // 1. Validate. A blocked invoice never reaches ERPNext and leaves no link row behind.
        var preview = ErpNextInvoiceMapper.Map(companyCode, sap, cfg, null);
        if (!preview.IsValid)
        {
            await _actionLog.LogAsync(companyCode, docEntry, "Push", false, $"Blocked: {preview.Problems.Count} problem(s).", ct);
            return new ErpNextPushResultDto
            {
                DocEntry = docEntry, DocNum = sap.Header.DocNum, Outcome = "Blocked", Problems = preview.Problems,
                SapTotal = preview.SapTotal
            };
        }

        // 2. Claim.
        var (claim, link) = await _links.ClaimAsync(
            companyCode, docEntry, sap.Header.DocNum, preview.SapKey, cfg.Company, _companyContext.Username, ct);

        if (claim == LinkClaimOutcome.AlreadyPushed)
        {
            await _actionLog.LogAsync(companyCode, docEntry, "Push", true, $"Already pushed as {link.ErpNextInvoiceName}; nothing created.", ct);
            return ToResult(cfg, link, "AlreadyPushed");
        }
        if (claim == LinkClaimOutcome.InProgress)
        {
            return new ErpNextPushResultDto
            {
                DocEntry = docEntry, DocNum = sap.Header.DocNum, Outcome = "InProgress",
                Problems = new List<string> { "Another push of this invoice is already running. Try again in a moment." }
            };
        }

        // From here on we hold the claim and MUST end with Pushed or Failed. CancellationToken.None is used for the
        // bookkeeping so a dropped HTTP request can't leave the row stuck on 'Pushing'.
        try
        {
            // 3. Already in ERPNext from an earlier attempt that never got recorded?
            if (await FindInvoiceNameAsync(cfg, preview.SapKey, ct) is { } existingName)
            {
                return await RecordAsync(cfg, link, preview, existingName, "Adopted");
            }

            // 4. Masters, then the draft.
            var created = await CreateDraftAsync(cfg, preview, ct);
            var name = created["name"]?.GetValue<string>()
                       ?? throw new ErpNextException("ERPNext did not return the new Sales Invoice name.");
            return await RecordAsync(cfg, link, preview, name, "Created", created);
        }
        catch (ErpNextException ex)
        {
            // A timeout or 5xx is ambiguous: ERPNext may have saved the invoice before the connection dropped.
            if (ex.StatusCode is null or >= 500 && await TryFindInvoiceNameAsync(cfg, preview.SapKey) is { } savedName)
            {
                _logger.LogWarning("ERPNext push for {Key} was ambiguous but the invoice exists as {Name}; adopting it.", preview.SapKey, savedName);
                return await RecordAsync(cfg, link, preview, savedName, "Adopted");
            }

            await _links.MarkFailedAsync(link.Id, ex.Message);
            await _actionLog.LogAsync(companyCode, docEntry, "Push", false, ex.Message, CancellationToken.None);
            throw;
        }
        catch (Exception ex)
        {
            await _links.MarkFailedAsync(link.Id, "Unexpected error while pushing. See the API log.");
            await _actionLog.LogAsync(companyCode, docEntry, "Push", false, "Unexpected error.", CancellationToken.None);
            _logger.LogError(ex, "Unexpected error pushing {Key} to ERPNext", preview.SapKey);
            throw;
        }
    }

    // -------------------------------------------------------------- draft creation
    private async Task<JsonNode> CreateDraftAsync(ErpNextCompanyOptions cfg, ErpNextPreviewDto preview, CancellationToken ct)
    {
        var payload = preview.PayloadNode ?? throw new ErpNextException("Nothing to send: the invoice payload could not be built.");

        // Prerequisites the invoice lines link to.
        foreach (var uom in preview.Items.Select(i => i.Uom!).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            await _masters.EnsureUomExistsAsync(cfg, uom, ct);
        }
        foreach (var item in preview.Items.Where(i => !string.IsNullOrWhiteSpace(i.HsnSacCode)).DistinctBy(i => i.HsnSacCode))
        {
            await _masters.EnsureHsnCodeAsync(cfg, item.HsnSacCode!, item.ItemName, ct);
        }

        // Masters.
        var customerName = await _masters.EnsureCustomerAsync(cfg, preview.Customer!, ct);
        payload["customer"] = customerName;

        foreach (var addr in preview.Addresses)
        {
            var addressName = await _masters.EnsureAddressAsync(cfg, addr, customerName, ct);
            payload[addr.Type == "Billing" ? "customer_address" : "shipping_address_name"] = addressName;
        }

        foreach (var item in preview.Items)
        {
            await _masters.EnsureItemAsync(cfg, item, ct);
        }

        // The company's own GSTIN address (India Compliance reads company_gstin from it), if the site has one.
        if (await FindCompanyAddressAsync(cfg, ct) is { } companyAddress)
        {
            payload["company_address"] = companyAddress;
        }

        // ERPNext fills the taxes table and per-item tax rates from templates only in its UI. Over the API they must
        // be supplied, so copy them from ERPNext's OWN templates (no tax is calculated here).
        await AttachTaxesAsync(cfg, preview, payload, ct);

        var response = await _client.PostAsync(cfg, "/api/resource/Sales%20Invoice", payload, ct);
        return response["data"] ?? throw new ErpNextException("ERPNext returned no document for the new Sales Invoice.");
    }

    private async Task AttachTaxesAsync(ErpNextCompanyOptions cfg, ErpNextPreviewDto preview, JsonObject payload, CancellationToken ct)
    {
        // Tax rows of the chosen Sales Taxes and Charges Template.
        var query = new Dictionary<string, string>
        {
            ["master_doctype"] = "Sales Taxes and Charges Template",
            ["master_name"] = preview.TaxTemplate!
        };
        var rowsNode = await _client.GetAsync(cfg, "/api/method/erpnext.controllers.accounts_controller.get_taxes_and_charges", query, ct);
        var taxes = new JsonArray();
        foreach (var row in rowsNode?["message"] as JsonArray ?? new JsonArray())
        {
            if (row is not null) taxes.Add(row.DeepClone());
        }
        if (taxes.Count == 0)
        {
            throw new ErpNextException($"The tax template '{preview.TaxTemplate}' has no tax rows in ERPNext.");
        }
        payload["taxes"] = taxes;

        // Per-item rate override from each line's Item Tax Template: {account: rate}.
        var rateCache = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var lines = payload["items"] as JsonArray ?? new JsonArray();
        foreach (var line in lines.OfType<JsonObject>())
        {
            var template = line["item_tax_template"]?.GetValue<string>();
            if (string.IsNullOrWhiteSpace(template)) continue;

            if (!rateCache.TryGetValue(template, out var rateJson))
            {
                var doc = await _client.GetDocAsync(cfg, "Item Tax Template", template, ct)
                          ?? throw new ErpNextException($"Item Tax Template '{template}' was not found in ERPNext.");
                var rates = new JsonObject();
                foreach (var t in doc["taxes"] as JsonArray ?? new JsonArray())
                {
                    var account = t?["tax_type"]?.GetValue<string>();
                    if (!string.IsNullOrWhiteSpace(account)) rates[account] = t?["tax_rate"]?.DeepClone();
                }
                rateJson = rates.ToJsonString();
                rateCache[template] = rateJson;
            }
            line["item_tax_rate"] = rateJson;
        }
    }

    private async Task<string?> FindCompanyAddressAsync(ErpNextCompanyOptions cfg, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(cfg.CompanyGstin)) return null;
        var filters = new JsonArray();
        var row = new JsonArray();
        row.Add("gstin");
        row.Add("=");
        row.Add(cfg.CompanyGstin);
        filters.Add(row);
        var found = await _client.ListAsync(cfg, "Address", filters, new[] { "name" }, 1, ct);
        return found.Count > 0 ? found[0]?["name"]?.GetValue<string>() : null;
    }

    // ------------------------------------------------------- duplicate-safety lookup
    private async Task<string?> FindInvoiceNameAsync(ErpNextCompanyOptions cfg, string sapKey, CancellationToken ct)
    {
        var filters = new JsonArray();
        var keyRow = new JsonArray();
        keyRow.Add("sap_b1_key");
        keyRow.Add("=");
        keyRow.Add(sapKey);
        filters.Add(keyRow);
        var statusRow = new JsonArray();
        statusRow.Add("docstatus");
        statusRow.Add("!=");
        statusRow.Add(2); // ignore cancelled invoices
        filters.Add(statusRow);

        var found = await _client.ListAsync(cfg, "Sales Invoice", filters, new[] { "name" }, 1, ct);
        return found.Count > 0 ? found[0]?["name"]?.GetValue<string>() : null;
    }

    /// <summary>Same lookup for use inside a catch block: never throws, never honours cancellation.</summary>
    private async Task<string?> TryFindInvoiceNameAsync(ErpNextCompanyOptions cfg, string sapKey)
    {
        try { return await FindInvoiceNameAsync(cfg, sapKey, CancellationToken.None); }
        catch (ErpNextException) { return null; }
    }

    // ------------------------------------------------------------ record the result
    private async Task<ErpNextPushResultDto> RecordAsync(
        ErpNextCompanyOptions cfg, ErpNextInvoiceLinkRow link, ErpNextPreviewDto preview, string invoiceName, string outcome, JsonNode? invoiceDoc = null)
    {
        // Adopted invoices (and any response lacking totals) are read back so reconciliation always uses ERPNext's real figures.
        invoiceDoc ??= await _client.GetDocAsync(cfg, "Sales Invoice", invoiceName, CancellationToken.None)
                       ?? throw new ErpNextException($"Sales Invoice '{invoiceName}' could not be read back from ERPNext.");

        var (status, detail, erpTotal) = ErpNextReconciler.Reconcile(invoiceDoc, preview);
        var docStatus = invoiceDoc["docstatus"]?.GetValue<int>() switch { 0 => "Draft", 1 => "Submitted", 2 => "Cancelled", _ => null };

        await _links.MarkPushedAsync(link.Id, invoiceName, docStatus, preview.SapTotal, erpTotal, status, detail);
        await _actionLog.LogAsync(_companyContext.CompanyCode, link.DocEntry, "Push", true,
            $"{outcome} {invoiceName}; reconciliation {status}.", CancellationToken.None);

        return new ErpNextPushResultDto
        {
            DocEntry = link.DocEntry,
            DocNum = link.DocNum,
            Outcome = outcome,
            InvoiceName = invoiceName,
            ErpNextDocStatus = docStatus,
            InvoiceUrl = InvoiceUrl(cfg, invoiceName),
            SapTotal = preview.SapTotal,
            ErpNextGrandTotal = erpTotal,
            ReconStatus = status,
            ReconDetail = detail,
            PushedAtUtc = DateTime.UtcNow
        };
    }

    private static ErpNextPushResultDto ToResult(ErpNextCompanyOptions? cfg, ErpNextInvoiceLinkRow link, string outcome) => new()
    {
        DocEntry = link.DocEntry,
        DocNum = link.DocNum,
        Outcome = outcome,
        InvoiceName = link.ErpNextInvoiceName,
        ErpNextDocStatus = link.ErpNextDocStatus,
        InvoiceUrl = InvoiceUrl(cfg, link.ErpNextInvoiceName),
        SapTotal = link.SapTotal,
        ErpNextGrandTotal = link.ErpNextGrandTotal,
        ReconStatus = link.ReconStatus,
        ReconDetail = link.ReconDetail,
        PushedAtUtc = link.PushedAtUtc
    };

    private static string? InvoiceUrl(ErpNextCompanyOptions? cfg, string? invoiceName) =>
        cfg is null || string.IsNullOrWhiteSpace(invoiceName)
            ? null
            : $"{cfg.BaseUrl}/app/sales-invoice/{Uri.EscapeDataString(invoiceName)}";
}
