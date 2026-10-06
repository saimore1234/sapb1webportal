-- Cancellation of e-invoices (IRN) and e-way bills, recorded on the ERPNext link row, plus the cancel permission.
-- PORTAL database only (SAPB1PortalAdmin); nothing is written to SAP. Idempotent: safe to re-run.
--   sqlcmd -S <server> -d SAPB1PortalAdmin -E -C -i 009_ErpNextCancel.sql

SET NOCOUNT ON;

IF COL_LENGTH('dbo.ErpNextInvoiceLink', 'EInvoiceCancelledAtUtc') IS NULL
    ALTER TABLE dbo.ErpNextInvoiceLink ADD
        EInvoiceCancelledAtUtc DATETIME2     NULL,
        EInvoiceCancelReason   NVARCHAR(150) NULL,   -- "Reason: remark"
        EInvoiceCancelledBy    NVARCHAR(200) NULL,
        EwbCancelledAtUtc      DATETIME2     NULL,
        EwbCancelReason        NVARCHAR(150) NULL,
        EwbCancelledBy         NVARCHAR(200) NULL;

MERGE dbo.Permissions AS target
USING (VALUES
    ('ErpNext', 'Cancel', 'ErpNext.Cancel', 'Cancel an e-invoice (IRN) or e-way bill for an A/R Invoice through ERPNext')
) AS src (Module, Action, PermissionKey, Description)
ON target.PermissionKey = src.PermissionKey
WHEN NOT MATCHED THEN
    INSERT (Module, Action, PermissionKey, Description)
    VALUES (src.Module, src.Action, src.PermissionKey, src.Description);

-- Administrator only by default, like the other compliance permissions.
INSERT INTO dbo.RolePermissions (RoleId, PermissionId)
SELECT r.Id, p.Id
FROM dbo.Roles r
CROSS JOIN dbo.Permissions p
WHERE r.Name = 'Administrator'
  AND p.PermissionKey = 'ErpNext.Cancel'
  AND NOT EXISTS (SELECT 1 FROM dbo.RolePermissions rp WHERE rp.RoleId = r.Id AND rp.PermissionId = p.Id);

PRINT 'ERPNext cancel columns and permission complete.';
