namespace SAPB1.Api.DTOs.ErpNext;

public class ErpNextCheckDto
{
    public string Name { get; set; } = string.Empty;
    public bool Ok { get; set; }
    public string Detail { get; set; } = string.Empty;
}

/// <summary>Result of POST /api/erpnext/test-connection. Success = every check passed.</summary>
public class ErpNextCheckResultDto
{
    public bool Success { get; set; }
    public string CompanyCode { get; set; } = string.Empty;
    public string BaseUrl { get; set; } = string.Empty;
    public string ErpNextCompany { get; set; } = string.Empty;
    public List<ErpNextCheckDto> Checks { get; set; } = new();
}

public class ErpNextCustomFieldResultDto
{
    public string DocType { get; set; } = string.Empty;
    public string FieldName { get; set; } = string.Empty;
    /// <summary>"Created" | "AlreadyExists" | "Failed"</summary>
    public string Outcome { get; set; } = string.Empty;
    public string? Detail { get; set; }
}

public class ErpNextCustomFieldsResultDto
{
    public bool Success { get; set; }
    public List<ErpNextCustomFieldResultDto> Fields { get; set; } = new();
}
