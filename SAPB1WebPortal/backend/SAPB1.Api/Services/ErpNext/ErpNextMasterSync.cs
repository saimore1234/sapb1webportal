using System.Text.Json.Nodes;
using SAPB1.Api.DTOs.ErpNext;
using SAPB1.Api.Interfaces;

namespace SAPB1.Api.Services.ErpNext;

/// <summary>
/// Find-or-create of the master records an invoice needs in ERPNext. Every record is
/// keyed by its sap_b1_key custom field and looked up by it FIRST, so running a push
/// twice (or retrying after a timeout) never creates a second Customer / Address / Item.
/// Creation only happens when the matching AutoCreate* flag is on. A record that already
/// exists in ERPNext under the same name but was created by hand (no sap_b1_key) is
/// adopted by stamping its key — never duplicated; one linked to a DIFFERENT SAP record
/// is a conflict and stops the push.
/// </summary>
public class ErpNextMasterSync
{
    private readonly IErpNextClient _client;

    public ErpNextMasterSync(IErpNextClient client)
    {
        _client = client;
    }

    // ---------------------------------------------------------------- customer
    public async Task<string> EnsureCustomerAsync(ErpNextCompanyOptions cfg, ErpNextPreviewCustomerDto plan, CancellationToken ct)
    {
        if (await FindByKeyAsync(cfg, "Customer", plan.SapKey, ct) is { } byKey) return byKey;

        var existing = await _client.GetDocAsync(cfg, "Customer", plan.Name, ct);
        if (existing is not null)
        {
            await AdoptAsync(cfg, "Customer", plan.Name, existing, plan.SapKey, $"Customer '{plan.Name}'", ct);
            return plan.Name;
        }

        if (!cfg.AutoCreateCustomer)
        {
            throw new ErpNextException($"Customer '{plan.Name}' does not exist in ERPNext and AutoCreateCustomer is off.");
        }

        var doc = new JsonObject
        {
            ["customer_name"] = plan.Name,
            ["customer_type"] = "Company",
            ["customer_group"] = plan.CustomerGroup,
            ["territory"] = plan.Territory,
            ["gst_category"] = plan.GstCategory,
            ["sap_b1_key"] = plan.SapKey
        };
        var created = await _client.PostAsync(cfg, "/api/resource/Customer", doc, ct);
        return created["data"]?["name"]?.GetValue<string>() ?? plan.Name;
    }

    // ----------------------------------------------------------------- address
    /// <summary>Returns the ERPNext Address name.</summary>
    public async Task<string> EnsureAddressAsync(ErpNextCompanyOptions cfg, ErpNextPreviewAddressDto plan, string customerName, CancellationToken ct)
    {
        if (await FindByKeyAsync(cfg, "Address", plan.SapKey, ct) is { } byKey) return byKey;

        var doc = new JsonObject
        {
            ["address_title"] = customerName,
            ["address_type"] = plan.Type,
            ["address_line1"] = plan.Line1,
            ["address_line2"] = plan.Line2,
            ["city"] = plan.City,
            ["state"] = plan.State,
            ["pincode"] = plan.Pincode,
            ["country"] = plan.Country,
            ["gst_category"] = plan.GstCategory,
            ["is_primary_address"] = plan.Type == "Billing" ? 1 : 0,
            ["is_shipping_address"] = plan.Type == "Shipping" ? 1 : 0,
            ["sap_b1_key"] = plan.SapKey,
            ["links"] = new JsonArray(new JsonObject { ["link_doctype"] = "Customer", ["link_name"] = customerName })
        };
        if (!string.IsNullOrWhiteSpace(plan.Gstin)) doc["gstin"] = plan.Gstin;

        var created = await _client.PostAsync(cfg, "/api/resource/Address", doc, ct);
        return created["data"]?["name"]?.GetValue<string>()
               ?? throw new ErpNextException("ERPNext did not return the new Address name.");
    }

    // -------------------------------------------------------------------- item
    public async Task EnsureItemAsync(ErpNextCompanyOptions cfg, ErpNextPreviewItemDto plan, CancellationToken ct)
    {
        if (await FindByKeyAsync(cfg, "Item", plan.SapKey, ct) is not null) return;

        var existing = await _client.GetDocAsync(cfg, "Item", plan.ErpNextItemCode, ct);
        if (existing is not null)
        {
            await AdoptAsync(cfg, "Item", plan.ErpNextItemCode, existing, plan.SapKey, $"Item '{plan.ErpNextItemCode}'", ct);
            return;
        }

        if (!cfg.AutoCreateItem)
        {
            throw new ErpNextException($"Item '{plan.ErpNextItemCode}' does not exist in ERPNext and AutoCreateItem is off.");
        }

        // ERPNext's Item form fills valuation_method from Stock Settings; over the API it is required but not defaulted.
        // Use the site's own default rather than choosing one here.
        var stockSettings = await _client.GetDocAsync(cfg, "Stock Settings", "Stock Settings", ct);
        var valuationMethod = stockSettings?["valuation_method"]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(valuationMethod))
        {
            throw new ErpNextException("ERPNext Stock Settings has no default Valuation Method, which new Items require. Set one there and push again.");
        }

        var doc = new JsonObject
        {
            ["valuation_method"] = valuationMethod,
            ["item_code"] = plan.ErpNextItemCode,
            ["item_name"] = plan.ItemName,
            ["description"] = plan.ItemName,
            ["item_group"] = cfg.ItemGroup,
            ["stock_uom"] = plan.Uom,
            // SAP stays the inventory system; ERPNext only receives invoices. Stock items would also need a valuation
            // method (an accounting choice), so items are created as non-stock unless CreateItemsAsStockItems is set.
            ["is_stock_item"] = cfg.CreateItemsAsStockItems ? 1 : 0,
            ["gst_hsn_code"] = plan.HsnSacCode,
            ["sap_b1_key"] = plan.SapKey
        };
        // ERPNext only accepts an Item Tax Template on a document line if the item (or its group) lists it.
        if (!string.IsNullOrWhiteSpace(plan.ItemTaxTemplate))
        {
            doc["taxes"] = new JsonArray(new JsonObject { ["item_tax_template"] = plan.ItemTaxTemplate });
        }
        await _client.PostAsync(cfg, "/api/resource/Item", doc, ct);
    }

    // ---------------------------------------------------- UOM and HSN prerequisites
    public async Task EnsureUomExistsAsync(ErpNextCompanyOptions cfg, string uom, CancellationToken ct)
    {
        if (await _client.GetDocAsync(cfg, "UOM", uom, ct) is null)
        {
            throw new ErpNextException($"Unit of measure '{uom}' does not exist in ERPNext. Create it (or fix the SAP unit) and push again.");
        }
    }

    /// <summary>Invoice lines link to the GST HSN Code master; create the code if India Compliance's list lacks it.</summary>
    public async Task EnsureHsnCodeAsync(ErpNextCompanyOptions cfg, string hsnCode, string description, CancellationToken ct)
    {
        if (await _client.GetDocAsync(cfg, "GST HSN Code", hsnCode, ct) is not null) return;
        var doc = new JsonObject { ["hsn_code"] = hsnCode, ["description"] = description };
        await _client.PostAsync(cfg, "/api/resource/GST%20HSN%20Code", doc, ct);
    }

    // ----------------------------------------------------------------- helpers
    private async Task<string?> FindByKeyAsync(ErpNextCompanyOptions cfg, string doctype, string sapKey, CancellationToken ct)
    {
        var filters = new JsonArray();
        var row = new JsonArray();
        row.Add("sap_b1_key");
        row.Add("=");
        row.Add(sapKey);
        filters.Add(row);

        var found = await _client.ListAsync(cfg, doctype, filters, new[] { "name" }, 1, ct);
        return found.Count > 0 ? found[0]?["name"]?.GetValue<string>() : null;
    }

    /// <summary>Stamps sap_b1_key on a hand-created record; refuses if it already belongs to a different SAP record.</summary>
    private async Task AdoptAsync(ErpNextCompanyOptions cfg, string doctype, string name, JsonNode existing, string sapKey, string label, CancellationToken ct)
    {
        var currentKey = existing["sap_b1_key"]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(currentKey))
        {
            var body = new JsonObject { ["sap_b1_key"] = sapKey };
            await _client.PutAsync(cfg, $"/api/resource/{Uri.EscapeDataString(doctype)}/{Uri.EscapeDataString(name)}", body, ct);
            return;
        }

        if (!string.Equals(currentKey, sapKey, StringComparison.Ordinal))
        {
            throw new ErpNextException($"{label} already exists in ERPNext but is linked to a different SAP record ({currentKey}).");
        }
    }
}
