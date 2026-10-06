import { useEffect, useState } from 'react';
import { Plus, KeyRound, Trash2, Pencil } from 'lucide-react';
import { ErrorState, EmptyState } from '../../components/StateViews';
import { TableSkeleton } from '../../components/ui/Skeleton';
import ResponsiveTable, { type ColumnDef } from '../../components/ui/ResponsiveTable';
import Modal from '../../components/ui/Modal';
import { usePermissions } from '../../permissions/usePermissions';
import { useToast } from '../../context/ToastContext';
import { getUsers, getRoles, createUser, updateUser, resetUserPassword, deleteUser } from '../../api/admin';
import type { AdminUser, AdminRole } from '../../types';

function formatDate(value: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

export default function AdminUsersPage() {
  const { canCreate, canEdit, canDelete } = usePermissions();
  const toast = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [resetUser, setResetUser] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    Promise.all([getUsers(), getRoles()])
      .then(([u, r]) => {
        setUsers(u);
        setRoles(r);
      })
      .catch((err) => setError(err?.response?.data?.message || err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);


  const columns: ColumnDef<AdminUser>[] = [
    { key: 'username', header: 'Username', render: (u) => <span className="font-medium text-ink-primary">{u.username}</span> },
    { key: 'displayName', header: 'Display Name', render: (u) => u.displayName },
    { key: 'roleName', header: 'Role', render: (u) => u.roleName || '—' },
    {
      key: 'isActive',
      header: 'Status',
      render: (u) => <span className={u.isActive ? 'badge-success' : 'badge-neutral'}>{u.isActive ? 'Active' : 'Disabled'}</span>
    },
    { key: 'createdAt', header: 'Created', className: 'hidden md:table-cell text-ink-secondary', render: (u) => formatDate(u.createdAt) },
    { key: 'lastLoginAt', header: 'Last Login', className: 'hidden lg:table-cell text-ink-secondary', render: (u) => formatDate(u.lastLoginAt) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (u) => (
        <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          {canEdit && (
            <button className="btn-ghost p-1.5" title="Edit / Enable-Disable" onClick={() => setEditUser(u)}>
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {canEdit && (
            <button className="btn-ghost p-1.5" title="Reset Password" onClick={() => setResetUser(u)}>
              <KeyRound className="h-4 w-4" />
            </button>
          )}
          {canDelete && (
            <button className="btn-ghost p-1.5 text-danger" title="Delete" onClick={() => setDeleteTarget(u)}>
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
          <h1 className="text-xl font-semibold text-ink-primary">Users</h1>
          <p className="text-sm text-ink-secondary mt-0.5">Administration &gt; Users</p>
        </div>
        {canCreate && (
          <button className="btn-primary text-sm py-2 px-3.5" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add User
          </button>
        )}
      </div>

      <div className="card p-0 overflow-hidden">
        {loading && <TableSkeleton cols={columns.length} />}
        {!loading && error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && users.length === 0 && <EmptyState message="No users found." />}
        {!loading && !error && users.length > 0 && (
          <ResponsiveTable
            columns={columns}
            rows={users}
            keyField={(u) => String(u.id)}
            renderMobileCard={(u) => (
              <div className="flex items-center justify-between px-4 py-3.5">
                <div className="min-w-0">
                  <p className="font-medium text-ink-primary">{u.username}</p>
                  <p className="text-ink-tertiary text-xs">{u.roleName || '—'}</p>
                </div>
                <span className={u.isActive ? 'badge-success' : 'badge-neutral'}>{u.isActive ? 'Active' : 'Disabled'}</span>
              </div>
            )}
          />
        )}
      </div>

      {addOpen && (
        <AddUserModal
          roles={roles}
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false);
            toast.show({ variant: 'success', title: 'User created' });
            load();
          }}
        />
      )}

      {editUser && (
        <EditUserModal
          user={editUser}
          roles={roles}
          onClose={() => setEditUser(null)}
          onSaved={() => {
            setEditUser(null);
            toast.show({ variant: 'success', title: 'User updated' });
            load();
          }}
        />
      )}

      {resetUser && (
        <ResetPasswordModal
          user={resetUser}
          onClose={() => setResetUser(null)}
          onDone={() => {
            setResetUser(null);
            toast.show({ variant: 'success', title: 'Password reset' });
          }}
        />
      )}

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} variant="sheet">
        {deleteTarget && (
          <div className="p-6">
            <h2 className="text-lg font-semibold text-ink-primary mb-2">Delete {deleteTarget.username}?</h2>
            <p className="text-sm text-ink-secondary mb-5">This cannot be undone.</p>
            <div className="flex gap-2.5">
              <button className="btn-secondary flex-1" onClick={() => setDeleteTarget(null)}>
                Cancel
              </button>
              <button
                className="btn-primary flex-1 !bg-danger hover:!bg-danger/90"
                onClick={async () => {
                  try {
                    await deleteUser(deleteTarget.id);
                    toast.show({ variant: 'success', title: 'User deleted' });
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

function AddUserModal({ roles, onClose, onCreated }: { roles: AdminRole[]; onClose: () => void; onCreated: () => void }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState(roles[0]?.id ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <Modal open onClose={onClose} variant="sheet">
      <form
        className="p-6 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setSubmitting(true);
          setError(null);
          try {
            await createUser({ username, displayName: displayName || username, password, roleId });
            onCreated();
          } catch (err: any) {
            setError(err?.response?.data?.message || err.message);
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <h2 className="text-lg font-semibold text-ink-primary">Add User</h2>
        {error && <div className="bg-danger-bg text-danger text-sm rounded-lg px-3.5 py-2.5">{error}</div>}
        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1.5">Username</label>
          <input className="input-field" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1.5">Display Name</label>
          <input className="input-field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={username} />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1.5">Password</label>
          <input className="input-field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1.5">Role</label>
          <select className="input-field appearance-none" value={roleId} onChange={(e) => setRoleId(Number(e.target.value))}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2.5 pt-1">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary flex-1" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create User'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditUserModal({
  user,
  roles,
  onClose,
  onSaved
}: {
  user: AdminUser;
  roles: AdminRole[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [isActive, setIsActive] = useState(user.isActive);
  const [roleId, setRoleId] = useState(roles.find((r) => r.name === user.roleName)?.id ?? roles[0]?.id ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <Modal open onClose={onClose} variant="sheet">
      <form
        className="p-6 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setSubmitting(true);
          setError(null);
          try {
            await updateUser(user.id, { displayName, isActive, roleId });
            onSaved();
          } catch (err: any) {
            setError(err?.response?.data?.message || err.message);
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <h2 className="text-lg font-semibold text-ink-primary">Edit {user.username}</h2>
        {error && <div className="bg-danger-bg text-danger text-sm rounded-lg px-3.5 py-2.5">{error}</div>}
        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1.5">Display Name</label>
          <input className="input-field" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1.5">Role</label>
          <select className="input-field appearance-none" value={roleId} onChange={(e) => setRoleId(Number(e.target.value))}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-secondary cursor-pointer select-none">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-4 w-4 rounded border-border-strong text-brand-600" />
          Active (unchecked disables this account — they will not be able to log in)
        </label>
        <div className="flex gap-2.5 pt-1">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary flex-1" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: () => void }) {
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <Modal open onClose={onClose} variant="sheet">
      <form
        className="p-6 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setSubmitting(true);
          setError(null);
          try {
            await resetUserPassword(user.id, newPassword);
            onDone();
          } catch (err: any) {
            setError(err?.response?.data?.message || err.message);
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <h2 className="text-lg font-semibold text-ink-primary">Reset password for {user.username}</h2>
        {error && <div className="bg-danger-bg text-danger text-sm rounded-lg px-3.5 py-2.5">{error}</div>}
        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1.5">New Password</label>
          <input className="input-field" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} />
        </div>
        <div className="flex gap-2.5 pt-1">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary flex-1" disabled={submitting}>
            {submitting ? 'Resetting…' : 'Reset Password'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
