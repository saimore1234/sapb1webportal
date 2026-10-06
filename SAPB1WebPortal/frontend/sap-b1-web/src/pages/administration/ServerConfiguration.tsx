import { useEffect, useState } from 'react';
import { Plus, Trash2, Pencil, Power, PowerOff } from 'lucide-react';
import { ErrorState, EmptyState } from '../../components/StateViews';
import { TableSkeleton } from '../../components/ui/Skeleton';
import ResponsiveTable, { type ColumnDef } from '../../components/ui/ResponsiveTable';
import Modal from '../../components/ui/Modal';
import ServerConfigurationForm, {
  emptyServerConfigFormValues,
  type ServerConfigFormValues,
  type TestKind
} from '../../components/admin/ServerConfigurationForm';
import { usePermissions } from '../../permissions/usePermissions';
import { useToast } from '../../context/ToastContext';
import {
  getServerConfigurations,
  createServerConfiguration,
  updateServerConfiguration,
  enableServerConfiguration,
  disableServerConfiguration,
  deleteServerConfiguration,
  testServerConfigurationForm,
  testServerConfigurationFormSql,
  testServerConfigurationFormSap,
  testServerConfigurationSql,
  testServerConfigurationSap,
  testServerConfigurationAll
} from '../../api/admin';
import type { ServerConfiguration, TestConnectionResult } from '../../types';

function formatDate(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

function toTestPayload(v: ServerConfigFormValues) {
  return {
    sapCompanyDb: v.sapCompanyDb,
    serviceLayerUrl: v.serviceLayerUrl,
    sapUsername: v.sapUsername,
    sapPassword: v.sapPassword,
    sqlServer: v.sqlServer,
    sqlDatabase: v.sqlDatabase,
    sqlUsername: v.sqlUsername,
    sqlPassword: v.sqlPassword,
    sqlExtraOptions: v.sqlExtraOptions || null
  };
}

/** Tests the in-progress (not-yet-saved) form values via the pre-save endpoints. */
async function testFormValues(kind: TestKind, values: ServerConfigFormValues): Promise<{ sql?: TestConnectionResult; sap?: TestConnectionResult }> {
  const payload = toTestPayload(values);
  if (kind === 'sql') return { sql: await testServerConfigurationFormSql(payload) };
  if (kind === 'sap') return { sap: await testServerConfigurationFormSap(payload) };
  return testServerConfigurationForm(payload);
}

/** Owns the connection-test state for one Add/Edit modal, so the sticky
 * footer's "Test All" button and the Connection Testing card's own three
 * buttons drive the exact same state instead of running independent tests. */
function useConnectionTest(run: (kind: TestKind) => Promise<{ sql?: TestConnectionResult; sap?: TestConnectionResult }>) {
  const [testingKind, setTestingKind] = useState<TestKind | null>(null);
  const [sqlResult, setSqlResult] = useState<TestConnectionResult | null>(null);
  const [sapResult, setSapResult] = useState<TestConnectionResult | null>(null);

  async function onRunTest(kind: TestKind) {
    setTestingKind(kind);
    try {
      const outcome = await run(kind);
      if (outcome.sql) setSqlResult(outcome.sql);
      if (outcome.sap) setSapResult(outcome.sap);
    } catch (err: any) {
      const message = err?.response?.data?.message || err.message || 'Test failed.';
      if (kind === 'sql' || kind === 'all') setSqlResult({ success: false, message });
      if (kind === 'sap' || kind === 'all') setSapResult({ success: false, message });
    } finally {
      setTestingKind(null);
    }
  }

  const statusText = testingKind === 'sql'
    ? 'Testing SQL connection…'
    : testingKind === 'sap'
      ? 'Testing SAP Service Layer…'
      : testingKind === 'all'
        ? 'Testing all connections…'
        : sqlResult && sapResult
          ? sqlResult.success && sapResult.success
            ? 'Both connections successful'
            : 'One or more connections failed — see details below'
          : sqlResult
            ? sqlResult.success ? 'SQL connection successful' : 'SQL connection failed'
            : sapResult
              ? sapResult.success ? 'SAP connection successful' : 'SAP connection failed'
              : 'Ready';

  return { testingKind, sqlResult, sapResult, onRunTest, statusText };
}

/** Sticky header + scrollable body + sticky footer shell for the large
 * Add/Edit Server / Company modal (Modal variant="large"). */
function ConfigModalShell({
  title,
  subtitle,
  error,
  submitting,
  statusText,
  testingKind,
  onCancel,
  onTestAll,
  children
}: {
  title: string;
  subtitle: string;
  error: string | null;
  submitting: boolean;
  statusText: string;
  testingKind: TestKind | null;
  onCancel: () => void;
  onTestAll: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border-b border-border px-4 sm:px-6 py-3.5 sm:py-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-ink-primary">{title}</h2>
          <p className="hidden sm:block text-sm text-ink-secondary mt-0.5">{subtitle}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button type="button" className="btn-secondary text-sm py-2 px-3.5 flex-1 sm:flex-none" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn-primary text-sm py-2 px-3.5 flex-1 sm:flex-none" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save Configuration'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4">
        {error && <div className="bg-danger-bg text-danger text-sm rounded-lg px-3.5 py-2.5">{error}</div>}
        {children}
      </div>

      <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 sm:px-6 py-3.5">
        <span className="text-sm text-ink-tertiary">{statusText}</span>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary text-sm py-2 px-3.5" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn-secondary text-sm py-2 px-3.5" onClick={onTestAll} disabled={testingKind !== null}>
            {testingKind !== null ? 'Testing…' : 'Test All'}
          </button>
          <button type="submit" className="btn-primary text-sm py-2 px-3.5" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save Configuration'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ServerConfigurationPage() {
  const { canCreate, canEdit, canDelete } = usePermissions();
  const toast = useToast();
  const [items, setItems] = useState<ServerConfiguration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ServerConfiguration | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ServerConfiguration | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    getServerConfigurations()
      .then(setItems)
      .catch((err) => setError(err?.response?.data?.message || err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);


  async function toggleActive(item: ServerConfiguration) {
    try {
      if (item.isActive) {
        await disableServerConfiguration(item.id);
        toast.show({ variant: 'success', title: `${item.companyCode} disabled` });
      } else {
        await enableServerConfiguration(item.id);
        toast.show({ variant: 'success', title: `${item.companyCode} enabled` });
      }
      load();
    } catch (err: any) {
      toast.show({ variant: 'error', title: 'Failed to update status', description: err?.response?.data?.message || err.message });
    }
  }

  const columns: ColumnDef<ServerConfiguration>[] = [
    { key: 'companyCode', header: 'Company Code', render: (c) => <span className="font-medium text-ink-primary">{c.companyCode}</span> },
    { key: 'companyName', header: 'Company Name', render: (c) => c.companyName },
    { key: 'sapCompanyDb', header: 'SAP Company DB', className: 'hidden lg:table-cell text-ink-secondary', render: (c) => c.sapCompanyDb },
    { key: 'sqlServer', header: 'SQL Server / DB', className: 'hidden lg:table-cell text-ink-secondary', render: (c) => `${c.sqlServer} / ${c.sqlDatabase}` },
    {
      key: 'isActive',
      header: 'Status',
      render: (c) => <span className={c.isActive ? 'badge-success' : 'badge-neutral'}>{c.isActive ? 'Active' : 'Disabled'}</span>
    },
    {
      key: 'lastTestResult',
      header: 'Last Test',
      className: 'hidden md:table-cell',
      render: (c) =>
        c.lastTestResult ? (
          <span className={c.lastTestResult === 'Success' ? 'badge-success' : 'badge-danger'}>
            {c.lastTestResult} · {formatDate(c.lastTestedAtUtc)}
          </span>
        ) : (
          <span className="badge-neutral">Never tested</span>
        )
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (c) => (
        <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          {canEdit && (
            <button className="btn-ghost p-1.5" title="Edit" onClick={() => setEditTarget(c)}>
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {canEdit && (
            <button className="btn-ghost p-1.5" title={c.isActive ? 'Disable' : 'Enable'} onClick={() => toggleActive(c)}>
              {c.isActive ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
            </button>
          )}
          {canDelete && (
            <button className="btn-ghost p-1.5 text-danger" title="Delete" onClick={() => setDeleteTarget(c)}>
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      )
    }
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">Server / Company Configuration</h1>
          <p className="text-sm text-ink-secondary mt-0.5">Administration &gt; Server / Company Configuration</p>
        </div>
        {canCreate && (
          <button className="btn-primary text-sm py-2 px-3.5" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add Server / Company
          </button>
        )}
      </div>

      <div className="card p-0 overflow-hidden">
        {loading && <TableSkeleton cols={columns.length} />}
        {!loading && error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && items.length === 0 && (
          <EmptyState message="No companies configured yet." description="Add one to make it available in the login company dropdown — no code changes or redeploy needed." />
        )}
        {!loading && !error && items.length > 0 && (
          <ResponsiveTable
            columns={columns}
            rows={items}
            keyField={(c) => String(c.id)}
            renderMobileCard={(c) => (
              <div className="flex items-center justify-between px-4 py-3.5">
                <div className="min-w-0">
                  <p className="font-medium text-ink-primary">{c.companyCode}</p>
                  <p className="text-ink-tertiary text-xs">{c.companyName}</p>
                </div>
                <span className={c.isActive ? 'badge-success' : 'badge-neutral'}>{c.isActive ? 'Active' : 'Disabled'}</span>
              </div>
            )}
          />
        )}
      </div>

      {addOpen && (
        <AddServerConfigModal
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false);
            toast.show({ variant: 'success', title: 'Server configuration created' });
            load();
          }}
        />
      )}

      {editTarget && (
        <EditServerConfigModal
          item={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            toast.show({ variant: 'success', title: 'Server configuration updated' });
            load();
          }}
        />
      )}

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} variant="sheet">
        {deleteTarget && (
          <div className="p-6">
            <h2 className="text-lg font-semibold text-ink-primary mb-2">Delete {deleteTarget.companyCode}?</h2>
            <p className="text-sm text-ink-secondary mb-5">
              This cannot be undone. Prefer Disable if you might need this company again.
            </p>
            <div className="flex gap-2.5">
              <button className="btn-secondary flex-1" onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button
                className="btn-primary flex-1 !bg-danger hover:!bg-danger/90"
                onClick={async () => {
                  try {
                    await deleteServerConfiguration(deleteTarget.id);
                    toast.show({ variant: 'success', title: 'Server configuration deleted' });
                    setDeleteTarget(null);
                    load();
                  } catch (err: any) {
                    toast.show({ variant: 'error', title: 'Failed to delete', description: err?.response?.data?.message || err.message });
                  }
                }}
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function AddServerConfigModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [values, setValues] = useState<ServerConfigFormValues>(emptyServerConfigFormValues);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { testingKind, sqlResult, sapResult, onRunTest, statusText } = useConnectionTest((kind) => testFormValues(kind, values));

  return (
    <Modal open onClose={onClose} variant="large">
      <form
        className="h-full"
        onSubmit={async (e) => {
          e.preventDefault();
          setSubmitting(true);
          setError(null);
          try {
            await createServerConfiguration({
              companyCode: values.companyCode,
              companyName: values.companyName,
              sapCompanyDb: values.sapCompanyDb,
              serviceLayerUrl: values.serviceLayerUrl,
              sapUsername: values.sapUsername,
              sapPassword: values.sapPassword,
              sqlServer: values.sqlServer,
              sqlDatabase: values.sqlDatabase,
              sqlUsername: values.sqlUsername,
              sqlPassword: values.sqlPassword,
              sqlExtraOptions: values.sqlExtraOptions || null,
              isActive: values.isActive
            });
            onCreated();
          } catch (err: any) {
            setError(err?.response?.data?.message || err.message);
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <ConfigModalShell
          title="Add Server / Company"
          subtitle="Configure SAP Business One, Service Layer and SQL Server connection details for this company."
          error={error}
          submitting={submitting}
          statusText={statusText}
          testingKind={testingKind}
          onCancel={onClose}
          onTestAll={() => onRunTest('all')}
        >
          <ServerConfigurationForm
            mode="add"
            values={values}
            onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
            testingKind={testingKind}
            sqlResult={sqlResult}
            sapResult={sapResult}
            onRunTest={onRunTest}
          />
        </ConfigModalShell>
      </form>
    </Modal>
  );
}

function EditServerConfigModal({ item, onClose, onSaved }: { item: ServerConfiguration; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState<ServerConfigFormValues>({
    companyCode: item.companyCode,
    companyName: item.companyName,
    sapCompanyDb: item.sapCompanyDb,
    serviceLayerUrl: item.serviceLayerUrl,
    sapUsername: item.sapUsername,
    sapPassword: '',
    sqlServer: item.sqlServer,
    sqlDatabase: item.sqlDatabase,
    sqlUsername: item.sqlUsername,
    sqlPassword: '',
    sqlExtraOptions: item.sqlExtraOptions || '',
    isActive: item.isActive
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // If neither password field has been touched, test against the row's
  // already-stored secrets (server decrypts them); otherwise test the
  // currently-typed values, since the server can't test a not-yet-saved change.
  async function handleTest(kind: TestKind): Promise<{ sql?: TestConnectionResult; sap?: TestConnectionResult }> {
    if (values.sapPassword || values.sqlPassword) {
      return testFormValues(kind, values);
    }
    if (kind === 'sql') return { sql: await testServerConfigurationSql(item.id) };
    if (kind === 'sap') return { sap: await testServerConfigurationSap(item.id) };
    return testServerConfigurationAll(item.id);
  }

  const { testingKind, sqlResult, sapResult, onRunTest, statusText } = useConnectionTest(handleTest);

  return (
    <Modal open onClose={onClose} variant="large">
      <form
        className="h-full"
        onSubmit={async (e) => {
          e.preventDefault();
          setSubmitting(true);
          setError(null);
          try {
            await updateServerConfiguration(item.id, {
              companyName: values.companyName,
              sapCompanyDb: values.sapCompanyDb,
              serviceLayerUrl: values.serviceLayerUrl,
              sapUsername: values.sapUsername,
              sapPassword: values.sapPassword || null,
              sqlServer: values.sqlServer,
              sqlDatabase: values.sqlDatabase,
              sqlUsername: values.sqlUsername,
              sqlPassword: values.sqlPassword || null,
              sqlExtraOptions: values.sqlExtraOptions || null,
              isActive: values.isActive
            });
            onSaved();
          } catch (err: any) {
            setError(err?.response?.data?.message || err.message);
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <ConfigModalShell
          title={`Edit ${item.companyCode}`}
          subtitle="Configure SAP Business One, Service Layer and SQL Server connection details for this company."
          error={error}
          submitting={submitting}
          statusText={statusText}
          testingKind={testingKind}
          onCancel={onClose}
          onTestAll={() => onRunTest('all')}
        >
          <ServerConfigurationForm
            mode="edit"
            values={values}
            onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
            hasSapPassword={item.hasSapPassword}
            hasSqlPassword={item.hasSqlPassword}
            testingKind={testingKind}
            sqlResult={sqlResult}
            sapResult={sapResult}
            onRunTest={onRunTest}
          />
        </ConfigModalShell>
      </form>
    </Modal>
  );
}

