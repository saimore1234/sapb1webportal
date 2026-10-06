import type { ReactElement } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import KeyMetricsSection from "../../../components/sales/KeyMetricsSection";
import SalesChartsSection from "../../../components/sales/SalesChartsSection";
import OpenOrdersSection from "../../../components/sales/OpenOrdersSection";
import InvoiceRegisterSection from "../../../components/sales/InvoiceRegisterSection";
import OutstandingSection from "../../../components/sales/OutstandingSection";
import LedgerSection from "../../../components/sales/LedgerSection";
import AnalyticsSection from "../../../components/sales/AnalyticsSection";
import SampleStatusSection from "../../../components/sales/SampleStatusSection";
import { salesReports, SALES_REPORTS_PATH } from "../../../data/salesReports";
import {
  RefreshBar,
  SalesRefreshProvider,
} from "../../../components/sales/salesRefresh";

/** The standalone (full-size) rendering of each report; the dashboard uses the same components. */
const reportBodies: Record<string, () => ReactElement> = {
  "key-metrics": () => <KeyMetricsSection />,
  "sales-overview": () => <SalesChartsSection />,
  "open-sales-orders": () => <OpenOrdersSection pageSize={20} />,
  "invoice-register": () => <InvoiceRegisterSection pageSize={20} />,
  "customer-outstanding": () => <OutstandingSection />,
  "customer-ledger": () => <LedgerSection />,
  "sales-analytics": () => <AnalyticsSection />,
  "sample-status": () => <SampleStatusSection />,
};

/** Sales → Reports: the hub listing the eight dashboard sections as reports. */
export function SalesReportsHub() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold text-ink-primary">
          Sales Reports
        </h1>
        <p className="text-ink-secondary text-sm mt-0.5">
          Each section of the Sales Dashboard, available as a full report.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {salesReports.map((r) => (
          <Link
            key={r.id}
            to={r.path}
            className="card hover:shadow-elevated transition-shadow block"
          >
            <p className="text-xs text-ink-tertiary">Section {r.number}</p>
            <h2 className="font-semibold text-ink-primary mt-1">{r.name}</h2>
            <p className="text-sm text-ink-secondary mt-1">{r.description}</p>
            <span className="mt-3 inline-flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400">
              Open report <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function SalesReportPage() {
  const { reportId = "" } = useParams();
  const report = salesReports.find((r) => r.id === reportId);
  const Body = reportBodies[reportId];

  if (!report || !Body) {
    return (
      <div className="card">
        <p className="text-ink-primary font-medium">Report not found.</p>
        <Link
          to={SALES_REPORTS_PATH}
          className="text-sm text-brand-600 dark:text-brand-400 mt-2 inline-block"
        >
          Back to Sales Reports
        </Link>
      </div>
    );
  }

  return (
    <SalesRefreshProvider>
      <div className="space-y-4">
        <Link
          to={SALES_REPORTS_PATH}
          className="inline-flex items-center gap-1.5 text-sm text-brand-600 dark:text-brand-400 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Sales Reports
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold text-ink-primary">
              {report.name}
            </h1>
            <p className="text-ink-secondary text-sm mt-0.5">
              {report.description}
            </p>
          </div>
          <RefreshBar />
        </div>
        <Body />
      </div>
    </SalesRefreshProvider>
  );
}
