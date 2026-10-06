using System.Text.RegularExpressions;

namespace SAPB1.Api.Services.ErpNext;

/// <summary>
/// The fixed GST state-code list (the first two digits of any GSTIN) — national
/// reference data, not company data. Used to turn a GSTIN prefix or an SAP state
/// name into India Compliance's "24-Gujarat" place-of-supply form.
/// </summary>
public static class GstStates
{
    private static readonly Dictionary<string, string> ByCode = new()
    {
        ["01"] = "Jammu and Kashmir", ["02"] = "Himachal Pradesh", ["03"] = "Punjab", ["04"] = "Chandigarh",
        ["05"] = "Uttarakhand", ["06"] = "Haryana", ["07"] = "Delhi", ["08"] = "Rajasthan",
        ["09"] = "Uttar Pradesh", ["10"] = "Bihar", ["11"] = "Sikkim", ["12"] = "Arunachal Pradesh",
        ["13"] = "Nagaland", ["14"] = "Manipur", ["15"] = "Mizoram", ["16"] = "Tripura",
        ["17"] = "Meghalaya", ["18"] = "Assam", ["19"] = "West Bengal", ["20"] = "Jharkhand",
        ["21"] = "Odisha", ["22"] = "Chhattisgarh", ["23"] = "Madhya Pradesh", ["24"] = "Gujarat",
        ["26"] = "Dadra and Nagar Haveli and Daman and Diu", ["27"] = "Maharashtra", ["29"] = "Karnataka",
        ["30"] = "Goa", ["31"] = "Lakshadweep", ["32"] = "Kerala", ["33"] = "Tamil Nadu",
        ["34"] = "Puducherry", ["35"] = "Andaman and Nicobar Islands", ["36"] = "Telangana",
        ["37"] = "Andhra Pradesh", ["38"] = "Ladakh", ["97"] = "Other Territory"
    };

    // Older / alternate spellings SAP databases commonly carry.
    private static readonly Dictionary<string, string> Aliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["orissa"] = "odisha", ["uttaranchal"] = "uttarakhand", ["pondicherry"] = "puducherry",
        ["chattisgarh"] = "chhattisgarh", ["daman and diu"] = "dadra and nagar haveli and daman and diu",
        ["dadra and nagar haveli"] = "dadra and nagar haveli and daman and diu",
        ["andaman and nicobar"] = "andaman and nicobar islands", ["nct of delhi"] = "delhi", ["new delhi"] = "delhi"
    };

    private static readonly Dictionary<string, string> ByNormalizedName =
        ByCode.ToDictionary(kv => Normalize(kv.Value), kv => kv.Key);

    /// <summary>Two-digit GST state code for a state name, or null if unrecognised.</summary>
    public static string? CodeFromName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        var n = Normalize(name);
        if (Aliases.TryGetValue(n, out var alias)) n = alias;
        return ByNormalizedName.GetValueOrDefault(n);
    }

    public static string? NameFromCode(string? code) =>
        code is not null && ByCode.TryGetValue(code, out var name) ? name : null;

    /// <summary>"24-Gujarat" — the format India Compliance stores in place_of_supply.</summary>
    public static string? PlaceOfSupply(string? code)
    {
        var name = NameFromCode(code);
        return name is null ? null : $"{code}-{name}";
    }

    private static string Normalize(string s) =>
        Regex.Replace(s.ToLowerInvariant().Replace("&", " and "), @"[^a-z ]", " ")
             .Split(' ', StringSplitOptions.RemoveEmptyEntries)
             .Aggregate(string.Empty, (acc, w) => acc.Length == 0 ? w : acc + " " + w);
}
