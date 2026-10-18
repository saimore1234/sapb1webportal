import { useState } from 'react';
import { Loader2, CheckCircle2, XCircle, Circle, Eye, EyeOff } from 'lucide-react';
import type { TestConnectionResult } from '../../types';

export type TestKind = 'sql' | 'sap' | 'all';

export interface ServerConfigFormValues {
  companyCode: string;
  companyName: string;
  sapCompanyDb: string;
  serviceLayerUrl: string;
  sapUsername: string;
  sapPassword: string;
  sqlServer: string;
  sqlDatabase: string;
  sqlUsername: string;
  sqlPassword: string;
  sqlExtraOptions: string;
  isActive: boolean;
}

export const emptyServerConfigFormValues: ServerConfigFormValues = {
  companyCode: '',
  companyName: '',
  sapCompanyDb: '',
  serviceLayerUrl: '',
  sapUsername: '',
  sapPassword: '',
  sqlServer: '',
  sqlDatabase: '',
  sqlUsername: '',
  sqlPassword: '',
  sqlExtraOptions: '',
  isActive: true
};

// -----------------------------------------------------------------
// SQL Server host/port and Encrypt/Trust-Certificate are presentation-only
// conveniences layered on top of the two existing wire fields (sqlServer,
// sqlExtraOptions) — no backend/API change. "Server,Port" is how the backend
// already expects SqlServer to be written (see BuildSqlConnectionString), and
// Encrypt=True;TrustServerCertificate=True is a plain substring of the
// existing free-text SqlExtraOptions field.
// -----------------------------------------------------------------

function splitSqlServer(sqlServer: string): { host: string; port: string } {
  const idx = sqlServer.indexOf(',');
  return idx === -1 ? { host: sqlServer, port: '' } : { host: sqlServer.slice(0, idx), port: sqlServer.slice(idx + 1).trim() };
}

function combineSqlServer(host: string, port: string): string {
  return port.trim() ? `${host},${port.trim()}` : host;
}

function splitExtraOptions(extra: string): { encrypt: boolean; trustCert: boolean; other: string } {
  const parts = extra.split(';').map((s) => s.trim()).filter(Boolean);
  let encrypt = false;
  let trustCert = false;
  const other: string[] = [];
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'encrypt=true') encrypt = true;
    else if (lower === 'trustservercertificate=true') trustCert = true;
    else other.push(part);
  }
  return { encrypt, trustCert, other: other.join(';') };
}

function combineExtraOptions(encrypt: boolean, trustCert: boolean, other: string): string {
  const parts: string[] = [];
  if (encrypt) parts.push('Encrypt=True');
  if (trustCert) parts.push('TrustServerCertificate=True');
  const otherTrimmed = other.trim().replace(/;+$/, '');
  if (otherTrimmed) parts.push(otherTrimmed);
  return parts.join(';');
}

/**
 * Multi-section Server / Company Configuration form — enterprise ERP-style
 * two-column card layout, meant to be hosted inside Modal variant="large"
 * (see ServerConfiguration.tsx). Plain useState-per-field convention, no
 * schema library, matching the rest of Administration. Reuses the exact same
 * API contract as before (ServerConfigFormValues maps 1:1 onto
 * Create/UpdateServerConfigurationDto) — this is a presentation-only redesign.
 */
export default function ServerConfigurationForm({
  mode,
  values,
  onChange,
  hasSapPassword,
  hasSqlPassword,
  testingKind,
  sqlResult,
  sapResult,
  onRunTest
}: {
  mode: 'add' | 'edit';
  values: ServerConfigFormValues;
  onChange: (patch: Partial<ServerConfigFormValues>) => void;
  hasSapPassword?: boolean;
  hasSqlPassword?: boolean;
  /** Testing state is owned by the parent modal (ServerConfiguration.tsx) so
   *  the sticky footer's "Test All" button and this card's own buttons share
   *  one source of truth instead of running independent tests. */
  testingKind: TestKind | null;
  sqlResult: TestConnectionResult | null;
  sapResult: TestConnectionResult | null;
  onRunTest: (kind: TestKind) => void;
}) {
  const [showSapPassword, setShowSapPassword] = useState(false);
  const [showSqlPassword, setShowSqlPassword] = useState(false);

  const [{ host: sqlHost, port: sqlPort }, setSqlServerParts] = useState(() => splitSqlServer(values.sqlServer));
  const [{ encrypt, trustCert, other: otherOptions }, setExtraOptionParts] = useState(() => splitExtraOptions(values.sqlExtraOptions));

  const set = <K extends keyof ServerConfigFormValues>(key: K) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ [key]: e.target.value } as Partial<ServerConfigFormValues>);

  function updateSqlServer(host: string, port: string) {
    setSqlServerParts({ host, port });
    onChange({ sqlServer: combineSqlServer(host, port) });
  }

  function updateExtraOptions(nextEncrypt: boolean, nextTrustCert: boolean, nextOther: string) {
    setExtraOptionParts({ encrypt: nextEncrypt, trustCert: nextTrustCert, other: nextOther });
    onChange({ sqlExtraOptions: combineExtraOptions(nextEncrypt, nextTrustCert, nextOther) });
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SectionCard title="Company Information">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Company Code" required>
              <input
                className="input-field"
                value={values.companyCode}
                onChange={set('companyCode')}
                disabled={mode === 'edit'}
                required
                placeholder="AQUILA"
              />
              {mode === 'edit' && <p className="text-xs text-ink-tertiary mt-1">Can't be changed after creation.</p>}
            </Field>
            <Field label="Company Name" required>
              <input className="input-field" value={values.companyName} onChange={set('companyName')} required placeholder="Aquila Organics Pvt Ltd" />
            </Field>
          </div>
          <Field label="Status">
            <select
              className="input-field appearance-none max-w-[200px]"
              value={values.isActive ? '1' : '0'}
              onChange={(e) => onChange({ isActive: e.target.value === '1' })}
            >
              <option value="1">Active</option>
              <option value="0">Inactive</option>
            </select>
            <p className="text-xs text-ink-tertiary mt-1">Inactive hides this company from login and disconnects it immediately.</p>
          </Field>
        </SectionCard>

        <SectionCard title="SAP B1 Service Layer">
          <Field label="Service Layer URL" required helper="Base URL used to connect to the SAP Business One Service Layer.">
            <input className="input-field" value={values.serviceLayerUrl} onChange={set('serviceLayerUrl')} required placeholder="https://192.168.1.50:50000/b1s/v1" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="SAP Company DB" required>
              <input className="input-field" value={values.sapCompanyDb} onChange={set('sapCompanyDb')} required placeholder="AQUILA_LIVE" />
            </Field>
            <Field label="SAP Username" required>
              <input className="input-field" value={values.sapUsername} onChange={set('sapUsername')} required placeholder="manager" />
            </Field>
          </div>
          <Field label="SAP Password" required={mode === 'add'}>
            <PasswordInput
              value={values.sapPassword}
              onChange={set('sapPassword')}
              required={mode === 'add'}
              show={showSapPassword}
              onToggleShow={() => setShowSapPassword((s) => !s)}
              placeholder={mode === 'edit' && hasSapPassword ? 'Leave blank to keep the existing password' : ''}
            />
          </Field>
        </SectionCard>
      </div>

      <SectionCard title="SQL Server Configuration">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="SQL Server" required>
            <input className="input-field" value={sqlHost} onChange={(e) => updateSqlServer(e.target.value, sqlPort)} required placeholder="192.168.1.50" />
          </Field>
          <Field label="Port">
            <input className="input-field" value={sqlPort} onChange={(e) => updateSqlServer(sqlHost, e.target.value)} placeholder="1433" inputMode="numeric" />
          </Field>
          <Field label="SQL Database" required>
            <input className="input-field" value={values.sqlDatabase} onChange={set('sqlDatabase')} required placeholder="AQUILA_LIVE" />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="SQL Username" required>
            <input className="input-field" value={values.sqlUsername} onChange={set('sqlUsername')} required placeholder="sa" />
          </Field>
          <Field label="SQL Password" required={mode === 'add'}>
            <PasswordInput
              value={values.sqlPassword}
              onChange={set('sqlPassword')}
              required={mode === 'add'}
              show={showSqlPassword}
              onToggleShow={() => setShowSqlPassword((s) => !s)}
              placeholder={mode === 'edit' && hasSqlPassword ? 'Leave blank to keep the existing password' : ''}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-1">
          <label className="flex items-center gap-2 text-sm text-ink-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={encrypt}
              onChange={(e) => updateExtraOptions(e.target.checked, trustCert, otherOptions)}
              className="h-4 w-4 rounded border-border-strong text-brand-600"
            />
            Encrypt Connection
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={trustCert}
              onChange={(e) => updateExtraOptions(encrypt, e.target.checked, otherOptions)}
              className="h-4 w-4 rounded border-border-strong text-brand-600"
            />
            Trust Server Certificate
          </label>
        </div>
        <Field label="Other connection options (optional)" helper="Any additional ADO.NET connection string options, e.g. MultiSubnetFailover=True.">
          <input className="input-field" value={otherOptions} onChange={(e) => updateExtraOptions(encrypt, trustCert, e.target.value)} placeholder="" />
        </Field>
      </SectionCard>

      <SectionCard title="Connection Testing">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <StatusRow label="SQL Server" result={sqlResult} testing={testingKind === 'sql' || testingKind === 'all'} />
          <StatusRow label="SAP Service Layer" result={sapResult} testing={testingKind === 'sap' || testingKind === 'all'} />
        </div>

        <div className="flex flex-wrap items-center gap-2.5 pt-1">
          <TestButton label="Test SQL Connection" busyLabel="Testing SQL connection…" kind="sql" testingKind={testingKind} onClick={onRunTest} />
          <TestButton label="Test SAP Service Layer" busyLabel="Testing SAP Service Layer…" kind="sap" testingKind={testingKind} onClick={onRunTest} />
          <TestButton label="Test All Connections" busyLabel="Testing all connections…" kind="all" testingKind={testingKind} onClick={onRunTest} />
        </div>

        {(sqlResult || sapResult) && (
          <div className="space-y-1.5 text-sm pt-1">
            {sqlResult && <TestResultLine label="SQL Server" result={sqlResult} />}
            {sapResult && <TestResultLine label="SAP Service Layer" result={sapResult} />}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card space-y-4">
      <h3 className="text-xs font-semibold text-ink-tertiary uppercase tracking-wide">{title}</h3>
      {children}
    </div>
  );
}

function Field({
  label,
  required,
  helper,
  children
}: {
  label: string;
  required?: boolean;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-ink-secondary mb-1.5">
        {label}
        {required && <span className="text-danger ml-0.5">*</span>}
      </label>
      {children}
      {helper && <p className="text-xs text-ink-tertiary mt-1">{helper}</p>}
    </div>
  );
}

function PasswordInput({
  value,
  onChange,
  required,
  show,
  onToggleShow,
  placeholder
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean;
  show: boolean;
  onToggleShow: () => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <input
        className="input-field pr-10"
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
        autoComplete="new-password"
      />
      <button
        type="button"
        onClick={onToggleShow}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-tertiary hover:text-ink-secondary"
        tabIndex={-1}
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function TestButton({
  label,
  busyLabel,
  kind,
  testingKind,
  onClick
}: {
  label: string;
  busyLabel: string;
  kind: TestKind;
  testingKind: TestKind | null;
  onClick: (kind: TestKind) => void;
}) {
  const isTesting = testingKind === kind;
  return (
    <button type="button" className="btn-secondary text-sm py-2 px-3.5" onClick={() => onClick(kind)} disabled={testingKind !== null}>
      {isTesting ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" /> {busyLabel}
        </>
      ) : (
        label
      )}
    </button>
  );
}

function StatusRow({ label, result, testing }: { label: string; result: TestConnectionResult | null; testing: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border px-3.5 py-2.5">
      <span className="text-sm font-medium text-ink-secondary">{label}</span>
      {testing ? (
        <span className="flex items-center gap-1.5 text-sm text-ink-tertiary">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Testing…
        </span>
      ) : result ? (
        <span className={`flex items-center gap-1.5 text-sm font-medium ${result.success ? 'text-success' : 'text-danger'}`}>
          {result.success ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
          {result.success ? 'Connected' : 'Failed'}
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-sm text-ink-tertiary">
          <Circle className="h-2.5 w-2.5 fill-current" /> Not Tested
        </span>
      )}
    </div>
  );
}

function TestResultLine({ label, result }: { label: string; result: TestConnectionResult }) {
  return (
    <div className={`flex items-start gap-2 rounded-lg px-3.5 py-2.5 ${result.success ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>
      {result.success ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> : <XCircle className="h-4 w-4 mt-0.5 shrink-0" />}
      <span>
        <strong>{label}:</strong> {result.message}
      </span>
    </div>
  );
}

export function toTestPayload(v: ServerConfigFormValues) {
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

/** Owns the connection-test state for one Add/Edit modal, so the sticky
 * footer's "Test All" button and the Connection Testing card's own three
 * buttons drive the exact same state instead of running independent tests. */
export function useConnectionTest(run: (kind: TestKind) => Promise<{ sql?: TestConnectionResult; sap?: TestConnectionResult }>) {
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
export function ConfigModalShell({
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
