import { Link } from "react-router-dom";
import TurnoverSection from "../../components/sales/TurnoverSection";
import KeyMetricsSection from "../../components/sales/KeyMetricsSection";
import SalesChartsSection from "../../components/sales/SalesChartsSection";
import OpenOrdersSection from "../../components/sales/OpenOrdersSection";
import InvoiceRegisterSection from "../../components/sales/InvoiceRegisterSection";
import OutstandingSection from "../../components/sales/OutstandingSection";
import LedgerSection from "../../components/sales/LedgerSection";
import AnalyticsSection from "../../components/sales/AnalyticsSection";
import SampleStatusSection from "../../components/sales/SampleStatusSection";
import {
  formatDate,
  useSalesOverview,
} from "../../components/sales/salesShared";
import {
  RefreshBar,
  SalesRefreshProvider,
} from "../../components/sales/salesRefresh";
import { SALES_REPORTS_PATH, salesReportPath } from "../../data/salesReports";

/**
 * Client-approved Sales Dashboard. Every section is the same component the
 * matching Sales → Reports page renders; its heading links to that report.
 */
export default function SalesOverview() {
  return (
    <SalesRefreshProvider>
      <Dashboard />
    </SalesRefreshProvider>
  );
}

function Dashboard() {
  const { data } = useSalesOverview();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-ink-primary">
            Sales Dashboard
          </h1>
          <p className="text-ink-secondary text-sm mt-0.5">
            Live from SAP Business One
            {data
              ? ` · ${data.fyLabel} (${formatDate(data.fyStart)} – ${formatDate(data.fyEnd)})`
              : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <RefreshBar />
          <div className="flex gap-2">
            <Link to={SALES_REPORTS_PATH} className="btn-secondary">
              All Reports
            </Link>
            <Link to="/sales/analytics" className="btn-secondary">
              Sales Analytics
            </Link>
          </div>
        </div>
      </div>

      <TurnoverSection />
      <KeyMetricsSection reportTo={salesReportPath("key-metrics")} />
      <SalesChartsSection reportTo={salesReportPath("sales-overview")} />
      <OpenOrdersSection reportTo={salesReportPath("open-sales-orders")} />
      <InvoiceRegisterSection reportTo={salesReportPath("invoice-register")} />
      <OutstandingSection reportTo={salesReportPath("customer-outstanding")} />
      <LedgerSection reportTo={salesReportPath("customer-ledger")} />
      <SampleStatusSection reportTo={salesReportPath("sample-status")} />
      <AnalyticsSection reportTo={salesReportPath("sales-analytics")} />
    </div>
  );
}
