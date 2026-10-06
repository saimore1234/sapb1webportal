-- Permissions for the ERPNext integration. Flat Module.Action keys, same
-- convention as 002/004. Idempotent: safe to re-run.
--   ErpNext.View  : see a pushed invoice's ERPNext link/status
--   ErpNext.Push  : push an A/R Invoice to ERPNext as a draft
--   ErpNext.Admin : test connection, create custom fields, mapping preview

SET NOCOUNT ON;

MERGE dbo.Permissions AS target
USING (VALUES
    ('ErpNext', 'View',  'ErpNext.View',  'View ERPNext link status for A/R Invoices'),
    ('ErpNext', 'Push',  'ErpNext.Push',  'Push an A/R Invoice to ERPNext as a draft Sales Invoice'),
    ('ErpNext', 'Admin', 'ErpNext.Admin', 'ERPNext setup: test connection, create custom fields, mapping preview')
) AS src (Module, Action, PermissionKey, Description)
ON target.PermissionKey = src.PermissionKey
WHEN NOT MATCHED THEN
    INSERT (Module, Action, PermissionKey, Description)
    VALUES (src.Module, src.Action, src.PermissionKey, src.Description);

-- Administrator gets every ErpNext permission. Deliberately no default grant
-- to any other role (same stance as ServerConfiguration.*): grant explicitly
-- per role via Administration > Roles.
INSERT INTO dbo.RolePermissions (RoleId, PermissionId)
SELECT r.Id, p.Id
FROM dbo.Roles r
CROSS JOIN dbo.Permissions p
WHERE r.Name = 'Administrator'
  AND p.Module = 'ErpNext'
  AND NOT EXISTS (SELECT 1 FROM dbo.RolePermissions rp WHERE rp.RoleId = r.Id AND rp.PermissionId = p.Id);

PRINT 'ErpNext permission seed complete.';
