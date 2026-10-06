import { ShieldAlert } from 'lucide-react';

/** Shown in place of a page the current user's role may not open. */
export default function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center px-4" role="alert">
      <div className="h-12 w-12 rounded-2xl bg-danger-bg text-danger flex items-center justify-center mb-4">
        <ShieldAlert className="h-5 w-5" />
      </div>
      <h1 className="text-xl font-semibold text-ink-primary mb-1.5">Access Denied</h1>
      <p className="text-ink-secondary text-sm">You don't have permission to view this page.</p>
    </div>
  );
}
