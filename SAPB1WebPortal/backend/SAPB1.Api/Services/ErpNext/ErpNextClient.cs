using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using SAPB1.Api.Interfaces;

namespace SAPB1.Api.Services.ErpNext;

/// <summary>
/// REST client for the ERPNext/Frappe API (v15). Auth is
/// "Authorization: token {ApiKey}:{ApiSecret}", set per request from the
/// company's server-side config — the credentials are never logged and never
/// appear in an exception message. Error bodies from Frappe
/// (_server_messages / exception / exc_type) are reduced to a short, tag-free
/// message before being surfaced.
/// </summary>
public class ErpNextClient : IErpNextClient
{
    private const string HttpClientName = "ErpNext";
    private const int MaxMessageLength = 500;
    private static readonly Regex HtmlTag = new("<[^>]*>", RegexOptions.Compiled);

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<ErpNextClient> _logger;

    public ErpNextClient(IHttpClientFactory httpClientFactory, ILogger<ErpNextClient> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    public async Task<JsonNode?> GetAsync(ErpNextCompanyOptions cfg, string path, IDictionary<string, string>? query = null, CancellationToken ct = default)
    {
        var (status, body) = await SendAsync(cfg, HttpMethod.Get, path, query, null, ct);
        if (status == 404) return null;
        return Unwrap(status, body);
    }

    public async Task<JsonNode> PostAsync(ErpNextCompanyOptions cfg, string path, JsonNode body, CancellationToken ct = default)
    {
        var (status, response) = await SendAsync(cfg, HttpMethod.Post, path, null, body, ct);
        return Unwrap(status, response) ?? throw new ErpNextException("ERPNext returned an empty response.", status);
    }

    public async Task<JsonNode> PutAsync(ErpNextCompanyOptions cfg, string path, JsonNode body, CancellationToken ct = default)
    {
        var (status, response) = await SendAsync(cfg, HttpMethod.Put, path, null, body, ct);
        return Unwrap(status, response) ?? throw new ErpNextException("ERPNext returned an empty response.", status);
    }

    public async Task<JsonNode?> GetDocAsync(ErpNextCompanyOptions cfg, string doctype, string name, CancellationToken ct = default)
    {
        var node = await GetAsync(cfg, $"/api/resource/{Uri.EscapeDataString(doctype)}/{Uri.EscapeDataString(name)}", null, ct);
        return node?["data"];
    }

    public async Task<JsonArray> ListAsync(ErpNextCompanyOptions cfg, string doctype, JsonArray? filters, string[] fields, int limit = 20, CancellationToken ct = default)
    {
        var query = new Dictionary<string, string>
        {
            ["fields"] = new JsonArray(fields.Select(f => (JsonNode?)JsonValue.Create(f)).ToArray()).ToJsonString(),
            ["limit_page_length"] = limit.ToString()
        };
        if (filters is not null) query["filters"] = filters.ToJsonString();

        var node = await GetAsync(cfg, $"/api/resource/{Uri.EscapeDataString(doctype)}", query, ct);
        return node?["data"] as JsonArray ?? new JsonArray();
    }

    private async Task<(int Status, string Body)> SendAsync(
        ErpNextCompanyOptions cfg, HttpMethod method, string path, IDictionary<string, string>? query, JsonNode? body, CancellationToken ct)
    {
        var url = cfg.BaseUrl + path;
        if (query is { Count: > 0 })
        {
            url += "?" + string.Join("&", query.Select(kv => $"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value)}"));
        }

        using var request = new HttpRequestMessage(method, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("token", $"{cfg.ApiKey}:{cfg.ApiSecret}");
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (body is not null)
        {
            request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        }

        try
        {
            var client = _httpClientFactory.CreateClient(HttpClientName);
            using var response = await client.SendAsync(request, ct);
            var text = await response.Content.ReadAsStringAsync(ct);
            return ((int)response.StatusCode, text);
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            throw new ErpNextException("ERPNext did not respond in time.");
        }
        catch (HttpRequestException ex)
        {
            // Log the type only: the message can echo the URL, and nothing here may carry credentials.
            _logger.LogWarning("ERPNext request failed to connect: {Method} {Path} ({ErrorType})", method, path, ex.GetType().Name);
            throw new ErpNextException("Could not reach ERPNext. Check the configured BaseUrl and network access.");
        }
    }

    private JsonNode? Unwrap(int status, string body)
    {
        if (status is >= 200 and < 300)
        {
            if (string.IsNullOrWhiteSpace(body)) return null;
            try { return JsonNode.Parse(body); }
            catch (JsonException) { throw new ErpNextException("ERPNext returned a response that is not valid JSON.", status); }
        }

        if (status is 401 or 403)
        {
            throw new ErpNextException(
                status == 401
                    ? "ERPNext rejected the API key/secret (401). Check the configured credentials."
                    : "ERPNext denied permission for this API user (403). " + ExtractMessage(body),
                status);
        }

        var message = ExtractMessage(body);
        _logger.LogWarning("ERPNext returned HTTP {Status}: {Message}", status, message);
        throw new ErpNextException($"ERPNext error ({status}): {message}", status);
    }

    /// <summary>Reduces a Frappe error body to one short plain-text line.</summary>
    private static string ExtractMessage(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return "no detail returned.";
        try
        {
            var root = JsonNode.Parse(body);
            var parts = new List<string>();

            // _server_messages is a JSON string containing an array of JSON strings, each {"message": "..."}.
            if (root?["_server_messages"]?.GetValue<string>() is { } raw)
            {
                foreach (var item in JsonNode.Parse(raw)?.AsArray() ?? new JsonArray())
                {
                    var inner = item?.GetValue<string>();
                    if (inner is null) continue;
                    var msg = JsonNode.Parse(inner)?["message"]?.GetValue<string>();
                    if (!string.IsNullOrWhiteSpace(msg)) parts.Add(msg);
                }
            }

            if (parts.Count == 0 && root?["exception"]?.GetValue<string>() is { } ex) parts.Add(ex);
            if (parts.Count == 0 && root?["message"]?.GetValue<string>() is { } m) parts.Add(m);
            if (parts.Count == 0 && root?["exc_type"]?.GetValue<string>() is { } t) parts.Add(t);
            if (parts.Count > 0) return Clean(string.Join(" ", parts));
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or FormatException)
        {
            // Not JSON (e.g. an HTML error page) — fall through to the stripped raw text.
        }

        return Clean(body);
    }

    private static string Clean(string text)
    {
        var plain = HtmlTag.Replace(text, " ");
        plain = Regex.Replace(plain, @"\s+", " ").Trim();
        return plain.Length > MaxMessageLength ? plain[..MaxMessageLength] + "…" : plain;
    }
}
