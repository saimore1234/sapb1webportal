using System.Text.RegularExpressions;

namespace SAPB1.Api.Services.ErpNext;

/// <summary>
/// One SAP company's ERPNext settings, bound from
/// "ErpNext:Companies:{CompanyCode}" in configuration. ApiKey/ApiSecret must
/// only ever come from user-secrets / environment variables (e.g.
/// ErpNext__Companies__STEST__ApiSecret) — never appsettings.json, never a request.
/// </summary>
public class ErpNextCompanyOptions
{
    /// <summary>e.g. https://gubbi.m.erpnext.com (no trailing path).</summary>
    public string BaseUrl { get; set; } = string.Empty;
    public string ApiKey { get; set; } = string.Empty;
    public string ApiSecret { get; set; } = string.Empty;

    /// <summary>The ERPNext Company this SAP company posts into.</summary>
    public string Company { get; set; } = string.Empty;

    /// <summary>Must equal INV12.LocGSTN of every invoice pushed for this CompanyCode.</summary>
    public string CompanyGstin { get; set; } = string.Empty;

    public bool AutoCreateCustomer { get; set; }
    public bool AutoCreateItem { get; set; }

    /// <summary>False (default): items are created in ERPNext as non-stock items, since SAP holds the stock.
    /// True: stock items — ERPNext then requires a valuation method to be set up on the site.</summary>
    public bool CreateItemsAsStockItems { get; set; }

    /// <summary>ERPNext item_code = ItemCodePrefix + SAP ItemCode.</summary>
    public string ItemCodePrefix { get; set; } = string.Empty;

    /// <summary>Defaults for records the push creates. These standard tree roots exist on every ERPNext site.</summary>
    public string CustomerGroup { get; set; } = "All Customer Groups";
    public string Territory { get; set; } = "All Territories";
    public string ItemGroup { get; set; } = "All Item Groups";

    /// <summary>Sales Taxes and Charges Template names (intra-state CGST+SGST / inter-state IGST).</summary>
    public string TaxTemplateIntra { get; set; } = string.Empty;
    public string TaxTemplateInter { get; set; } = string.Empty;

    /// <summary>SAP INV1.TaxCode -> ERPNext Item Tax Template name.</summary>
    public Dictionary<string, string> TaxCodeMap { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

/// <summary>Standard 15-character GSTIN format check (structure only — not a registry lookup).</summary>
public static class GstinValidator
{
    private static readonly Regex Pattern = new(
        "^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$", RegexOptions.Compiled);

    public static bool IsValid(string? gstin) =>
        !string.IsNullOrWhiteSpace(gstin) && Pattern.IsMatch(gstin.Trim().ToUpperInvariant());
}

/// <summary>ERPNext is not configured / misconfigured for the current company. Message is safe to show.</summary>
public class ErpNextConfigException : Exception
{
    public ErpNextConfigException(string message) : base(message) { }
}

/// <summary>The SAP database lacks something the integration requires (e.g. a localization column). Message is safe to show.</summary>
public class SapDataException : Exception
{
    public SapDataException(string message) : base(message) { }
}

/// <summary>
/// An e-invoice / e-way bill request that must not proceed, with every specific reason. Thrown BEFORE anything is
/// submitted or sent to the government portal; the messages are safe to show.
/// </summary>
public class ErpNextBlockedException : Exception
{
    public IReadOnlyList<string> Problems { get; }
    public ErpNextBlockedException(string headline, IEnumerable<string> problems) : base(headline) { Problems = problems.ToList(); }
    public ErpNextBlockedException(string headline, string problem) : this(headline, new[] { problem }) { }
}

/// <summary>ERPNext rejected or failed a call. Message is sanitised and safe to show (never contains credentials).</summary>
public class ErpNextException : Exception
{
    public int? StatusCode { get; }
    public ErpNextException(string message, int? statusCode = null) : base(message) { StatusCode = statusCode; }
}
