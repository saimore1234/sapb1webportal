-- E-Invoice (IRN) and E-Way Bill results on the ERPNext link row, plus their permissions.
-- All of it lives in the PORTAL database (SAPB1PortalAdmin); nothing is written to SAP.
-- Idempotent: safe to re-run. Run once with:
--   sqlcmd -S <server> -d SAPB1PortalAdmin -E -C -i 008_ErpNextEInvoiceEwayBill.sql

SET NOCOUNT ON;

IF COL_LENGTH('dbo.ErpNextInvoiceLink', 'Irn') IS NULL
    ALTER TABLE dbo.ErpNextInvoiceLink ADD
        Irn               NVARCHAR(100)  NULL,   -- Invoice Reference Number from the GST e-invoice portal
        AckNo             NVARCHAR(50)   NULL,   -- acknowledgement number
        AckDate           DATETIME2      NULL,   -- acknowledged on
        EInvoiceStatus    NVARCHAR(30)   NULL,   -- 'Generating' | 'Generated' | 'Failed' | 'Cancelled' ...
        EInvoiceAtUtc     DATETIME2      NULL,
        EInvoiceBy        NVARCHAR(200)  NULL,
        EInvoiceError     NVARCHAR(1000) NULL,   -- sanitised message, never a raw exception
        EwbNo             NVARCHAR(30)   NULL,   -- e-way bill number
        EwbDate           DATETIME2      NULL,
        EwbValidUpto      DATETIME2      NULL,
        EwbStatus         NVARCHAR(30)   NULL,   -- 'Generating' | 'Generated' | 'Failed' | 'Cancelled' ...
        EwbAtUtc          DATETIME2      NULL,
        EwbBy             NVARCHAR(200)  NULL,
        EwbError          NVARCHAR(1000) NULL;

MERGE dbo.Permissions AS target
USING (VALUES
    ('ErpNext', 'EInvoice', 'ErpNext.EInvoice', 'Generate an e-invoice (IRN) for an A/R Invoice through ERPNext'),
    ('ErpNext', 'EwayBill', 'ErpNext.EwayBill', 'Generate an e-way bill for an A/R Invoice through ERPNext')
) AS src (Module, Action, PermissionKey, Description)
ON target.PermissionKey = src.PermissionKey
WHEN NOT MATCHED THEN
    INSERT (Module, Action, PermissionKey, Description)
    VALUES (src.Module, src.Action, src.PermissionKey, src.Description);

-- Administrator only by default. An IRN cannot be undone after 24 hours, so grant these to other roles deliberately.
INSERT INTO dbo.RolePermissions (RoleId, PermissionId)
SELECT r.Id, p.Id
FROM dbo.Roles r
CROSS JOIN dbo.Permissions p
WHERE r.Name = 'Administrator'
  AND p.PermissionKey IN ('ErpNext.EInvoice', 'ErpNext.EwayBill')
  AND NOT EXISTS (SELECT 1 FROM dbo.RolePermissions rp WHERE rp.RoleId = r.Id AND rp.PermissionId = p.Id);

PRINT 'ERPNext e-invoice / e-way bill schema and permissions complete.';
