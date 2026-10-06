using SAPB1.Api.Interfaces;

namespace SAPB1.Api.Services.ErpNext;

/// <summary>
/// Reads "ErpNext:Companies:{CompanyCode}" for the company in the caller's JWT.
/// The company code is used only as a configuration key (never concatenated into
/// a URL or SQL) and is first re-validated against the server-side allow-list,
/// same defense-in-depth as CompanyConnectionFactory. Reads IConfiguration on
/// every call, so a secret/config change takes effect without a restart where
/// the configuration source supports reload.
/// </summary>
public class ErpNextConfigProvider : IErpNextConfigProvider
{
    private const string SectionPath = "ErpNext:Companies";

    private readonly ICompanyContext _companyContext;
    private readonly ICompanyRegistry _registry;
    private readonly IConfiguration _configuration;

    public ErpNextConfigProvider(ICompanyContext companyContext, ICompanyRegistry registry, IConfiguration configuration)
    {
        _companyContext = companyContext;
        _registry = registry;
        _configuration = configuration;
    }

    public ErpNextCompanyOptions GetForCurrentCompany()
    {
        var code = _companyContext.CompanyCode;
        if (string.IsNullOrWhiteSpace(code))
        {
            throw new UnauthorizedAccessException("Request has no authenticated company context.");
        }

        if (_registry.FindByCode(code) is null)
        {
            throw new UnauthorizedAccessException($"Company '{code}' is not a configured company database.");
        }

        var section = _configuration.GetSection(SectionPath).GetChildren()
            .FirstOrDefault(c => string.Equals(c.Key, code, StringComparison.OrdinalIgnoreCase));
        var cfg = section?.Get<ErpNextCompanyOptions>();
        if (section is null || cfg is null)
        {
            throw new ErpNextConfigException(
                $"ERPNext is not configured for company '{code}'. Add the '{SectionPath}:{code}' settings " +
                $"(user-secrets in development, or ErpNext__Companies__{code}__* environment variables in production).");
        }

        // Case-insensitive TaxCodeMap even though Get<T>() replaces the initialised dictionary.
        cfg.TaxCodeMap = new Dictionary<string, string>(cfg.TaxCodeMap ?? new(), StringComparer.OrdinalIgnoreCase);

        Require(cfg.BaseUrl, code, "BaseUrl");
        Require(cfg.ApiKey, code, "ApiKey");
        Require(cfg.ApiSecret, code, "ApiSecret");
        Require(cfg.Company, code, "Company");

        cfg.BaseUrl = cfg.BaseUrl.Trim().TrimEnd('/');
        if (!Uri.TryCreate(cfg.BaseUrl, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttps && !uri.IsLoopback)
            || !string.IsNullOrEmpty(uri.AbsolutePath.Trim('/')))
        {
            throw new ErpNextConfigException(
                $"ErpNext:Companies:{code}:BaseUrl must be an https site root such as https://yoursite.m.erpnext.com (no path).");
        }

        if (!string.IsNullOrWhiteSpace(cfg.CompanyGstin))
        {
            cfg.CompanyGstin = cfg.CompanyGstin.Trim().ToUpperInvariant();
            if (!GstinValidator.IsValid(cfg.CompanyGstin))
            {
                throw new ErpNextConfigException($"ErpNext:Companies:{code}:CompanyGstin is not a valid 15-character GSTIN.");
            }
        }

        return cfg;
    }

    public ErpNextCompanyOptions? TryGetForCurrentCompany(out string? error)
    {
        try
        {
            error = null;
            return GetForCurrentCompany();
        }
        catch (ErpNextConfigException ex)
        {
            error = ex.Message;
            return null;
        }
    }

    private static void Require(string value, string code, string name)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ErpNextConfigException($"ErpNext:Companies:{code}:{name} is not configured.");
        }
    }
}
