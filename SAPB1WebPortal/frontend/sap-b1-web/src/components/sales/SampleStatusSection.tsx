import { FlaskConical } from 'lucide-react';
import { SectionHeading } from './salesShared';

/**
 * Sample requests and their stage progress. Standard SAP B1 has no sample
 * object, and this installation exposes no sample table or user-defined
 * field, so there is no real data to show. This says so instead of drawing
 * made-up requests; it becomes a real section once the SAP source is named.
 */
export default function SampleStatusSection({ reportTo }: { reportTo?: string }) {
  return (
    <section aria-labelledby="smp-h" className="space-y-3">
      <SectionHeading id="smp-h" title="Sample Status" reportTo={reportTo} />
      <div className="card flex items-start gap-4">
        <div className="h-10 w-10 shrink-0 rounded-lg bg-surface-tertiary text-ink-secondary flex items-center justify-center">
          <FlaskConical className="h-5 w-5" />
        </div>
        <div className="text-sm">
          <p className="font-medium text-ink-primary">Sample tracking isn’t connected to SAP yet</p>
          <p className="text-ink-secondary mt-1">
            Sample requests (Requested → Sample Sent → Feedback → Approved / Rejected) aren’t a standard SAP Business One document. To show them here we need the
            SAP table or user-defined fields where your team records samples, for example a user-defined object or UDFs on Sales Quotations or Orders.
            Nothing is displayed until then, so no figures on this page are estimated.
          </p>
        </div>
      </div>
    </section>
  );
}
