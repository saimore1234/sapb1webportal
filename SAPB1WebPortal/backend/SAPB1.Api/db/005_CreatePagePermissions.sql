-- Page-level permissions (module -> page -> action), additive to the existing
-- module-level dbo.Permissions / dbo.RolePermissions tables. No page names are
-- stored in schema: rows are generic (ModuleKey, PageKey, Action) triples whose
-- keys come from the frontend navigation registry. A missing row means
-- "inherit the module-level grant", so every existing role keeps working
-- unchanged. Rows for pages later removed from navigation are simply orphaned
-- (never deleted). Idempotent: safe to re-run (also applied at API startup by
-- PortalSchemaBootstrapper).

IF OBJECT_ID('dbo.RolePagePermissions', 'U') IS NULL
CREATE TABLE dbo.RolePagePermissions (
    RoleId INT NOT NULL,
    ModuleKey NVARCHAR(50) NOT NULL,
    PageKey NVARCHAR(100) NOT NULL,
    Action NVARCHAR(50) NOT NULL,
    IsGranted BIT NOT NULL,
    UpdatedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_RolePagePermissions PRIMARY KEY (RoleId, ModuleKey, PageKey, Action),
    CONSTRAINT FK_RolePagePermissions_Roles FOREIGN KEY (RoleId) REFERENCES dbo.Roles(Id) ON DELETE CASCADE
);
