using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using SAPB1.Api.Auth;
using SAPB1.Api.Data;
using SAPB1.Api.Interfaces;
using SAPB1.Api.Middleware;
using SAPB1.Api.Models;
using SAPB1.Api.Services;
using SAPB1.Api.Services.ErpNext;
using Serilog;

// ---------------------------------------------------------------
// Utility CLI mode: `dotnet run -- hash-password <plaintext>` prints a
// PBKDF2 hash you can paste into `dotnet user-secrets set "Auth:PortalPasswordHash" "..."`.
// This never starts the web server, so it's safe to run locally.
// ---------------------------------------------------------------
if (args.Length == 2 && args[0] == "hash-password")
{
    Console.WriteLine(PasswordHasher.HashPassword(args[1]));
    return;
}

var builder = WebApplication.CreateBuilder(args);

// ---------------------------------------------------------------
// Logging (Serilog) — request logs go to console + rolling file.
// Passwords/tokens/connection strings are never written to these logs;
// see ExceptionMiddleware, AuthService and SapServiceLayerAuthenticator for
// what is/isn't logged.
// ---------------------------------------------------------------
builder.Host.UseSerilog((ctx, cfg) => cfg
    .ReadFrom.Configuration(ctx.Configuration)
    .WriteTo.Console()
    .WriteTo.File("logs/sapb1-api-.log", rollingInterval: RollingInterval.Day));

// ---------------------------------------------------------------
// Configuration binding
// ---------------------------------------------------------------
builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection(JwtOptions.SectionName));
builder.Services.Configure<CompanyDatabaseOptions>(builder.Configuration.GetSection(CompanyDatabaseOptions.SectionName));

builder.Services.AddHttpContextAccessor();

// ---------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------

// Company allow-list + per-request company context/connection — see README
// "Multi-company architecture" and the XML docs on each interface.
builder.Services.AddSingleton<ICompanyRegistry, CompanyRegistry>();
builder.Services.AddScoped<ICompanyContext, CompanyContext>();
builder.Services.AddScoped<ICompanyConnectionFactory, CompanyConnectionFactory>();

// Database-driven Server/Company Configuration (Administration UI) — encrypts
// stored SAP/SQL passwords at rest via the Data Protection API, and keeps
// CompanyRegistry/CompanyConnectionFactory/SapServiceLayerSessionManager's
// in-memory cache (ICompanyConfigurationProvider) warm from dbo.ServerConfigurations.
// These were previously missing here, which broke company resolution entirely
// (CompanyRegistry has a hard dependency on ICompanyConfigurationProvider).
builder.Services.AddDataProtection()
    .SetApplicationName("SAPB1WebPortal")
    .PersistKeysToFileSystem(new DirectoryInfo(
        builder.Configuration["DataProtection:KeysDirectory"]
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "SAPB1WebPortal", "DataProtection-Keys")));
builder.Services.AddSingleton<ICompanyConfigurationProvider, CompanyConfigurationProvider>();
builder.Services.AddSingleton<ISecretProtector, DataProtectionSecretProtector>();
builder.Services.AddScoped<IAuditLogService, SqlAuditLogService>();
builder.Services.AddScoped<IServerConfigurationService, SqlServerConfigurationService>();
builder.Services.AddHostedService<ServerConfigurationCacheWarmupService>();

// RBAC — the portal's own Users/Roles/Permissions database (SAPB1PortalAdmin),
// completely separate from every SAP B1 company database. Global across
// companies, not scoped by ICompanyContext (see Data/PortalConnectionFactory.cs).
builder.Services.AddScoped<IPortalConnectionFactory, PortalConnectionFactory>();
builder.Services.AddScoped<IAdminService, SqlAdminService>();
builder.Services.AddHostedService<PortalSchemaBootstrapper>();

builder.Services.AddScoped<ISapB1Service, SqlSapB1Service>();
builder.Services.AddScoped<IPurchaseService, SqlPurchaseService>();
builder.Services.AddScoped<ISalesService, SqlSalesService>();
builder.Services.AddScoped<ISalesReportsService, SqlSalesReportsService>();
builder.Services.AddScoped<IProductionService, SqlProductionService>();
builder.Services.AddScoped<IFinanceService, SqlFinanceService>();
builder.Services.AddScoped<IReportsService, SqlReportsService>();
builder.Services.AddScoped<ISapB1PrintService, SapB1PrintService>();

// ---------------------------------------------------------------
// SAP B1 Service Layer authentication — implemented (SapServiceLayerAuthenticator)
// but NOT currently wired into the login flow. This environment's Service
// Layer sits behind an SLD (System Landscape Directory) / Keycloak SSO layer
// that intermittently fails server-side (error -304 "Fail to NONE-SSO login
// from SLD") independent of whether the SAP B1 password is correct — a SAP
// B1 server configuration/licensing issue, not something this codebase can
// fix. AuthService currently checks a single portal-managed credential
// instead (Auth:PortalUsername / Auth:PortalPasswordHash). To switch back to
// real SAP B1 authentication once that server-side issue is resolved,
// uncomment the two registrations below and make AuthService depend on
// ISapB1Authenticator again (see its constructor's XML doc comment).
// ---------------------------------------------------------------
// var allowInvalidServiceLayerCert = builder.Configuration.GetValue<bool>("SapServiceLayer:AllowInvalidCertificate");
// builder.Services.AddHttpClient("SapServiceLayer", client =>
// {
//     client.Timeout = TimeSpan.FromSeconds(30);
// })
// .ConfigurePrimaryHttpMessageHandler(() =>
// {
//     var handler = new HttpClientHandler();
//     if (allowInvalidServiceLayerCert)
//     {
//         handler.ServerCertificateCustomValidationCallback = (_, _, _, _) => true;
//     }
//     return handler;
// });
// builder.Services.AddScoped<ISapB1Authenticator, SapServiceLayerAuthenticator>();

// ---------------------------------------------------------------
// SAP B1 Service Layer WRITE client — separate from the (still-disabled)
// login-verification registration above. Used only by
// SapServiceLayerPurchaseWriteService/SapServiceLayerSessionManager for the
// one write endpoint in the API (POST /api/purchase/requests). Credentials
// come from "SapServiceLayerCredentials:{CompanyCode}" in user-secrets/env —
// a purpose-built B1 account per company, never the portal's own login.
// ---------------------------------------------------------------
var allowInvalidServiceLayerCertForWrite = builder.Configuration.GetValue<bool>("SapServiceLayer:AllowInvalidCertificate");
builder.Services.AddHttpClient("SapServiceLayerWrite", client =>
{
    client.Timeout = TimeSpan.FromSeconds(60);
})
.ConfigurePrimaryHttpMessageHandler(() =>
{
    var handler = new HttpClientHandler();
    if (allowInvalidServiceLayerCertForWrite)
    {
        handler.ServerCertificateCustomValidationCallback = (_, _, _, _) => true;
    }
    return handler;
});
builder.Services.AddSingleton<ISapServiceLayerSessionManager, SapServiceLayerSessionManager>();
builder.Services.AddScoped<IPurchaseRequestWriteService, SapServiceLayerPurchaseWriteService>();

// ---------------------------------------------------------------
// ERPNext integration — per-company settings come only from
// "ErpNext:Companies:{CompanyCode}" in user-secrets/env (never the request).
// Pushes A/R Invoices to ERPNext; never writes to SAP B1.
// ---------------------------------------------------------------
builder.Services.AddHttpClient("ErpNext", client =>
{
    client.Timeout = TimeSpan.FromSeconds(60);
});
builder.Services.AddScoped<IErpNextConfigProvider, ErpNextConfigProvider>();
builder.Services.AddScoped<IErpNextClient, ErpNextClient>();
builder.Services.AddScoped<IErpNextActionLog, SqlErpNextActionLog>();
builder.Services.AddScoped<IErpNextAdminService, ErpNextAdminService>();
builder.Services.AddScoped<ISapInvoiceReader, SqlSapInvoiceReader>();
builder.Services.AddScoped<IErpNextLinkStore, SqlErpNextLinkStore>();
builder.Services.AddScoped<ErpNextMasterSync>();
builder.Services.AddScoped<IErpNextInvoiceService, ErpNextInvoiceService>();
builder.Services.AddScoped<IErpNextComplianceService, ErpNextComplianceService>();

builder.Services.AddSingleton<ITokenRevocationStore, TokenRevocationStore>();
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<ITokenService, TokenService>();

builder.Services.AddControllers(options => options.Filters.Add<PageAccessFilter>());

// ---------------------------------------------------------------
// CORS — only the configured frontend origin(s) may call this API.
// ---------------------------------------------------------------
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? Array.Empty<string>();
builder.Services.AddCors(options =>
{
    options.AddPolicy("FrontendPolicy", policy =>
    {
        policy.WithOrigins(allowedOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

// ---------------------------------------------------------------
// JWT authentication
// ---------------------------------------------------------------
var jwtSection = builder.Configuration.GetSection(JwtOptions.SectionName);
var jwtKey = jwtSection["Key"];

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.RequireHttpsMetadata = !builder.Environment.IsDevelopment();
    options.SaveToken = false; // don't cache tokens server-side
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidIssuer = jwtSection["Issuer"],
        ValidateAudience = true,
        ValidAudience = jwtSection["Audience"],
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey ?? string.Empty)),
        ValidateLifetime = true,
        ClockSkew = TimeSpan.FromSeconds(30)
    };

    // Makes POST /api/auth/logout actually take effect immediately instead of
    // the token staying valid until it naturally expires — see
    // ITokenRevocationStore.
    options.Events = new JwtBearerEvents
    {
        OnTokenValidated = context =>
        {
            var jti = context.Principal?.FindFirstValue(JwtRegisteredClaimNames.Jti);
            var revocationStore = context.HttpContext.RequestServices.GetRequiredService<ITokenRevocationStore>();
            if (!string.IsNullOrEmpty(jti) && revocationStore.IsRevoked(jti))
            {
                context.Fail("Token has been revoked.");
            }
            return Task.CompletedTask;
        }
    };
});

builder.Services.AddAuthorization();

// ---------------------------------------------------------------
// Swagger / OpenAPI with Bearer auth support
// ---------------------------------------------------------------
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    // Sales and Purchase each define a class named RelatedDocumentDto; the default
    // short-name schema ids collide and make /swagger/v1/swagger.json return 500.
    options.CustomSchemaIds(type => type.FullName!.Replace("+", "."));

    options.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "SAP Business One Web Portal API",
        Version = "v1",
        Description = "Multi-company, read-only REST API over SAP Business One. Login authenticates " +
                      "against the real SAP B1 Service Layer for a chosen company database; every " +
                      "endpoint after that is automatically scoped to that company. Designed to be " +
                      "consumed by both the React web portal and future mobile apps."
    });

    var bearerScheme = new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "Enter a JWT token obtained from POST /api/auth/login."
    };
    options.AddSecurityDefinition("Bearer", bearerScheme);
    options.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        { new OpenApiSecurityScheme { Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" } }, Array.Empty<string>() }
    });
});

var app = builder.Build();

// ---------------------------------------------------------------
// Middleware pipeline
// ---------------------------------------------------------------
app.UseMiddleware<ExceptionMiddleware>();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c => c.SwaggerEndpoint("/swagger/v1/swagger.json", "SAP B1 Web Portal API v1"));
}

// Cloud container hosts (Render, Railway, Azure Web App for Containers, Fly.io)
// terminate HTTPS at their own edge and forward plain HTTP to this container;
// without trusting their X-Forwarded-* headers, UseHttpsRedirection below would
// see every request as HTTP and redirect it to HTTPS again, looping forever.
// Also harmless/no-op for a bare `dotnet run` or an IIS reverse proxy setup.
app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
    KnownNetworks = { },
    KnownProxies = { }
});

app.UseHttpsRedirection();
app.UseCors("FrontendPolicy");
app.UseAuthentication();
app.UseAuthorization();
app.UseSerilogRequestLogging();

app.MapControllers();

app.Run();
