import { Users, ShoppingCart, FileText, Wallet } from 'lucide-react';
import { ErrorState } from '../StateViews';
import { CardGridSkeleton } from '../ui/Skeleton';
import StatCard from '../StatCard';
import { SectionHeading, compactInr, num, useSalesOverview } from './salesShared';

/** Key Metrics tiles. `reportTo` set = dashboard use (heading links to the full report). */
export default function KeyMetricsSection({ reportTo }: { reportTo?: string }) {
  const { data, loading, error, reload } = useSalesOverview();
  if (error) return <div className="card"><ErrorState message={error} onRetry={reload} /></div>;
  return (
  <section aria-labelledby="kpi-h" className="space-y-3">
    <SectionHeading id="kpi-h" title="Key Metrics" reportTo={reportTo} />
    {loading || !data ? (
      <CardGridSkeleton count={4} />
    ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Total Customers"
          value={num.format(data.totalCustomers)}
          hint={`+${data.newCustomersThisQuarter} new this quarter`}
          icon={Users}
          accent="blue"
        />
        <StatCard
          label="Open Sales Orders"
          value={num.format(data.openSalesOrders)}
          hint={`${compactInr(data.openSalesOrderValue)} order value`}
          icon={ShoppingCart}
          accent="slate"
        />
        <StatCard
          label="Pending Invoices"
          value={num.format(data.pendingInvoices)}
          hint={`${compactInr(data.pendingInvoiceValue)} dispatched, yet to bill`}
          icon={FileText}
          accent="amber"
        />
        <StatCard
          label="Total Outstanding"
          value={compactInr(data.totalOutstanding)}
          hint={`${compactInr(data.overdueOutstanding)} overdue > ${data.overdueDaysThreshold} days`}
          icon={Wallet}
          accent={data.overdueOutstanding > 0 ? 'red' : 'green'}
        />
      </div>
    )}
  </section>
  );
}
