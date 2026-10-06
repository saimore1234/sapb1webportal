using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using SAPB1.Api.DTOs.ErpNext;
using SAPB1.Api.Interfaces;

namespace SAPB1.Api.Services.ErpNext;

/// <summary>
/// E-invoice (IRN) and e-way bill generation through ERPNext + India Compliance. The portal only sends the request and
/// records/shows the result; ERPNext does the GST work and talks to the government portal. Nothing here writes to SAP.
///
/// Two things make this different from the push, and shape every step:
///  * It is NOT reversible. Generating an e-invoice registers the invoice with the GST portal; an IRN can only be cancelled
///    within 24 hours. It also needs a SUBMITTED invoice, so a draft is submitted first (which posts accounting entries in
///    ERPNext). Therefore every check that can be done up front IS done up front, and nothing is submitted or sent unless all
///    of them pass and the caller confirmed.
///  * A timeout is ambiguous — the portal may have registered the invoice before the connection dropped. After any failure the
///    invoice is re-read from ERPNext; if an IRN / e-way bill is there it is recorded instead of reported as a failure.
/// </summary>
public class ErpNextComplianceService : IErpNextComplianceService
{
    private const string EInvoiceMethod = "/api/method/india_compliance.gst_india.utils.e_invoice.generate_e_invoice";
    private const string EwayBillMethod = "/api/method/india_compliance.gst_india.utils.e_waybill.generate_e_waybill";

    private const string CancelEInvoiceMethod = "/api/method/india_compliance.gst_india.utils.e_invoice.cancel_e_invoice";
    private const string CancelEwayBillMethod = "/api/method/india_compliance.gst_india.utils.e_waybill.cancel_e_waybill";

    // The reasons India Compliance accepts for both cancellations (keys of its CANCEL_REASON_CODES).
    private static readonly string[] CancelReasons = { "Duplicate", "Data Entry Mistake", "Order Cancelled", "Others" };
    private static readonly string[] Modes = { "Road", "Rail", "Air", "Ship" };
    private static readonly string[] VehicleTypes = { "Regular", "Over Dimensional Cargo (ODC)" };
    private static readonly Regex VehicleNo = new("^[A-Z0-9]{6,15}$", RegexOptions.Compiled);
    private static readonly Regex TransporterId = new("^[0-9A-Z]{15}$", RegexOptions.Compiled);

    private readonly ICompanyContext _companyContext;
    private readonly IErpNextConfigProvider _configProvider;
    private readonly IErpNextClient _client;
    private readonly IErpNextLinkStore _links;
    private readonly ISapInvoiceReader _reader;
    private readonly IErpNextInvoiceService _invoices;
    private readonly IErpNextActionLog _actionLog;
    private readonly ILogger<ErpNextComplianceService> _logger;

    public ErpNextComplianceService(
        ICompanyContext companyContext,
        IErpNextConfigProvider configProvider,
        IErpNextClient client,
        IErpNextLinkStore links,
        ISapInvoiceReader reader,
        IErpNextInvoiceService invoices,
        IErpNextActionLog actionLog,
        ILogger<ErpNextComplianceService> logger)
    {
        _companyContext = companyContext;
        _configProvider = configProvider;
        _client = client;
        _links = links;
        _reader = reader;
        _invoices = invoices;
        _actionLog = actionLog;
        _logger = logger;
    }

    // ============================================================ transport defaults
    public async Task<ErpNextTransportDefaultsDto?> GetTransportDefaultsAsync(int docEntry, CancellationToken ct = default)
    {
        var (_, link) = await RequirePushedAsync(docEntry, ct);
        var sap = await _reader.ReadAsync(docEntry, ct);
        if (sap is null) return null;

        return new ErpNextTransportDefaultsDto
        {
            Mode = "Road",
            VehicleNo = NormalizeVehicle(UdfText(sap, "U_GateInVehicleNo")),
            TransporterName = UdfText(sap, "U_Transporter"),
            LrNo = UdfText(sap, "U_LRNo"),
            LrDate = sap.Udfs.TryGetValue("U_LrDate", out var d) && d is DateTime dt ? dt.ToString("yyyy-MM-dd") : null,
            Distance = 0,
            WillSubmit = link.ErpNextDocStatus is null or "Draft"
        };
    }

    // ================================================================== e-invoice
    public async Task<ErpNextComplianceResultDto> GenerateEInvoiceAsync(int docEntry, ErpNextEInvoiceRequestDto request, CancellationToken ct = default)
    {
        var companyCode = _companyContext.CompanyCode;
        var (cfg, link) = await RequirePushedAsync(docEntry, ct);
        var name = link.ErpNextInvoiceName!;
        var doc = await ReadInvoiceAsync(cfg, name, ct);

        // Already has an IRN (generated here earlier, or directly in ERPNext): record it and stop. Not an error.
        if (!string.IsNullOrWhiteSpace(Str(doc["irn"])) && !IsCancelledEInvoice(doc))
        {
            await SyncFromDocAsync(cfg, link, doc, ct);
            await _actionLog.LogAsync(companyCode, docEntry, "EInvoice", true, $"Already generated for {name}.", ct);
            return await ResultAsync("AlreadyGenerated", docEntry, ct);
        }

        // Everything that can be checked before anything irreversible happens.
        var settings = await _client.GetDocAsync(cfg, "GST Settings", "GST Settings", ct);
        var problems = EInvoiceProblems(cfg, doc, settings);
        if (problems.Count > 0)
        {
            await _actionLog.LogAsync(companyCode, docEntry, "EInvoice", false, $"Blocked: {problems.Count} problem(s).", ct);
            throw new ErpNextBlockedException("The e-invoice was not generated. Nothing was submitted or sent to the GST portal.", problems);
        }
        if (!request.Confirm)
        {
            throw new ErpNextBlockedException("Confirmation is required to generate an e-invoice.",
                "Generating an e-invoice registers this invoice with the GST portal and cannot be undone after 24 hours. Confirm to continue.");
        }

        if (!await _links.BeginComplianceAsync(link.Id, "EInvoice", _companyContext.Username))
        {
            var current = await _links.GetAsync(companyCode, docEntry, ct);
            if (current?.EInvoiceStatus == "Generated") return await ResultAsync("AlreadyGenerated", docEntry, ct);
            throw new ErpNextBlockedException("An e-invoice for this invoice is already being generated.",
                "Wait a moment and use Refresh to see the result.");
        }

        var submittedByUs = false;
        try
        {
            if (Int(doc["docstatus"]) == 0)
            {
                await SubmitAsync(cfg, name, ct);
                submittedByUs = true;
            }

            await _client.PostAsync(cfg, EInvoiceMethod, new JsonObject { ["docname"] = name }, ct);
            return await RecordEInvoiceAsync(cfg, link, name, "Generated", ct);
        }
        catch (ErpNextException ex)
        {
            // Ambiguous failure (timeout / 5xx / error after the portal accepted it): look before declaring failure.
            var after = await TryReadInvoiceAsync(cfg, name);
            if (after is not null && !string.IsNullOrWhiteSpace(Str(after["irn"])))
            {
                _logger.LogWarning("E-invoice call for {Name} reported an error but an IRN exists; recording it.", name);
                return await RecordEInvoiceAsync(cfg, link, name, "Generated", CancellationToken.None);
            }

            await _links.MarkComplianceFailedAsync(link.Id, "EInvoice", ex.Message, DocStatusText(after) ?? (submittedByUs ? "Submitted" : null));
            await _actionLog.LogAsync(companyCode, docEntry, "EInvoice", false, ex.Message, CancellationToken.None);
            throw;
        }
        catch (Exception ex)
        {
            await _links.MarkComplianceFailedAsync(link.Id, "EInvoice", "Unexpected error while generating the e-invoice. See the API log.", submittedByUs ? "Submitted" : null);
            await _actionLog.LogAsync(companyCode, docEntry, "EInvoice", false, "Unexpected error.", CancellationToken.None);
            _logger.LogError(ex, "Unexpected error generating e-invoice for {Name}", name);
            throw;
        }
    }

    private async Task<ErpNextComplianceResultDto> RecordEInvoiceAsync(ErpNextCompanyOptions cfg, ErpNextInvoiceLinkRow link, string name, string outcome, CancellationToken ct)
    {
        var doc = await _client.GetDocAsync(cfg, "Sales Invoice", name, ct)
                  ?? throw new ErpNextException($"Sales Invoice '{name}' could not be read back from ERPNext.");
        var irn = Str(doc["irn"]);
        if (string.IsNullOrWhiteSpace(irn))
        {
            throw new ErpNextException("ERPNext finished without returning an IRN. Check the invoice in ERPNext (e-Invoice status) before trying again.");
        }

        var (ackNo, ackDate) = await ReadAckAsync(cfg, irn, ct);
        await _links.MarkEInvoiceGeneratedAsync(link.Id, irn, ackNo, ackDate, DocStatusText(doc));
        await _actionLog.LogAsync(_companyContext.CompanyCode, link.DocEntry, "EInvoice", true, $"IRN generated for {name}.", CancellationToken.None);
        return await ResultAsync(outcome, link.DocEntry, ct);
    }

    private static List<string> EInvoiceProblems(ErpNextCompanyOptions cfg, JsonNode doc, JsonNode? settings)
    {
        var problems = new List<string>();
        if (Int(doc["docstatus"]) == 2) problems.Add("This invoice is cancelled in ERPNext.");
        if (IsCancelledEInvoice(doc))
        {
            problems.Add("The e-invoice (IRN) for this invoice was cancelled. A cancelled IRN cannot be generated again for the same invoice number: cancel this invoice in ERPNext and issue a new one.");
        }

        var category = Str(doc["gst_category"]);
        var billingGstin = Str(doc["billing_address_gstin"]);
        if (string.Equals(category, "Unregistered", StringComparison.OrdinalIgnoreCase) || string.IsNullOrWhiteSpace(billingGstin))
        {
            problems.Add(
                "E-invoicing applies to B2B invoices, where the customer has a GSTIN. This invoice's customer is Unregistered (no GSTIN), " +
                "so no IRN can be generated. Add the customer's GSTIN on its bill-to address in SAP and push a new invoice.");
        }

        var companyGstin = Str(doc["company_gstin"]);
        if (!string.Equals(companyGstin, cfg.CompanyGstin, StringComparison.OrdinalIgnoreCase))
        {
            problems.Add($"The invoice's company GSTIN ({companyGstin ?? "blank"}) does not match the GSTIN configured for this company ({cfg.CompanyGstin}).");
        }

        if (settings is null)
        {
            problems.Add("ERPNext GST Settings could not be read.");
            return problems;
        }
        if (Int(settings["enable_api"]) != 1) problems.Add("The India Compliance API is not enabled in ERPNext GST Settings.");
        if (Int(settings["enable_e_invoice"]) != 1) problems.Add("E-Invoice is not enabled in ERPNext GST Settings.");
        if (!HasCredentials(settings, cfg.CompanyGstin, "e-Invoice"))
        {
            problems.Add($"ERPNext GST Settings has no e-Invoice API credentials for GSTIN {cfg.CompanyGstin}.");
        }

        if (DateTime.TryParse(Str(doc["posting_date"]), CultureInfo.InvariantCulture, DateTimeStyles.None, out var posting))
        {
            if (DateTime.TryParse(Str(settings["e_invoice_applicable_from"]), CultureInfo.InvariantCulture, DateTimeStyles.None, out var from) && posting.Date < from.Date)
            {
                problems.Add($"E-invoicing is applicable from {from:dd MMM yyyy} on this site; this invoice is dated {posting:dd MMM yyyy}.");
            }
            var limit = Int(settings["e_invoice_reporting_time_limit_days"]) ?? 0;
            if (limit > 0 && (DateTime.Today - posting.Date).TotalDays > limit)
            {
                problems.Add($"This invoice is more than {limit} days old, beyond the e-invoice reporting time limit in GST Settings.");
            }
        }
        return problems;
    }

    // ================================================================== e-way bill
    public async Task<ErpNextComplianceResultDto> GenerateEwayBillAsync(int docEntry, ErpNextEwayBillRequestDto request, CancellationToken ct = default)
    {
        var companyCode = _companyContext.CompanyCode;
        var (cfg, link) = await RequirePushedAsync(docEntry, ct);
        var name = link.ErpNextInvoiceName!;
        var doc = await ReadInvoiceAsync(cfg, name, ct);

        if (!string.IsNullOrWhiteSpace(Str(doc["ewaybill"])) && !string.Equals(Str(doc["e_waybill_status"]), "Cancelled", StringComparison.OrdinalIgnoreCase))
        {
            await SyncFromDocAsync(cfg, link, doc, ct);
            await _actionLog.LogAsync(companyCode, docEntry, "EwayBill", true, $"Already generated for {name}.", ct);
            return await ResultAsync("AlreadyGenerated", docEntry, ct);
        }

        var settings = await _client.GetDocAsync(cfg, "GST Settings", "GST Settings", ct);
        var problems = EwayBillProblems(cfg, doc, settings, request, out var values);
        if (problems.Count > 0)
        {
            await _actionLog.LogAsync(companyCode, docEntry, "EwayBill", false, $"Blocked: {problems.Count} problem(s).", ct);
            throw new ErpNextBlockedException("The e-way bill was not generated. Nothing was sent to the GST portal.", problems);
        }

        var draft = Int(doc["docstatus"]) == 0;
        if (draft && !request.Confirm)
        {
            throw new ErpNextBlockedException("Confirmation is required to generate an e-way bill.",
                "This invoice is still a draft in ERPNext. An e-way bill needs it submitted, which posts accounting entries in ERPNext. Confirm to continue.");
        }

        if (!await _links.BeginComplianceAsync(link.Id, "Ewb", _companyContext.Username))
        {
            var current = await _links.GetAsync(companyCode, docEntry, ct);
            if (current?.EwbStatus == "Generated") return await ResultAsync("AlreadyGenerated", docEntry, ct);
            throw new ErpNextBlockedException("An e-way bill for this invoice is already being generated.",
                "Wait a moment and use Refresh to see the result.");
        }

        var submittedByUs = false;
        try
        {
            if (draft)
            {
                await SubmitAsync(cfg, name, ct);
                submittedByUs = true;
            }

            await _client.PostAsync(cfg, EwayBillMethod, new JsonObject
            {
                ["doctype"] = "Sales Invoice",
                ["docname"] = name,
                ["values"] = values
            }, ct);
            return await RecordEwayBillAsync(cfg, link, name, "Generated", ct);
        }
        catch (ErpNextException ex)
        {
            var after = await TryReadInvoiceAsync(cfg, name);
            if (after is not null && !string.IsNullOrWhiteSpace(Str(after["ewaybill"])))
            {
                _logger.LogWarning("E-way bill call for {Name} reported an error but a bill exists; recording it.", name);
                return await RecordEwayBillAsync(cfg, link, name, "Generated", CancellationToken.None);
            }

            await _links.MarkComplianceFailedAsync(link.Id, "Ewb", ex.Message, DocStatusText(after) ?? (submittedByUs ? "Submitted" : null));
            await _actionLog.LogAsync(companyCode, docEntry, "EwayBill", false, ex.Message, CancellationToken.None);
            throw;
        }
        catch (Exception ex)
        {
            await _links.MarkComplianceFailedAsync(link.Id, "Ewb", "Unexpected error while generating the e-way bill. See the API log.", submittedByUs ? "Submitted" : null);
            await _actionLog.LogAsync(companyCode, docEntry, "EwayBill", false, "Unexpected error.", CancellationToken.None);
            _logger.LogError(ex, "Unexpected error generating e-way bill for {Name}", name);
            throw;
        }
    }

    private async Task<ErpNextComplianceResultDto> RecordEwayBillAsync(ErpNextCompanyOptions cfg, ErpNextInvoiceLinkRow link, string name, string outcome, CancellationToken ct)
    {
        var doc = await _client.GetDocAsync(cfg, "Sales Invoice", name, ct)
                  ?? throw new ErpNextException($"Sales Invoice '{name}' could not be read back from ERPNext.");
        var ewb = Str(doc["ewaybill"]);
        if (string.IsNullOrWhiteSpace(ewb))
        {
            throw new ErpNextException("ERPNext finished without returning an e-way bill number. Check the invoice in ERPNext (e-Waybill status) before trying again.");
        }

        var (date, validUpto) = await ReadEwbLogAsync(cfg, ewb, ct);
        await _links.MarkEwayBillGeneratedAsync(link.Id, ewb, date, validUpto, DocStatusText(doc));
        await _actionLog.LogAsync(_companyContext.CompanyCode, link.DocEntry, "EwayBill", true, $"E-way bill generated for {name}.", CancellationToken.None);
        return await ResultAsync(outcome, link.DocEntry, ct);
    }

    private static List<string> EwayBillProblems(
        ErpNextCompanyOptions cfg, JsonNode doc, JsonNode? settings, ErpNextEwayBillRequestDto r, out JsonObject values)
    {
        var problems = new List<string>();
        values = new JsonObject();

        if (Int(doc["docstatus"]) == 2) problems.Add("This invoice is cancelled in ERPNext.");

        if (settings is null)
        {
            problems.Add("ERPNext GST Settings could not be read.");
        }
        else
        {
            if (Int(settings["enable_api"]) != 1) problems.Add("The India Compliance API is not enabled in ERPNext GST Settings.");
            if (Int(settings["enable_e_waybill"]) != 1) problems.Add("E-Waybill is not enabled in ERPNext GST Settings.");
            if (!HasCredentials(settings, cfg.CompanyGstin, "e-Waybill"))
            {
                problems.Add($"ERPNext GST Settings has no e-Waybill API credentials for GSTIN {cfg.CompanyGstin}.");
            }
        }

        var mode = string.IsNullOrWhiteSpace(r.Mode) ? "Road" : Modes.FirstOrDefault(m => m.Equals(r.Mode.Trim(), StringComparison.OrdinalIgnoreCase));
        if (mode is null) problems.Add("Mode of transport must be Road, Rail, Air or Ship.");

        var vehicle = NormalizeVehicle(r.VehicleNo);
        if (vehicle is not null && !VehicleNo.IsMatch(vehicle)) problems.Add("The vehicle number is not valid. Use letters and digits only, for example MH12AB1234.");

        var transporterId = string.IsNullOrWhiteSpace(r.TransporterGstin) ? null : r.TransporterGstin.Trim().ToUpperInvariant();
        if (transporterId is not null && !TransporterId.IsMatch(transporterId)) problems.Add("The transporter GSTIN / Transporter ID must be 15 characters.");

        var lrNo = string.IsNullOrWhiteSpace(r.LrNo) ? null : r.LrNo.Trim();
        string? lrDate = null;
        if (!string.IsNullOrWhiteSpace(r.LrDate))
        {
            if (DateTime.TryParseExact(r.LrDate.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d)) lrDate = d.ToString("yyyy-MM-dd");
            else problems.Add("The LR / document date is not a valid date.");
        }

        if (mode == "Road")
        {
            if (vehicle is null && transporterId is null) problems.Add("For road transport, enter the vehicle number, or the transporter's GSTIN if the transporter will add the vehicle later.");
        }
        else if (mode is not null)
        {
            if (lrNo is null || lrDate is null) problems.Add($"For {mode.ToLowerInvariant()} transport, the transport document (LR/RR/AWB/BL) number and date are required.");
        }

        if (r.Distance is < 0 or > 4000) problems.Add("Distance must be between 0 and 4000 km (0 lets the GST portal work it out from the pincodes).");

        var vehicleType = string.IsNullOrWhiteSpace(r.VehicleType) ? "Regular" : VehicleTypes.FirstOrDefault(v => v.Equals(r.VehicleType.Trim(), StringComparison.OrdinalIgnoreCase));
        if (vehicleType is null) problems.Add("Vehicle type must be Regular or Over Dimensional Cargo (ODC).");

        if (problems.Count == 0)
        {
            values["mode_of_transport"] = mode;
            values["distance"] = r.Distance;
            if (mode == "Road") values["gst_vehicle_type"] = vehicleType;
            if (vehicle is not null) values["vehicle_no"] = vehicle;
            if (transporterId is not null) values["gst_transporter_id"] = transporterId;
            if (!string.IsNullOrWhiteSpace(r.TransporterName)) values["transporter_name"] = r.TransporterName.Trim();
            if (lrNo is not null) values["lr_no"] = lrNo;
            if (lrDate is not null) values["lr_date"] = lrDate;
        }
        return problems;
    }

    // ============================================================================ cancel
    // Both cancellations are irreversible and go to the GST portal, so — like generation — every check that can be made
    // up front is made up front, the caller must confirm, a double-click cannot send two, and after any failure the invoice
    // is re-read from ERPNext before the outcome is reported (the portal may have accepted the cancellation).

    public async Task<ErpNextComplianceResultDto> CancelEInvoiceAsync(int docEntry, ErpNextCancelRequestDto request, CancellationToken ct = default)
    {
        var companyCode = _companyContext.CompanyCode;
        var (cfg, link) = await RequirePushedAsync(docEntry, ct);
        var name = link.ErpNextInvoiceName!;
        var doc = await ReadInvoiceAsync(cfg, name, ct);

        var problems = CancelRequestProblems(request, out var reason, out var remark);
        var irn = Str(doc["irn"]);
        if (string.IsNullOrWhiteSpace(irn) || IsCancelledEInvoice(doc))
        {
            problems.Add("This invoice has no active e-invoice (IRN) to cancel.");
        }
        else
        {
            var (_, ackDate) = await ReadAckAsync(cfg, irn, ct);
            if (ackDate is { } ack && ack.AddHours(24) < DateTime.Now)
            {
                problems.Add($"An e-invoice can only be cancelled within 24 hours of being generated. This one was generated on {ack:dd MMM yyyy HH:mm}, so the window ended on {ack.AddHours(24):dd MMM yyyy HH:mm}.");
            }
        }

        if (problems.Count > 0)
        {
            await _actionLog.LogAsync(companyCode, docEntry, "EInvoiceCancel", false, $"Blocked: {problems.Count} problem(s).", ct);
            throw new ErpNextBlockedException("The e-invoice was not cancelled. Nothing was sent to the GST portal.", problems);
        }
        if (!request.Confirm)
        {
            throw new ErpNextBlockedException("Confirmation is required to cancel an e-invoice.",
                "Cancelling an e-invoice cannot be undone, and the same invoice number can never get a new IRN. Confirm to continue.");
        }

        // Make the stored state match ERPNext, then claim the cancellation.
        await SyncFromDocAsync(cfg, link, doc, ct);
        if (!await _links.BeginCancelAsync(link.Id, "EInvoice"))
        {
            throw new ErpNextBlockedException("This e-invoice is already being cancelled.", "Wait a moment and use Refresh to see the result.");
        }

        // India Compliance cancels an existing e-way bill first, with the same reason.
        var hadEwayBill = !string.IsNullOrWhiteSpace(Str(doc["ewaybill"]));
        var values = new JsonObject { ["reason"] = reason };
        if (remark is not null) values["remark"] = remark;

        try
        {
            await _client.PostAsync(cfg, CancelEInvoiceMethod, new JsonObject { ["docname"] = name, ["values"] = values }, ct);
            return await RecordEInvoiceCancelledAsync(cfg, link, name, reason!, remark, hadEwayBill, ct);
        }
        catch (ErpNextException ex)
        {
            var after = await TryReadInvoiceAsync(cfg, name);
            if (after is not null && (string.IsNullOrWhiteSpace(Str(after["irn"])) || IsCancelledEInvoice(after)))
            {
                _logger.LogWarning("Cancel call for {Name} reported an error but the IRN is gone; recording the cancellation.", name);
                return await RecordEInvoiceCancelledAsync(cfg, link, name, reason!, remark, hadEwayBill, CancellationToken.None);
            }

            await _links.MarkCancelFailedAsync(link.Id, "EInvoice", ex.Message);
            await _actionLog.LogAsync(companyCode, docEntry, "EInvoiceCancel", false, ex.Message, CancellationToken.None);
            throw;
        }
        catch (Exception ex)
        {
            await _links.MarkCancelFailedAsync(link.Id, "EInvoice", "Unexpected error while cancelling the e-invoice. See the API log.");
            await _actionLog.LogAsync(companyCode, docEntry, "EInvoiceCancel", false, "Unexpected error.", CancellationToken.None);
            _logger.LogError(ex, "Unexpected error cancelling e-invoice for {Name}", name);
            throw;
        }
    }

    private async Task<ErpNextComplianceResultDto> RecordEInvoiceCancelledAsync(
        ErpNextCompanyOptions cfg, ErpNextInvoiceLinkRow link, string name, string reason, string? remark, bool hadEwayBill, CancellationToken ct)
    {
        var doc = await _client.GetDocAsync(cfg, "Sales Invoice", name, ct)
                  ?? throw new ErpNextException($"Sales Invoice '{name}' could not be read back from ERPNext.");
        if (!string.IsNullOrWhiteSpace(Str(doc["irn"])) && !IsCancelledEInvoice(doc))
        {
            throw new ErpNextException("ERPNext finished without cancelling the IRN. Check the invoice in ERPNext (e-Invoice status) before trying again.");
        }

        var text = remark is null ? reason : $"{reason}: {remark}";
        var user = _companyContext.Username;
        await _links.MarkCancelledAsync(link.Id, "EInvoice", text, user, DocStatusText(doc));
        if (hadEwayBill && string.IsNullOrWhiteSpace(Str(doc["ewaybill"])))
        {
            await _links.MarkCancelledAsync(link.Id, "Ewb", text, user, DocStatusText(doc));
        }

        await _actionLog.LogAsync(_companyContext.CompanyCode, link.DocEntry, "EInvoiceCancel", true,
            $"IRN cancelled for {name} ({text}){(hadEwayBill ? "; e-way bill cancelled with it" : string.Empty)}.", CancellationToken.None);
        return await ResultAsync("Cancelled", link.DocEntry, ct);
    }

    public async Task<ErpNextComplianceResultDto> CancelEwayBillAsync(int docEntry, ErpNextCancelRequestDto request, CancellationToken ct = default)
    {
        var companyCode = _companyContext.CompanyCode;
        var (cfg, link) = await RequirePushedAsync(docEntry, ct);
        var name = link.ErpNextInvoiceName!;
        var doc = await ReadInvoiceAsync(cfg, name, ct);

        var problems = CancelRequestProblems(request, out var reason, out var remark);
        var ewb = Str(doc["ewaybill"]);
        if (string.IsNullOrWhiteSpace(ewb) || string.Equals(Str(doc["e_waybill_status"]), "Cancelled", StringComparison.OrdinalIgnoreCase))
        {
            problems.Add("This invoice has no active e-way bill to cancel.");
        }
        else
        {
            var (createdOn, _) = await ReadEwbLogAsync(cfg, ewb, ct);
            if (createdOn is { } created && created.AddHours(24) < DateTime.Now)
            {
                problems.Add($"An e-way bill can only be cancelled within 24 hours of being generated. This one was generated on {created:dd MMM yyyy HH:mm}, so the window ended on {created.AddHours(24):dd MMM yyyy HH:mm}.");
            }
        }

        if (problems.Count > 0)
        {
            await _actionLog.LogAsync(companyCode, docEntry, "EwayBillCancel", false, $"Blocked: {problems.Count} problem(s).", ct);
            throw new ErpNextBlockedException("The e-way bill was not cancelled. Nothing was sent to the GST portal.", problems);
        }
        if (!request.Confirm)
        {
            throw new ErpNextBlockedException("Confirmation is required to cancel an e-way bill.",
                "Cancelling an e-way bill cannot be undone. A new one can be generated afterwards. Confirm to continue.");
        }

        await SyncFromDocAsync(cfg, link, doc, ct);
        if (!await _links.BeginCancelAsync(link.Id, "Ewb"))
        {
            throw new ErpNextBlockedException("This e-way bill is already being cancelled.", "Wait a moment and use Refresh to see the result.");
        }

        var values = new JsonObject { ["reason"] = reason };
        if (remark is not null) values["remark"] = remark;

        try
        {
            await _client.PostAsync(cfg, CancelEwayBillMethod, new JsonObject
            {
                ["doctype"] = "Sales Invoice",
                ["docname"] = name,
                ["values"] = values
            }, ct);
            return await RecordEwayBillCancelledAsync(cfg, link, name, reason!, remark, ct);
        }
        catch (ErpNextException ex)
        {
            var after = await TryReadInvoiceAsync(cfg, name);
            if (after is not null && string.IsNullOrWhiteSpace(Str(after["ewaybill"])))
            {
                _logger.LogWarning("Cancel call for {Name} reported an error but the e-way bill is gone; recording the cancellation.", name);
                return await RecordEwayBillCancelledAsync(cfg, link, name, reason!, remark, CancellationToken.None);
            }

            await _links.MarkCancelFailedAsync(link.Id, "Ewb", ex.Message);
            await _actionLog.LogAsync(companyCode, docEntry, "EwayBillCancel", false, ex.Message, CancellationToken.None);
            throw;
        }
        catch (Exception ex)
        {
            await _links.MarkCancelFailedAsync(link.Id, "Ewb", "Unexpected error while cancelling the e-way bill. See the API log.");
            await _actionLog.LogAsync(companyCode, docEntry, "EwayBillCancel", false, "Unexpected error.", CancellationToken.None);
            _logger.LogError(ex, "Unexpected error cancelling e-way bill for {Name}", name);
            throw;
        }
    }

    private async Task<ErpNextComplianceResultDto> RecordEwayBillCancelledAsync(
        ErpNextCompanyOptions cfg, ErpNextInvoiceLinkRow link, string name, string reason, string? remark, CancellationToken ct)
    {
        var doc = await _client.GetDocAsync(cfg, "Sales Invoice", name, ct)
                  ?? throw new ErpNextException($"Sales Invoice '{name}' could not be read back from ERPNext.");
        if (!string.IsNullOrWhiteSpace(Str(doc["ewaybill"])))
        {
            throw new ErpNextException("ERPNext finished without cancelling the e-way bill. Check the invoice in ERPNext (e-Waybill status) before trying again.");
        }

        var text = remark is null ? reason : $"{reason}: {remark}";
        await _links.MarkCancelledAsync(link.Id, "Ewb", text, _companyContext.Username, DocStatusText(doc));
        await _actionLog.LogAsync(_companyContext.CompanyCode, link.DocEntry, "EwayBillCancel", true, $"E-way bill cancelled for {name} ({text}).", CancellationToken.None);
        return await ResultAsync("Cancelled", link.DocEntry, ct);
    }

    private static List<string> CancelRequestProblems(ErpNextCancelRequestDto r, out string? reason, out string? remark)
    {
        var problems = new List<string>();
        reason = CancelReasons.FirstOrDefault(x => x.Equals(r.Reason?.Trim(), StringComparison.OrdinalIgnoreCase));
        if (reason is null) problems.Add("Choose a cancellation reason: Duplicate, Data Entry Mistake, Order Cancelled or Others.");

        remark = string.IsNullOrWhiteSpace(r.Remark) ? null : r.Remark.Trim();
        if (remark is { Length: > 100 }) problems.Add("The remark can be at most 100 characters.");
        if (reason == "Others" && remark is null) problems.Add("Enter a remark when the reason is Others.");
        return problems;
    }

    // ==================================================================================== QR
    public async Task<ErpNextEInvoiceQrDto?> GetEInvoiceQrAsync(int docEntry, CancellationToken ct = default)
    {
        var (cfg, link) = await RequirePushedAsync(docEntry, ct);
        var doc = await ReadInvoiceAsync(cfg, link.ErpNextInvoiceName!, ct);
        var irn = Str(doc["irn"]);
        if (string.IsNullOrWhiteSpace(irn) || IsCancelledEInvoice(doc)) return null;

        // ERPNext keeps only the signed QR string (in the e-Invoice Log), not an image; the portal draws the code from it.
        var log = await _client.GetDocAsync(cfg, "e-Invoice Log", irn, ct);
        var qr = Str(log?["signed_qr_code"]);
        return string.IsNullOrWhiteSpace(qr) ? null : new ErpNextEInvoiceQrDto { Irn = irn, SignedQrCode = qr };
    }

    // ===================================================================== refresh
    public async Task<ErpNextLinkStatusDto> RefreshAsync(int docEntry, CancellationToken ct = default)
    {
        var companyCode = _companyContext.CompanyCode;
        var link = await _links.GetAsync(companyCode, docEntry, ct);
        if (link is null || link.PushStatus != "Pushed" || string.IsNullOrWhiteSpace(link.ErpNextInvoiceName))
        {
            return await _invoices.GetStatusAsync(docEntry, ct); // nothing in ERPNext to read yet
        }

        var cfg = _configProvider.GetForCurrentCompany();
        var doc = await ReadInvoiceAsync(cfg, link.ErpNextInvoiceName, ct);
        await SyncFromDocAsync(cfg, link, doc, ct);
        return await _invoices.GetStatusAsync(docEntry, ct);
    }

    private async Task SyncFromDocAsync(ErpNextCompanyOptions cfg, ErpNextInvoiceLinkRow link, JsonNode doc, CancellationToken ct)
    {
        var snapshot = new ErpNextSyncSnapshot { DocStatus = DocStatusText(doc), GrandTotal = Dec(doc["grand_total"]) };

        var irn = Str(doc["irn"]);
        if (!string.IsNullOrWhiteSpace(irn) && !IsCancelledEInvoice(doc))
        {
            snapshot.Irn = irn;
            (snapshot.AckNo, snapshot.AckDate) = await ReadAckAsync(cfg, irn, ct);
        }

        var ewb = Str(doc["ewaybill"]);
        if (!string.IsNullOrWhiteSpace(ewb) && !string.Equals(Str(doc["e_waybill_status"]), "Cancelled", StringComparison.OrdinalIgnoreCase))
        {
            snapshot.EwbNo = ewb;
            (snapshot.EwbDate, snapshot.EwbValidUpto) = await ReadEwbLogAsync(cfg, ewb, ct);
        }

        await _links.SyncAsync(link.Id, snapshot);
    }

    // ================================================================== helpers
    private async Task<(ErpNextCompanyOptions Cfg, ErpNextInvoiceLinkRow Link)> RequirePushedAsync(int docEntry, CancellationToken ct)
    {
        var cfg = _configProvider.GetForCurrentCompany();
        var link = await _links.GetAsync(_companyContext.CompanyCode, docEntry, ct);
        if (link is null || link.PushStatus != "Pushed" || string.IsNullOrWhiteSpace(link.ErpNextInvoiceName))
        {
            throw new ErpNextBlockedException("This invoice has not been pushed to ERPNext yet.",
                "Push the invoice to ERPNext first, then generate the e-invoice or e-way bill.");
        }
        return (cfg, link);
    }

    private async Task<JsonNode> ReadInvoiceAsync(ErpNextCompanyOptions cfg, string name, CancellationToken ct) =>
        await _client.GetDocAsync(cfg, "Sales Invoice", name, ct)
        ?? throw new ErpNextBlockedException($"Sales Invoice '{name}' was not found in ERPNext.",
            "It may have been deleted there. Push the invoice again after removing the stale link.");

    /// <summary>Never throws and ignores cancellation: used inside catch blocks to find out what really happened.</summary>
    private async Task<JsonNode?> TryReadInvoiceAsync(ErpNextCompanyOptions cfg, string name)
    {
        try { return await _client.GetDocAsync(cfg, "Sales Invoice", name, CancellationToken.None); }
        catch (ErpNextException) { return null; }
    }

    private Task SubmitAsync(ErpNextCompanyOptions cfg, string name, CancellationToken ct) =>
        _client.PutAsync(cfg, $"/api/resource/Sales%20Invoice/{Uri.EscapeDataString(name)}", new JsonObject { ["docstatus"] = 1 }, ct);

    private async Task<ErpNextComplianceResultDto> ResultAsync(string outcome, int docEntry, CancellationToken ct) =>
        new() { Outcome = outcome, Status = await _invoices.GetStatusAsync(docEntry, ct) };

    /// <summary>Acknowledgement details live in ERPNext's e-Invoice Log (named after the IRN). Best effort: the IRN is what matters.</summary>
    private async Task<(string? AckNo, DateTime? AckDate)> ReadAckAsync(ErpNextCompanyOptions cfg, string irn, CancellationToken ct)
    {
        try
        {
            var log = await _client.GetDocAsync(cfg, "e-Invoice Log", irn, ct);
            return (Str(log?["acknowledgement_number"]), ParseDate(log?["acknowledged_on"]));
        }
        catch (ErpNextException)
        {
            return (null, null);
        }
    }

    private async Task<(DateTime? Date, DateTime? ValidUpto)> ReadEwbLogAsync(ErpNextCompanyOptions cfg, string ewb, CancellationToken ct)
    {
        try
        {
            var log = await _client.GetDocAsync(cfg, "e-Waybill Log", ewb, ct);
            return (ParseDate(log?["created_on"]), ParseDate(log?["valid_upto"]));
        }
        catch (ErpNextException)
        {
            return (null, null);
        }
    }

    private static bool HasCredentials(JsonNode settings, string gstin, string service) =>
        (settings["credentials"] as JsonArray ?? new JsonArray()).Any(c =>
            string.Equals(Str(c?["gstin"]), gstin, StringComparison.OrdinalIgnoreCase)
            && (Str(c?["service"]) ?? string.Empty).Contains(service, StringComparison.OrdinalIgnoreCase));

    private static bool IsCancelledEInvoice(JsonNode doc) =>
        Str(doc["einvoice_status"]) is "Cancelled" or "Manually Cancelled";

    private static string? DocStatusText(JsonNode? doc) => Int(doc?["docstatus"]) switch
    {
        0 => "Draft",
        1 => "Submitted",
        2 => "Cancelled",
        _ => null
    };

    private static string? NormalizeVehicle(string? vehicle)
    {
        if (string.IsNullOrWhiteSpace(vehicle)) return null;
        var v = Regex.Replace(vehicle.ToUpperInvariant(), @"[\s\-]", "");
        return v.Length == 0 ? null : v;
    }

    private static string? UdfText(SapInvoiceData sap, string name) =>
        sap.Udfs.TryGetValue(name, out var v) && v is not null && v is not DateTime && !string.IsNullOrWhiteSpace(v.ToString())
            ? v.ToString()!.Trim()
            : null;

    // JSON helpers: ERPNext returns numbers as numbers and dates/others as strings; read either safely.
    private static string? Str(JsonNode? node) => node switch
    {
        null => null,
        JsonValue v when v.TryGetValue<string>(out var s) => string.IsNullOrWhiteSpace(s) ? null : s,
        _ => node.ToString()
    };

    private static int? Int(JsonNode? node)
    {
        if (node is JsonValue v)
        {
            if (v.TryGetValue<int>(out var i)) return i;
            if (v.TryGetValue<string>(out var s) && int.TryParse(s, out var parsed)) return parsed;
        }
        return null;
    }

    private static decimal? Dec(JsonNode? node)
    {
        if (node is JsonValue v)
        {
            if (v.TryGetValue<decimal>(out var d)) return d;
            if (v.TryGetValue<double>(out var dbl)) return (decimal)dbl;
        }
        return null;
    }

    private static DateTime? ParseDate(JsonNode? node) =>
        DateTime.TryParse(Str(node), CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d : null;
}
