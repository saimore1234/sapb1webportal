-- ERPNext integration tables (SAPB1PortalAdmin — the PORTAL database, never a SAP B1 company database).
-- ErpNextInvoiceLink : one row per (CompanyCode, DocEntry) A/R Invoice pushed to ERPNext.
-- ErpNextActionLog   : safe audit trail of every ERPNext action (test, setup, preview, push).
-- Idempotent: safe to re-run. Run once with:
--   sqlcmd -S <server> -d SAPB1PortalAdmin -E -C -i 006_CreateErpNextIntegrationSchema.sql

IF OBJECT_ID('dbo.ErpNextInvoiceLink', 'U') IS NULL
CREATE TABLE dbo.ErpNextInvoiceLink (
    Id                    INT IDENTITY(1,1) PRIMARY KEY,
    CompanyCode           NVARCHAR(50)  NOT NULL,   -- JWT companyDb claim / ICompanyRegistry Code
    DocEntry              INT           NOT NULL,   -- SAP OINV.DocEntry
    DocNum                INT           NOT NULL,   -- SAP OINV.DocNum (display / sap_b1_docnum)
    SapB1Key              NVARCHAR(100) NOT NULL,   -- "{CompanyCode}|{DocEntry}" = ERPNext sap_b1_key
    ErpNextCompany        NVARCHAR(140) NOT NULL,   -- snapshot of the configured ERPNext company
    PushStatus            NVARCHAR(20)  NOT NULL,   -- 'Pushing' | 'Pushed' | 'Failed'
    ErpNextInvoiceName    NVARCHAR(140) NULL,       -- e.g. SINV-00001, set once ERPNext confirms creation
    ErpNextDocStatus      NVARCHAR(30)  NULL,       -- 'Draft' | 'Submitted' | 'Cancelled' ...
    SapTotal              DECIMAL(19,4) NULL,       -- DocTotal (DocTotalFC if foreign currency)
    ErpNextGrandTotal     DECIMAL(19,4) NULL,
    ReconStatus           NVARCHAR(20)  NULL,       -- 'Match' | 'Mismatch' | NULL (not yet checked)
    ReconDetail           NVARCHAR(2000) NULL,      -- per-tax-type differences > 0.05
    PushedAtUtc           DATETIME2     NULL,
    PushedBy              NVARCHAR(200) NULL,
    LastError             NVARCHAR(1000) NULL,      -- sanitised message, never a raw exception
    LastSyncedAtUtc       DATETIME2     NULL,
    CreatedAt             DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    UpdatedAt             DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    RowVer                ROWVERSION
);

-- The claim: a second concurrent push for the same invoice hits this index and loses.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_ErpNextInvoiceLink_Company_DocEntry')
CREATE UNIQUE INDEX UQ_ErpNextInvoiceLink_Company_DocEntry ON dbo.ErpNextInvoiceLink(CompanyCode, DocEntry);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ErpNextInvoiceLink_ErpNextInvoiceName')
CREATE INDEX IX_ErpNextInvoiceLink_ErpNextInvoiceName ON dbo.ErpNextInvoiceLink(ErpNextInvoiceName);

IF OBJECT_ID('dbo.ErpNextActionLog', 'U') IS NULL
CREATE TABLE dbo.ErpNextActionLog (
    Id              INT IDENTITY(1,1) PRIMARY KEY,
    CompanyCode     NVARCHAR(50)  NOT NULL,
    DocEntry        INT           NULL,               -- NULL for company-level actions (test, setup)
    Action          NVARCHAR(40)  NOT NULL,           -- TestConnection | CreateCustomFields | Preview | Push ...
    PerformedBy     NVARCHAR(200) NOT NULL,
    PerformedAtUtc  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    Success         BIT           NOT NULL,
    Detail          NVARCHAR(1000) NULL               -- safe summary only — never a key, secret, or raw exception
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ErpNextActionLog_Company_PerformedAtUtc')
CREATE INDEX IX_ErpNextActionLog_Company_PerformedAtUtc ON dbo.ErpNextActionLog(CompanyCode, PerformedAtUtc DESC);

PRINT 'ERPNext integration schema complete.';
