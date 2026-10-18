import { useState } from 'react';
import Modal from './ui/Modal';
import ServerConfigurationForm, {
  ConfigModalShell,
  emptyServerConfigFormValues,
  toTestPayload,
  useConnectionTest,
  type ServerConfigFormValues
} from './admin/ServerConfigurationForm';
import { setupCreateCompany, setupTestAll, setupTestSap, setupTestSql } from '../api/auth';

/**
 * Login-page "Configure Company": same form, tests and save as Administration →
 * Server / Company Configuration, for when no company is available to sign in
 * to yet. The portal admin credential is sent with every call and re-verified
 * server-side (see CompanySetupController).
 */
export default function CompanySetupModal({ onClose, onCreated }: { onClose: () => void; onCreated: (companyCode: string) => void }) {
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [values, setValues] = useState<ServerConfigFormValues>(emptyServerConfigFormValues);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const admin = { adminUsername, adminPassword };
  const { testingKind, sqlResult, sapResult, onRunTest, statusText } = useConnectionTest(async (kind) => {
    const payload = toTestPayload(values);
    if (kind === 'sql') return { sql: await setupTestSql(admin, payload) };
    if (kind === 'sap') return { sap: await setupTestSap(admin, payload) };
    return setupTestAll(admin, payload);
  });

  return (
    <Modal open onClose={onClose} variant="large">
      <form
        className="h-full"
        onSubmit={async (e) => {
          e.preventDefault();
          setSubmitting(true);
          setError(null);
          try {
            const created = await setupCreateCompany(admin, {
              ...toTestPayload(values),
              companyCode: values.companyCode,
              companyName: values.companyName,
              isActive: values.isActive
            });
            onCreated(created.code);
          } catch (err: any) {
            setError(err?.response?.data?.message || err.message);
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <ConfigModalShell
          title="Configure Company"
          subtitle="Add a SAP Business One company, test the connection, and it will appear in the login company list."
          error={error}
          submitting={submitting}
          statusText={statusText}
          testingKind={testingKind}
          onCancel={onClose}
          onTestAll={() => onRunTest('all')}
        >
          <div className="card space-y-4">
            <h3 className="text-xs font-semibold text-ink-tertiary uppercase tracking-wide">Portal Administrator</h3>
            <p className="text-xs text-ink-tertiary -mt-2">Required to test and save — the portal admin login, not a SAP user.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1.5">
                  Admin Username<span className="text-danger ml-0.5">*</span>
                </label>
                <input className="input-field" value={adminUsername} onChange={(e) => setAdminUsername(e.target.value)} required autoComplete="username" />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-secondary mb-1.5">
                  Admin Password<span className="text-danger ml-0.5">*</span>
                </label>
                <input
                  className="input-field"
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
            </div>
          </div>
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
