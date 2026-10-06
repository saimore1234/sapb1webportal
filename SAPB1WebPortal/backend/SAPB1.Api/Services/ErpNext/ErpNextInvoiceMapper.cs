using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using SAPB1.Api.DTOs.ErpNext;

namespace SAPB1.Api.Services.ErpNext;

/// <summary>
/// Pure mapping + validation: SAP invoice read-model -> ERPNext draft Sales
/// Invoice payload, plus the list of problems that must block a push. No I/O.
/// The push (step 3) uses this same result, so "Preview is clean" and "Push is
/// allowed" can never disagree.
///
/// Deliberately NOT here: any GST calculation. ERPNext + India Compliance
/// compute tax from the Item Tax Templates and the taxes template chosen here;
/// SAP's own INV4 figures are carried along only so the pushed total can be
/// reconciled against them.
/// </summary>
public static class ErpNextInvoiceMapper
{
    private const decimal ForeignCurrencyEpsilon = 0.0001m;

    public static ErpNextPreviewDto Map(string companyCode, SapInvoiceData sap, ErpNextCompanyOptions? cfg, string? configError)
    {
        var h = sap.Header;
        var problems = new List<string>();
        var warnings = new List<string>();
        var sapKey = $"{companyCode}|{h.DocEntry}";

        var result = new ErpNextPreviewDto
        {
            DocEntry = h.DocEntry,
            DocNum = h.DocNum,
            SapKey = sapKey,
            Problems = problems,
            Warnings = warnings,
            SapCurrency = h.DocCur
        };

        // ---------------- basic document state ----------------
        if (cfg is null)
        {
            problems.Add(configError ?? "ERPNext is not configured for this company.");
        }

        if (!string.Equals(h.Canceled?.Trim(), "N", StringComparison.OrdinalIgnoreCase))
        {
            problems.Add(string.Equals(h.Canceled?.Trim(), "C", StringComparison.OrdinalIgnoreCase)
                ? "This is a cancellation document (CANCELED='C'), not an invoice to push."
                : $"Invoice is cancelled (CANCELED='{h.Canceled}').");
        }

        if (sap.Lines.Count == 0) problems.Add("Invoice has no lines.");

        var foreign = !string.IsNullOrWhiteSpace(h.DocCur) && !h.DocCur.Equals("INR", StringComparison.OrdinalIgnoreCase)
                      && Math.Abs(h.DocTotalFC) > ForeignCurrencyEpsilon;
        result.SapTotal = foreign ? h.DocTotalFC : h.DocTotal;
        if (foreign)
        {
            warnings.Add($"Foreign-currency invoice ({h.DocCur}, rate {h.DocRate}). Export/SEZ e-invoice handling is not built; totals are reconciled in {h.DocCur}.");
        }

        // ---------------- GST header (INV12) + company safety ----------------
        var gst = sap.Gst;
        if (gst is null) problems.Add("Invoice has no INV12 row (GST header) — cannot read branch/customer GSTIN.");

        var locGstin = Norm(gst?.LocGSTN);
        if (!GstinValidator.IsValid(locGstin))
        {
            problems.Add($"Branch GSTIN (INV12.LocGSTN) is missing or not a valid 15-character GSTIN ('{locGstin ?? "blank"}').");
        }

        if (cfg is not null)
        {
            if (string.IsNullOrWhiteSpace(cfg.CompanyGstin))
            {
                problems.Add("ErpNext CompanyGstin is not configured for this company, so the branch GSTIN cannot be verified. Push is blocked.");
            }
            else if (locGstin is not null && !string.Equals(locGstin, cfg.CompanyGstin, StringComparison.Ordinal))
            {
                problems.Add($"Branch GSTIN on this invoice ({locGstin}) does not match the GSTIN configured for this company's ERPNext company ({cfg.CompanyGstin}). Push is blocked.");
            }
        }

        // ---------------- customer, GSTIN, category ----------------
        var billTo = sap.Addresses.FirstOrDefault(a => a.AdresType == "B");
        var shipTo = sap.Addresses.FirstOrDefault(a => a.AdresType == "S");

        // Customer GSTIN is INV12.BpGSTN, falling back to the bill-to address — never OCRD.LicTradNum.
        var custGstin = Norm(gst?.BpGSTN) ?? Norm(billTo?.GSTRegnNo);
        var registered = custGstin is not null;
        if (registered && !GstinValidator.IsValid(custGstin))
        {
            problems.Add($"Customer GSTIN '{custGstin}' is not a valid 15-character GSTIN.");
        }
        if (!registered)
        {
            warnings.Add("Customer has no GSTIN — will be sent as Unregistered.");
        }

        if (billTo is null)
        {
            problems.Add(string.IsNullOrWhiteSpace(h.PayToCode)
                ? $"This invoice has no bill-to address (Pay To is empty). Set a bill-to address on customer {h.CardCode} in SAP and create the invoice again."
                : $"Bill-to address '{h.PayToCode}' was not found on customer {h.CardCode} in SAP.");
        }
        if (shipTo is null)
        {
            warnings.Add(string.IsNullOrWhiteSpace(h.ShipToCode)
                ? "This invoice has no ship-to address; the bill-to address will be used."
                : $"Ship-to address '{h.ShipToCode}' was not found on customer {h.CardCode}; the bill-to address will be used.");
        }

        var gstCategory = GstCategory(registered, gst?.BpGSTType ?? billTo?.GSTType);
        if (!string.IsNullOrWhiteSpace(gst?.BpGSTType))
        {
            warnings.Add($"Customer GST type in SAP is '{gst.BpGSTType}', sent to ERPNext as gst_category '{gstCategory}'. Check this mapping on the first invoice.");
        }

        // ---------------- supply type: intra vs inter state ----------------
        var locState = locGstin is { Length: >= 2 } ? locGstin[..2] : null;
        var custState = registered && GstinValidator.IsValid(custGstin)
            ? custGstin![..2]
            : StateCode(gst?.BpStateCod, sap.BpStateName) ?? StateCode(billTo?.StateCode, billTo?.StateName);

        bool? intra = locState is not null && custState is not null ? locState == custState : null;
        if (intra is null)
        {
            problems.Add("Cannot tell whether this is an intra-state or inter-state supply: the customer's state could not be resolved from the GSTIN, INV12.BpStateCod or the bill-to address.");
        }
        result.SupplyType = intra switch { true => "Intra", false => "Inter", _ => null };

        // Cross-check against what SAP actually charged on INV4.
        var taxSummary = SummariseSapTax(sap.TaxLines);
        result.SapTaxSummary = taxSummary;
        var chargedIgst = taxSummary.GetValueOrDefault("IGST") != 0;
        var chargedCgstSgst = taxSummary.GetValueOrDefault("CGST") != 0 || taxSummary.GetValueOrDefault("SGST") != 0;
        if (intra == true && chargedIgst) warnings.Add("SAP charged IGST, but the branch and customer states are the same. Check the customer's state.");
        if (intra == false && chargedCgstSgst) warnings.Add("SAP charged CGST/SGST, but the branch and customer states differ. Check the customer's state.");

        // Place of supply: ship-to state, else customer state.
        var posCode = StateCode(h.ShipState, sap.ShipStateName) ?? custState;
        var placeOfSupply = GstStates.PlaceOfSupply(posCode);
        if (placeOfSupply is null)
        {
            problems.Add("Place of supply could not be determined (no usable ship-to state or customer GSTIN).");
        }
        result.PlaceOfSupply = placeOfSupply;

        // ---------------- tax template ----------------
        string? taxTemplate = null;
        if (cfg is not null && intra is not null)
        {
            taxTemplate = intra == true ? cfg.TaxTemplateIntra : cfg.TaxTemplateInter;
            if (string.IsNullOrWhiteSpace(taxTemplate))
            {
                problems.Add($"ErpNext {(intra == true ? "TaxTemplateIntra" : "TaxTemplateInter")} is not configured for this company.");
                taxTemplate = null;
            }
        }
        result.TaxTemplate = taxTemplate;

        // ---------------- lines ----------------
        var itemsJson = new JsonArray();
        var unmappedTaxCodes = new SortedSet<string>(StringComparer.OrdinalIgnoreCase);
        var itemPrefix = cfg?.ItemCodePrefix ?? string.Empty;

        foreach (var l in sap.Lines)
        {
            var label = $"Line {l.LineNum + 1}";
            if (string.IsNullOrWhiteSpace(l.ItemCode))
            {
                problems.Add($"{label} has no item code (a service/text line). Only item-based invoices are supported.");
                continue;
            }
            label += $" ({l.ItemCode})";

            if (l.Quantity <= 0) problems.Add($"{label}: quantity must be greater than zero.");
            if (string.IsNullOrWhiteSpace(l.UnitMsr)) problems.Add($"{label}: no unit of measure (INV1.unitMsr).");

            // SAP often stores the HSN formatted ("7210.41.00"); ERPNext/India Compliance want digits only ("72104100").
            var hsnSac = DigitsOnly(!string.IsNullOrWhiteSpace(l.HsnCode) ? l.HsnCode : l.SacCode);
            if (string.IsNullOrWhiteSpace(hsnSac))
            {
                problems.Add($"{label}: no HSN/SAC code (checked INV1.HsnEntry/SacEntry, then the item master).");
            }
            else if (!Regex.IsMatch(hsnSac, @"^(\d{4}|\d{6}|\d{8})$"))
            {
                warnings.Add($"{label}: HSN/SAC '{hsnSac}' is not 4, 6 or 8 digits.");
            }

            string? itemTaxTemplate = null;
            if (string.IsNullOrWhiteSpace(l.TaxCode))
            {
                problems.Add($"{label}: no tax code.");
            }
            else if (cfg is not null && cfg.TaxCodeMap.TryGetValue(l.TaxCode.Trim(), out var mapped) && !string.IsNullOrWhiteSpace(mapped))
            {
                itemTaxTemplate = mapped;
            }
            else
            {
                unmappedTaxCodes.Add(l.TaxCode.Trim());
            }

            var erpItemCode = itemPrefix + l.ItemCode.Trim();
            var item = new JsonObject
            {
                ["item_code"] = erpItemCode,
                ["item_name"] = Truncate(l.Dscription ?? l.ItemCode, 140),
                ["description"] = l.Dscription ?? l.ItemCode,
                ["qty"] = l.Quantity,
                ["uom"] = l.UnitMsr,
                // SAP's Price is already after the line discount, so no discount is sent: rate x qty = LineTotal.
                ["rate"] = l.Price,
                ["gst_hsn_code"] = hsnSac,
                ["item_tax_template"] = itemTaxTemplate
            };
            itemsJson.Add(item);

            result.Items.Add(new ErpNextPreviewItemDto
            {
                LineNum = l.LineNum,
                SapItemCode = l.ItemCode.Trim(),
                ErpNextItemCode = erpItemCode,
                ItemName = Truncate(l.Dscription ?? l.ItemCode, 140),
                SapKey = $"{companyCode}|{l.ItemCode.Trim()}",
                HsnSacCode = hsnSac,
                SapTaxCode = l.TaxCode?.Trim(),
                ItemTaxTemplate = itemTaxTemplate,
                Uom = l.UnitMsr,
                CreateIfMissing = cfg?.AutoCreateItem ?? false
            });
        }

        if (unmappedTaxCodes.Count > 0)
        {
            problems.Add(
                $"SAP tax code(s) with no ERPNext Item Tax Template mapped: {string.Join(", ", unmappedTaxCodes)}. " +
                $"Add ErpNext:Companies:{companyCode}:TaxCodeMap:<TaxCode> for each.");
        }

        // ---------------- customer + address plans ----------------
        var customerName = (h.CardName ?? h.CardCode).Trim();
        result.Customer = new ErpNextPreviewCustomerDto
        {
            Name = customerName,
            SapKey = $"{companyCode}|{h.CardCode}",
            Gstin = custGstin,
            GstCategory = gstCategory,
            CustomerGroup = cfg?.CustomerGroup ?? string.Empty,
            Territory = cfg?.Territory ?? string.Empty,
            CreateIfMissing = cfg?.AutoCreateCustomer ?? false
        };

        foreach (var (addr, type) in new[] { (billTo, "Billing"), (shipTo, "Shipping") })
        {
            if (addr is null) continue;
            var addrGstin = Norm(addr.GSTRegnNo) ?? (type == "Billing" ? custGstin : null);

            // ERPNext requires address line 1; if SAP has no street/building, use the block instead.
            var line1 = Join(addr.Street, addr.Building);
            var line2 = string.IsNullOrWhiteSpace(addr.Block) ? null : addr.Block.Trim();
            if (line1 is null)
            {
                line1 = line2;
                line2 = null;
            }
            if (line1 is null)
            {
                problems.Add($"{type} address '{addr.Address}' has no street, building or block — ERPNext requires address line 1.");
            }

            result.Addresses.Add(new ErpNextPreviewAddressDto
            {
                Type = type,
                SapKey = $"{companyCode}|{h.CardCode}|{addr.AdresType}|{addr.Address}",
                Line1 = line1,
                Line2 = line2,
                City = addr.City,
                Pincode = addr.ZipCode,
                State = addr.StateName ?? addr.StateCode,
                Country = addr.CountryName ?? addr.CountryCode,
                Gstin = addrGstin,
                GstCategory = gstCategory
            });
        }

        // ---------------- payload ----------------
        result.PayloadNode = BuildPayload(sapKey, sap, cfg, customerName, gstCategory, locGstin, custGstin, placeOfSupply, taxTemplate, foreign, itemsJson);
        return result;
    }

    private static JsonObject BuildPayload(
        string sapKey, SapInvoiceData sap, ErpNextCompanyOptions? cfg, string customerName, string gstCategory,
        string? locGstin, string? custGstin, string? placeOfSupply, string? taxTemplate, bool foreign, JsonArray items)
    {
        var h = sap.Header;

        // Customer's own PO reference, if the company records one.
        var poRef = UdfText(sap, "U_PORefNo") ?? h.NumAtCard;

        var remarks = new List<string> { $"SAP B1 A/R Invoice {h.DocNum} (DocEntry {h.DocEntry})." };
        if (UdfText(sap, "U_Transporter") is { } transporter) remarks.Add($"Transporter: {transporter}.");
        if (UdfText(sap, "U_RoadPermitNo") is { } permit) remarks.Add($"Road permit: {permit}.");
        if (!string.IsNullOrWhiteSpace(h.Comments)) remarks.Add(h.Comments.Trim());

        var payload = new JsonObject
        {
            ["doctype"] = "Sales Invoice",
            ["company"] = cfg?.Company,
            ["customer"] = customerName,
            ["posting_date"] = h.DocDate.ToString("yyyy-MM-dd"),
            ["set_posting_time"] = 1,
            ["due_date"] = (h.DocDueDate ?? h.DocDate).ToString("yyyy-MM-dd"),
            ["currency"] = string.IsNullOrWhiteSpace(h.DocCur) ? "INR" : h.DocCur,
            ["conversion_rate"] = foreign ? h.DocRate : 1m,
            ["ignore_pricing_rule"] = 1,
            ["update_stock"] = 0,
            ["po_no"] = poRef,
            ["remarks"] = string.Join(" ", remarks),
            ["sap_b1_key"] = sapKey,
            ["sap_b1_docnum"] = h.DocNum.ToString(),
            ["gst_category"] = gstCategory,
            ["place_of_supply"] = placeOfSupply,
            ["company_gstin"] = locGstin,
            ["billing_address_gstin"] = custGstin,
            ["taxes_and_charges"] = taxTemplate,
            ["items"] = items
        };

        // Transport details (India Compliance Sales Invoice fields) — only when present in SAP.
        if (UdfText(sap, "U_GateInVehicleNo") is { } vehicle) payload["vehicle_no"] = vehicle;
        if (UdfText(sap, "U_LRNo") is { } lr) payload["lr_no"] = lr;
        if (sap.Udfs.TryGetValue("U_LrDate", out var lrDate) && lrDate is DateTime d) payload["lr_date"] = d.ToString("yyyy-MM-dd");

        return payload;
    }

    /// <summary>CGST / SGST / IGST / CESS / Other, summed from INV4.TaxSum by tax type code.</summary>
    private static Dictionary<string, decimal> SummariseSapTax(IEnumerable<SapInvoiceTaxLine> taxLines)
    {
        var sums = new Dictionary<string, decimal>();
        foreach (var t in taxLines)
        {
            var type = ClassifyTaxType(t.StaCode);
            sums[type] = sums.GetValueOrDefault(type) + t.TaxSum;
        }
        return sums;
    }

    public static string ClassifyTaxType(string? staCode)
    {
        var c = (staCode ?? string.Empty).Trim().ToUpperInvariant();
        if (c.StartsWith("IGST")) return "IGST";
        if (c.StartsWith("CGST")) return "CGST";
        if (c.StartsWith("SGST") || c.StartsWith("UTGST")) return "SGST";
        if (c.Contains("CESS")) return "CESS";
        return "Other";
    }

    private static string GstCategory(bool registered, string? sapGstType)
    {
        var t = (sapGstType ?? string.Empty).ToUpperInvariant();
        if (t.Contains("SEZ")) return "SEZ";
        if (t.Contains("EXPORT") || t.Contains("OVERSEAS")) return "Overseas";
        if (t.Contains("COMPOSITION")) return "Registered Composition";
        if (t.Contains("DEEMED")) return "Deemed Export";
        if (t.Contains("UIN")) return "UIN Holders";
        return registered ? "Registered Regular" : "Unregistered";
    }

    /// <summary>A two-digit GST state code from either a numeric SAP code or a state name; null if neither resolves.</summary>
    private static string? StateCode(string? sapStateCode, string? stateName)
    {
        var code = sapStateCode?.Trim();
        if (code is { Length: 2 } && code.All(char.IsDigit) && GstStates.NameFromCode(code) is not null) return code;
        return GstStates.CodeFromName(stateName);
    }

    private static string? UdfText(SapInvoiceData sap, string name) =>
        sap.Udfs.TryGetValue(name, out var v) && v is not null && v is not DateTime
            ? (string.IsNullOrWhiteSpace(v.ToString()) ? null : v.ToString()!.Trim())
            : null;

    /// <summary>Strips the dots/spaces/hyphens SAP stores in HSN/SAC codes; null if nothing is left.</summary>
    private static string? DigitsOnly(string? code)
    {
        if (string.IsNullOrWhiteSpace(code)) return null;
        var cleaned = Regex.Replace(code, @"[\s.\-]", "");
        return cleaned.Length == 0 ? null : cleaned;
    }

    private static string? Norm(string? gstin) =>
        string.IsNullOrWhiteSpace(gstin) ? null : gstin.Trim().ToUpperInvariant();

    private static string? Join(params string?[] parts)
    {
        var joined = string.Join(", ", parts.Where(p => !string.IsNullOrWhiteSpace(p)).Select(p => p!.Trim()));
        return joined.Length == 0 ? null : joined;
    }

    private static string Truncate(string s, int max) => s.Length <= max ? s : s[..max];
}
