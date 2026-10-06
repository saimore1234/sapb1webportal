/**
 * The client-approved Sales Dashboard is made of eight sections. Each one is a
 * standalone report under Sales → Reports; the dashboard renders the same
 * section components and links each heading to its report. Sample Status is
 * present but says plainly that SAP has no sample source yet — no placeholder
 * numbers anywhere.
 */
export interface SalesReportEntry {
  id: string;
  number: number;
  name: string;
  description: string;
  path: string;
  built: boolean;
}

export const SALES_REPORTS_PATH = '/sales/reports';

export const salesReports: SalesReportEntry[] = [
  { id: 'key-metrics', number: 1, name: 'Key Metrics', description: 'Customers, open orders, pending invoices and total outstanding.', path: `${SALES_REPORTS_PATH}/key-metrics`, built: true },
  { id: 'sales-overview', number: 2, name: 'Sales Overview', description: 'Monthly sales vs last year, sales person, customer-wise and item-wise sales.', path: `${SALES_REPORTS_PATH}/sales-overview`, built: true },
  { id: 'open-sales-orders', number: 3, name: 'Open Sales Orders', description: 'Open orders with production status, progress, ETA and delivery status.', path: `${SALES_REPORTS_PATH}/open-sales-orders`, built: true },
  { id: 'invoice-register', number: 4, name: 'Invoice Register', description: 'A/R invoices for a period with dispatch status, search and CSV export.', path: `${SALES_REPORTS_PATH}/invoice-register`, built: true },
  { id: 'customer-outstanding', number: 5, name: 'Customer Outstanding', description: 'Receivables, ageing buckets and customer-wise risk.', path: `${SALES_REPORTS_PATH}/customer-outstanding`, built: true },
  { id: 'customer-ledger', number: 6, name: 'Customer Ledger', description: 'Customer statement with running balance and credit utilisation.', path: `${SALES_REPORTS_PATH}/customer-ledger`, built: true },
  { id: 'sales-analytics', number: 7, name: 'Sales Analytics', description: 'Slice sales by customer, sales person, item and period.', path: `${SALES_REPORTS_PATH}/sales-analytics`, built: true },
  { id: 'sample-status', number: 8, name: 'Sample Status', description: 'Sample requests and their stage progress.', path: `${SALES_REPORTS_PATH}/sample-status`, built: true }
];

export const salesReportPath = (id: string) => salesReports.find((r) => r.id === id)!.path;
