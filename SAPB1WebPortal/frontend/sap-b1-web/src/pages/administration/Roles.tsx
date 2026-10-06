import { useEffect, useMemo, useState } from 'react';
import { Plus, ShieldCheck, Check, ChevronRight, ChevronDown } from 'lucide-react';
import { ErrorState } from '../../components/StateViews';
import { LoadingState } from '../../components/StateViews';
import Modal from '../../components/ui/Modal';
import { useToast } from '../../context/ToastContext';
import { usePermissions } from '../../permissions/usePermissions';
import { getApplicationModules, STANDARD_ACTIONS, VIEW_ACTION, type PermissionModule, type PermissionPage } from '../../permissions/registry';
import { getRoles, createRole, getRolePermissions, updateRolePermissions } from '../../api/admin';
import type { AdminRole, PagePermission } from '../../types';

/**
 * Role permission matrix. Everything below is generated from the navigation registry
 * (getApplicationModules) — there is no module, page or action list in this file. A module
 * or page added to the navigation tree appears here automatically.
 *
 * State model:
 *  - moduleChecked: "Module.Action" keys (the same keys the server stores; unknown/orphaned
 *    keys loaded from the server are preserved untouched on save);
 *  - pageChecked:   "module.page.action" -> boolean for every registry page. A page with no
 *    stored rule starts out equal to its module's grant (the server treats a missing rule as
 *    "inherit"), so existing roles look and behave exactly as before until edited.
 * Effective access is module AND page (both must allow), mirrored by permissions/evaluate.ts.
 */

const modKey = (m: string, a: string) => `${m}.${a}`;
const pgKey = (m: string, p: string, a: string) => `${m}.${p}.${a}`;

function Cell({ locked, supported, checked, disabled, blocked, onClick, label }: { locked: boolean; supported: boolean; checked: boolean; disabled: boolean; blocked?: boolean; onClick: () => void; label: string }) {
  if (!supported) return <span className="text-ink-tertiary">—</span>;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      disabled={disabled}
      title={blocked ? 'Granted here, but blocked because the module-level permission is off' : undefined}
      onClick={onClick}
      className={`h-6 w-6 rounded-md border inline-flex items-center justify-center transition-colors ${
        checked ? 'bg-brand-600 border-brand-600 text-white' : 'border-border-strong text-transparent'
      } ${blocked ? 'opacity-40' : ''} ${locked ? 'opacity-60' : disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <Check className="h-3.5 w-3.5" />
    </button>
  );
}


export default function AdminRolesPage() {
  const { canEdit, canCreate } = usePermissions();
  const toast = useToast();
  const modules = useMemo(() => getApplicationModules(), []);
  // Standard actions first, then any extra action a module/page declares (e.g. "TestConnection").
  const columns = useMemo(() => {
    const extra = new Set<string>();
    for (const m of modules) {
      m.actions.forEach((a) => extra.add(a));
      m.pages.forEach((p) => p.actions.forEach((a) => extra.add(a)));
    }
    return [...STANDARD_ACTIONS, ...[...extra].filter((a) => !(STANDARD_ACTIONS as readonly string[]).includes(a))];
  }, [modules]);

  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [matrix, setMatrix] = useState<{ mod: Set<string>; pg: Map<string, boolean> }>({ mod: new Set(), pg: new Map() });
  const moduleChecked = matrix.mod;
  const pageChecked = matrix.pg;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  function load() {
    setLoading(true);
    setError(null);
    getRoles()
      .then((r) => {
        setRoles(r);
        if (!selectedRoleId && r.length > 0) setSelectedRoleId(r[0].id);
      })
      .catch((err) => setError(err?.response?.data?.message || err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  useEffect(() => {
    if (!selectedRoleId) return;
    setMatrixLoading(true);
    getRolePermissions(selectedRoleId)
      .then((r) => {
        const granted = new Set(r.permissionKeys);
        const rules = new Map(r.pagePermissions.map((p) => [pgKey(p.moduleKey, p.pageKey, p.action).toLowerCase(), p.isGranted]));
        const pages = new Map<string, boolean>();
        for (const m of modules)
          for (const p of m.pages)
            for (const a of p.actions) {
              const stored = rules.get(pgKey(m.key, p.key, a).toLowerCase());
              pages.set(pgKey(m.key, p.key, a), stored ?? granted.has(modKey(m.key, a)));
            }
        setMatrix({ mod: granted, pg: pages });
      })
      .catch((err) => toast.show({ variant: 'error', title: 'Failed to load permissions', description: err.message }))
      .finally(() => setMatrixLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRoleId]);

  const selectedRole = roles.find((r) => r.id === selectedRoleId) || null;
  const locked = !canEdit || !!selectedRole?.isSystemRole;
  const full = !!selectedRole?.isSystemRole;

  const isModuleOn = (m: PermissionModule, a: string) => full || moduleChecked.has(modKey(m.key, a));
  const isPageOn = (m: PermissionModule, p: PermissionPage, a: string) => full || !!pageChecked.get(pgKey(m.key, p.key, a));

  // ---- mutation helpers (all generic; View is the dependency of every other action) ----

  function mutate(fn: (mod: Set<string>, pg: Map<string, boolean>) => void) {
    if (locked) return;
    setMatrix((prev) => {
      const mod = new Set(prev.mod);
      const pg = new Map(prev.pg);
      fn(mod, pg);
      return { mod, pg };
    });
  }

  function setModuleAction(mod: Set<string>, m: PermissionModule, a: string, on: boolean) {
    if (!m.actions.includes(a)) return;
    if (on) {
      if (a !== VIEW_ACTION && !mod.has(modKey(m.key, VIEW_ACTION))) return;
      mod.add(modKey(m.key, a));
    } else if (a === VIEW_ACTION) {
      m.actions.forEach((x) => mod.delete(modKey(m.key, x)));
    } else {
      mod.delete(modKey(m.key, a));
    }
  }

  function setPageAction(pg: Map<string, boolean>, m: PermissionModule, p: PermissionPage, a: string, on: boolean) {
    if (!p.actions.includes(a)) return;
    if (on && a !== VIEW_ACTION && !pg.get(pgKey(m.key, p.key, VIEW_ACTION))) return;
    pg.set(pgKey(m.key, p.key, a), on);
    if (!on && a === VIEW_ACTION) p.actions.forEach((x) => pg.set(pgKey(m.key, p.key, x), false));
  }

  /** View first, so dependent actions are accepted. */
  const ordered = (actions: string[]) => [...actions].sort((x, y) => (x === VIEW_ACTION ? -1 : y === VIEW_ACTION ? 1 : 0));

  function setPageAll(pg: Map<string, boolean>, m: PermissionModule, p: PermissionPage, on: boolean) {
    ordered(p.actions).forEach((a) => setPageAction(pg, m, p, a, on));
  }

  function setModuleAll(mod: Set<string>, pg: Map<string, boolean>, m: PermissionModule, on: boolean) {
    ordered(m.actions).forEach((a) => setModuleAction(mod, m, a, on));
    m.pages.forEach((p) => setPageAll(pg, m, p, on));
  }

  const toggleModuleCell = (m: PermissionModule, a: string) =>
    mutate((mod) => setModuleAction(mod, m, a, !mod.has(modKey(m.key, a))));

  const togglePageCell = (m: PermissionModule, p: PermissionPage, a: string) =>
    mutate((_mod, pg) => setPageAction(pg, m, p, a, !pg.get(pgKey(m.key, p.key, a))));

  /** Column control: one action across the module and all its pages. */
  function setColumn(m: PermissionModule, a: string, on: boolean) {
    mutate((mod, pg) => {
      setModuleAction(mod, m, a, on);
      m.pages.forEach((p) => setPageAction(pg, m, p, a, on));
    });
  }

  const toggleExpanded = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  async function save() {
    if (!selectedRoleId) return;
    setSaving(true);
    try {
      const pagePermissions: PagePermission[] = [];
      for (const m of modules)
        for (const p of m.pages)
          for (const a of p.actions)
            pagePermissions.push({ moduleKey: m.key, pageKey: p.key, action: a, isGranted: !!pageChecked.get(pgKey(m.key, p.key, a)) });
      await updateRolePermissions(selectedRoleId, Array.from(moduleChecked), pagePermissions);
      toast.show({ variant: 'success', title: 'Permissions saved' });
      load();
    } catch (err: any) {
      toast.show({ variant: 'error', title: 'Failed to save', description: err?.response?.data?.message || err.message });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-primary">Roles</h1>
          <p className="text-sm text-ink-secondary mt-0.5">Administration &gt; Roles</p>
        </div>
        {canCreate && (
          <button className="btn-primary text-sm py-2 px-3.5" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add Role
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        <div className="card p-2">
          {roles.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedRoleId(r.id)}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-left text-sm transition-colors ${
                r.id === selectedRoleId ? 'bg-brand-50 dark:bg-brand-500/10 text-brand-700 dark:text-brand-300 font-medium' : 'text-ink-secondary hover:bg-surface-tertiary'
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                {r.isSystemRole && <ShieldCheck className="h-3.5 w-3.5 shrink-0" />}
                <span className="truncate">{r.name}</span>
              </span>
              <span className="text-xs text-ink-tertiary shrink-0">{r.userCount}</span>
            </button>
          ))}
        </div>

        <div className="card">
          {!selectedRole ? (
            <p className="text-sm text-ink-secondary">Select a role.</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-1">
                <div>
                  <h2 className="font-semibold text-ink-primary">{selectedRole.name}</h2>
                  {selectedRole.description && <p className="text-sm text-ink-secondary">{selectedRole.description}</p>}
                </div>
                {selectedRole.isSystemRole && <span className="badge-info">Always full access</span>}
              </div>

              <div className="flex gap-2 flex-wrap mt-4 mb-2">
                {!locked && (
                  <>
                    <button className="btn-secondary text-xs py-1.5 px-3" onClick={() => mutate((mod, pg) => modules.forEach((m) => setModuleAll(mod, pg, m, true)))}>
                      Select All
                    </button>
                    <button className="btn-secondary text-xs py-1.5 px-3" onClick={() => mutate((mod, pg) => modules.forEach((m) => setModuleAll(mod, pg, m, false)))}>
                      Clear All
                    </button>
                  </>
                )}
                <button className="btn-secondary text-xs py-1.5 px-3" onClick={() => setExpanded(new Set(modules.filter((m) => m.pages.length > 0).map((m) => m.key)))}>
                  Expand All
                </button>
                <button className="btn-secondary text-xs py-1.5 px-3" onClick={() => setExpanded(new Set())}>
                  Collapse All
                </button>
              </div>

              {matrixLoading ? (
                <LoadingState />
              ) : (
                <div className="overflow-x-auto mt-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-ink-tertiary">
                        <th className="py-2 pr-4 font-medium">Module / Page</th>
                        {columns.map((a) => (
                          <th key={a} className="py-2 px-2 font-medium text-center whitespace-nowrap">
                            {a.replace(/([a-z])([A-Z])/g, '$1 $2')}
                          </th>
                        ))}
                        {!locked && <th className="py-2 pl-2 font-medium text-right">All</th>}
                      </tr>
                    </thead>
                    {modules.map((m) => {
                      const open = expanded.has(m.key);
                      const hasPages = m.pages.length > 0;
                      const moduleView = isModuleOn(m, VIEW_ACTION);
                      return (
                        <tbody key={m.key} className="border-t border-border">
                          <tr className="bg-surface-tertiary/50">
                            <td className="py-2 pr-4 font-medium text-ink-primary">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1.5 text-left"
                                onClick={() => hasPages && toggleExpanded(m.key)}
                                aria-expanded={hasPages ? open : undefined}
                              >
                                {hasPages ? open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" /> : <span className="w-4" />}
                                {m.label}
                                {hasPages && <span className="text-xs font-normal text-ink-tertiary">({m.pages.length} pages)</span>}
                              </button>
                            </td>
                            {columns.map((a) => (
                              <td key={a} className="py-2 px-2 text-center">
                                <Cell
 locked={locked}
                                  supported={m.actions.includes(a)}
                                  checked={isModuleOn(m, a)}
                                  disabled={locked || (a !== VIEW_ACTION && !moduleView)}
                                  onClick={() => toggleModuleCell(m, a)}
                                  label={`${m.label} ${a}`}
                                />
                              </td>
                            ))}
                            {!locked && (
                              <td className="py-2 pl-2 text-right whitespace-nowrap">
                                <button className="text-xs text-brand-600 dark:text-brand-400 hover:underline mr-2" onClick={() => mutate((mod, pg) => setModuleAll(mod, pg, m, true))}>
                                  Select
                                </button>
                                <button className="text-xs text-ink-secondary hover:underline" onClick={() => mutate((mod, pg) => setModuleAll(mod, pg, m, false))}>
                                  Clear
                                </button>
                              </td>
                            )}
                          </tr>
                          {open &&
                            m.pages.map((p) => {
                              const pageView = isPageOn(m, p, VIEW_ACTION);
                              return (
                                <tr key={p.key}>
                                  <td className="py-1.5 pr-4 pl-8 text-ink-secondary">{p.label}</td>
                                  {columns.map((a) => (
                                    <td key={a} className="py-1.5 px-2 text-center">
                                      <Cell
 locked={locked}
                                        supported={p.actions.includes(a)}
                                        checked={isPageOn(m, p, a)}
                                        blocked={isPageOn(m, p, a) && !isModuleOn(m, a)}
                                        disabled={locked || (a !== VIEW_ACTION && !pageView)}
                                        onClick={() => togglePageCell(m, p, a)}
                                        label={`${m.label} ${p.label} ${a}`}
                                      />
                                    </td>
                                  ))}
                                  {!locked && (
                                    <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                                      <button className="text-xs text-brand-600 dark:text-brand-400 hover:underline mr-2" onClick={() => mutate((_mod, pg) => setPageAll(pg, m, p, true))}>
                                        Select
                                      </button>
                                      <button className="text-xs text-ink-secondary hover:underline" onClick={() => mutate((_mod, pg) => setPageAll(pg, m, p, false))}>
                                        Clear
                                      </button>
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          {open && !locked && (
                            <tr>
                              <td className="py-1 pl-8 text-xs text-ink-tertiary">Whole column</td>
                              {columns.map((a) => (
                                <td key={a} className="py-1 px-2 text-center whitespace-nowrap">
                                  {m.actions.includes(a) && (
                                    <>
                                      <button className="text-[11px] text-brand-600 dark:text-brand-400 hover:underline" onClick={() => setColumn(m, a, true)} aria-label={`Select ${a} for all ${m.label}`}>
                                        all
                                      </button>
                                      <span className="text-ink-tertiary"> · </span>
                                      <button className="text-[11px] text-ink-secondary hover:underline" onClick={() => setColumn(m, a, false)} aria-label={`Clear ${a} for all ${m.label}`}>
                                        none
                                      </button>
                                    </>
                                  )}
                                </td>
                              ))}
                              <td />
                            </tr>
                          )}
                        </tbody>
                      );
                    })}
                  </table>
                </div>
              )}

              {!locked && (
                <div className="flex justify-end mt-5">
                  <button className="btn-primary" onClick={save} disabled={saving}>
                    {saving ? 'Saving…' : 'Save Permissions'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {addOpen && (
        <AddRoleModal
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            setAddOpen(false);
            toast.show({ variant: 'success', title: 'Role created' });
            load();
          }}
        />
      )}
    </div>
  );
}

function AddRoleModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
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
            await createRole({ name, description: description || undefined });
            onCreated();
          } catch (err: any) {
            setError(err?.response?.data?.message || err.message);
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <h2 className="text-lg font-semibold text-ink-primary">Add Role</h2>
        {error && <div className="bg-danger-bg text-danger text-sm rounded-lg px-3.5 py-2.5">{error}</div>}
        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1.5">Name</label>
          <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1.5">Description</label>
          <input className="input-field" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="flex gap-2.5 pt-1">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary flex-1" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create Role'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
