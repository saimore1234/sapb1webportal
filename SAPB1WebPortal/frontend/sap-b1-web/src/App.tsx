import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Contact, Compass, Loader2 } from 'lucide-react';
import MainLayout from './layouts/MainLayout';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';

// Route-level code splitting: Login (the first thing every visitor loads,
// authenticated or not) stays eager and small; everything behind
// authentication loads on demand, so e.g. recharts (only used by Dashboard)
// never blocks the login screen from becoming interactive.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Customers = lazy(() => import('./pages/Customers'));
const CustomerDetail = lazy(() => import('./pages/CustomerDetail'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const SupplierDetail = lazy(() => import('./pages/SupplierDetail'));
const Items = lazy(() => import('./pages/Items'));
const ItemDetail = lazy(() => import('./pages/ItemDetail'));
const Inventory = lazy(() => import('./pages/Inventory'));
const ComingSoon = lazy(() => import('./pages/ComingSoon'));

// Purchase module — real, API-backed (see backend/SAPB1.Api/Controllers/PurchaseController.cs)
const PurchaseDashboard = lazy(() => import('./pages/purchase/PurchaseDashboard'));
const PurchaseRequests = lazy(() => import('./pages/purchase/PurchaseRequests'));
const CreatePurchaseRequest = lazy(() => import('./pages/purchase/CreatePurchaseRequest'));
const PurchaseRequestDetail = lazy(() => import('./pages/purchase/PurchaseRequestDetail'));
const PurchaseQuotations = lazy(() => import('./pages/purchase/PurchaseQuotations'));
const PurchaseQuotationDetail = lazy(() => import('./pages/purchase/PurchaseQuotationDetail'));
const PurchaseOrders = lazy(() => import('./pages/purchase/PurchaseOrders'));
const PurchaseOrderDetail = lazy(() => import('./pages/purchase/PurchaseOrderDetail'));
const Grpo = lazy(() => import('./pages/purchase/Grpo'));
const GrpoDetail = lazy(() => import('./pages/purchase/GrpoDetail'));
const ApInvoices = lazy(() => import('./pages/purchase/ApInvoices'));
const ApInvoiceDetail = lazy(() => import('./pages/purchase/ApInvoiceDetail'));
const ApCreditMemos = lazy(() => import('./pages/purchase/ApCreditMemos'));
const ApCreditMemoDetail = lazy(() => import('./pages/purchase/ApCreditMemoDetail'));
const OutgoingPayments = lazy(() => import('./pages/purchase/OutgoingPayments'));
const OutgoingPaymentDetail = lazy(() => import('./pages/purchase/OutgoingPaymentDetail'));
const PurchaseAnalytics = lazy(() => import('./pages/purchase/PurchaseAnalytics'));

// Sales module — real, API-backed (see backend/SAPB1.Api/Controllers/SalesController.cs)
const SalesDashboard = lazy(() => import('./pages/sales/SalesDashboard'));
const SalesOverview = lazy(() => import('./pages/sales/SalesOverview'));
const SalesReportsHub = lazy(() => import('./pages/sales/reports/SalesReports').then((m) => ({ default: m.SalesReportsHub })));
const SalesReportPage = lazy(() => import('./pages/sales/reports/SalesReports').then((m) => ({ default: m.SalesReportPage })));
const SalesQuotations = lazy(() => import('./pages/sales/SalesQuotations'));
const SalesQuotationDetail = lazy(() => import('./pages/sales/SalesQuotationDetail'));
const SalesOrders = lazy(() => import('./pages/sales/SalesOrders'));
const SalesOrderDetail = lazy(() => import('./pages/sales/SalesOrderDetail'));
const Deliveries = lazy(() => import('./pages/sales/Deliveries'));
const DeliveryDetail = lazy(() => import('./pages/sales/DeliveryDetail'));
const ArInvoices = lazy(() => import('./pages/sales/ArInvoices'));
const ArInvoiceDetail = lazy(() => import('./pages/sales/ArInvoiceDetail'));
const ArCreditMemos = lazy(() => import('./pages/sales/ArCreditMemos'));
const ArCreditMemoDetail = lazy(() => import('./pages/sales/ArCreditMemoDetail'));
const IncomingPayments = lazy(() => import('./pages/sales/IncomingPayments'));
const IncomingPaymentDetail = lazy(() => import('./pages/sales/IncomingPaymentDetail'));
const SalesAnalytics = lazy(() => import('./pages/sales/SalesAnalytics'));

// Production module — real, API-backed (see backend/SAPB1.Api/Controllers/ProductionController.cs)
const ProductionDashboard = lazy(() => import('./pages/production/ProductionDashboard'));
const Boms = lazy(() => import('./pages/production/Boms'));
const BomDetail = lazy(() => import('./pages/production/BomDetail'));
const ProductionOrders = lazy(() => import('./pages/production/ProductionOrders'));
const ProductionOrderDetail = lazy(() => import('./pages/production/ProductionOrderDetail'));
const MaterialRequirements = lazy(() => import('./pages/production/MaterialRequirements'));
const Consumption = lazy(() => import('./pages/production/Consumption'));
const Receipts = lazy(() => import('./pages/production/Receipts'));
const ProductionAnalytics = lazy(() => import('./pages/production/ProductionAnalytics'));

// Finance module — real, API-backed (see backend/SAPB1.Api/Controllers/FinanceController.cs)
const FinanceDashboard = lazy(() => import('./pages/finance/FinanceDashboard'));
const ChartOfAccounts = lazy(() => import('./pages/finance/ChartOfAccounts'));
const GeneralLedger = lazy(() => import('./pages/finance/GeneralLedger'));
const JournalEntries = lazy(() => import('./pages/finance/JournalEntries'));
const JournalEntryDetail = lazy(() => import('./pages/finance/JournalEntryDetail'));
const BpLedger = lazy(() => import('./pages/finance/BpLedger'));
const Receivables = lazy(() => import('./pages/finance/Receivables'));
const Payables = lazy(() => import('./pages/finance/Payables'));
const FinanceIncomingPayments = lazy(() => import('./pages/finance/IncomingPayments'));
const FinanceOutgoingPayments = lazy(() => import('./pages/finance/OutgoingPayments'));
const BankCash = lazy(() => import('./pages/finance/BankCash'));
const TrialBalance = lazy(() => import('./pages/finance/TrialBalance'));
const ProfitLoss = lazy(() => import('./pages/finance/ProfitLoss'));
const BalanceSheet = lazy(() => import('./pages/finance/BalanceSheet'));
const Tax = lazy(() => import('./pages/finance/Tax'));
const FinanceAnalytics = lazy(() => import('./pages/finance/FinanceAnalytics'));

// Reports Center — real, API-backed (see backend/SAPB1.Api/Controllers/ReportsController.cs
// and src/data/reportCatalog.ts, which reuses the Sales/Purchase/Production/Finance/Inventory APIs above)
const ReportsCenter = lazy(() => import('./pages/reports/ReportsCenter'));
const ReportCategoryPage = lazy(() => import('./pages/reports/ReportCategoryPage'));
const ReportPage = lazy(() => import('./pages/reports/ReportPage'));
const ManagementSummaryReport = lazy(() => import('./pages/reports/ManagementSummary'));

// Administration (RBAC) — real, API-backed (see backend/SAPB1.Api/Controllers/Admin/*)
const AdminUsers = lazy(() => import('./pages/administration/Users'));
const AdminRoles = lazy(() => import('./pages/administration/Roles'));
const AdminPermissions = lazy(() => import('./pages/administration/Permissions'));
const AdminServerConfiguration = lazy(() => import('./pages/administration/ServerConfiguration'));

function RouteFallback() {
  return (
    <div className="flex items-center justify-center py-24 text-ink-secondary text-sm">
      <Loader2 className="h-4 w-4 animate-spin mr-2 text-brand-600 dark:text-brand-400" />
      Loading…
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          {/* Shell-style aliases — existing routes above/below keep working unchanged. */}
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="business-partners/customers" element={<Customers />} />
          <Route path="business-partners/customers/:cardCode" element={<CustomerDetail />} />
          <Route path="business-partners/suppliers" element={<Suppliers />} />
          <Route path="business-partners/suppliers/:cardCode" element={<SupplierDetail />} />
          <Route path="inventory/items" element={<Items />} />
          <Route path="inventory/items/:itemCode" element={<ItemDetail />} />
          <Route path="inventory/stock" element={<Inventory />} />
          <Route path="finance/accounts" element={<ChartOfAccounts />} />
          <Route path="customers" element={<Customers />} />
          <Route path="customers/:cardCode" element={<CustomerDetail />} />
          <Route path="suppliers" element={<Suppliers />} />
          <Route path="suppliers/:cardCode" element={<SupplierDetail />} />
          <Route path="items" element={<Items />} />
          <Route path="items/:itemCode" element={<ItemDetail />} />
          <Route path="inventory" element={<Inventory />} />

          {/* Purchase — real SAP B1 data via GET /api/purchase/* */}
          <Route path="purchase" element={<PurchaseDashboard />} />
          <Route path="purchase/requests" element={<PurchaseRequests />} />
          <Route
            path="purchase/requests/new"
            element={
              <ProtectedRoute requiredAction="Create">
                <CreatePurchaseRequest />
              </ProtectedRoute>
            }
          />
          <Route path="purchase/requests/:docEntry" element={<PurchaseRequestDetail />} />
          <Route path="purchase/quotations" element={<PurchaseQuotations />} />
          <Route path="purchase/quotations/:docEntry" element={<PurchaseQuotationDetail />} />
          <Route path="purchase/orders" element={<PurchaseOrders />} />
          <Route path="purchase/orders/:docEntry" element={<PurchaseOrderDetail />} />
          <Route path="purchase/grpo" element={<Grpo />} />
          <Route path="purchase/grpo/:docEntry" element={<GrpoDetail />} />
          <Route path="purchase/invoices" element={<ApInvoices />} />
          <Route path="purchase/invoices/:docEntry" element={<ApInvoiceDetail />} />
          <Route path="purchase/credit-memos" element={<ApCreditMemos />} />
          <Route path="purchase/credit-memos/:docEntry" element={<ApCreditMemoDetail />} />
          <Route path="purchase/payments" element={<OutgoingPayments />} />
          <Route path="purchase/payments/:docEntry" element={<OutgoingPaymentDetail />} />
          <Route path="purchase/analytics" element={<PurchaseAnalytics />} />

          {/* Sales — real SAP B1 data via GET /api/sales/* */}
          <Route path="sales" element={<SalesDashboard />} />
          <Route path="sales/overview" element={<SalesOverview />} />
          <Route path="sales/reports" element={<SalesReportsHub />} />
          <Route path="sales/reports/:reportId" element={<SalesReportPage />} />
          <Route path="sales/quotations" element={<SalesQuotations />} />
          <Route path="sales/quotations/:docEntry" element={<SalesQuotationDetail />} />
          <Route path="sales/orders" element={<SalesOrders />} />
          <Route path="sales/orders/:docEntry" element={<SalesOrderDetail />} />
          <Route path="sales/deliveries" element={<Deliveries />} />
          <Route path="sales/deliveries/:docEntry" element={<DeliveryDetail />} />
          <Route path="sales/invoices" element={<ArInvoices />} />
          <Route path="sales/invoices/:docEntry" element={<ArInvoiceDetail />} />
          <Route path="sales/credit-memos" element={<ArCreditMemos />} />
          <Route path="sales/credit-memos/:docEntry" element={<ArCreditMemoDetail />} />
          <Route path="sales/payments" element={<IncomingPayments />} />
          <Route path="sales/payments/:docEntry" element={<IncomingPaymentDetail />} />
          <Route path="sales/analytics" element={<SalesAnalytics />} />

          {/* Production — real SAP B1 data via GET /api/production/* */}
          <Route path="production" element={<ProductionDashboard />} />
          <Route path="production/boms" element={<Boms />} />
          <Route path="production/boms/:code" element={<BomDetail />} />
          <Route path="production/orders" element={<ProductionOrders />} />
          <Route path="production/orders/:docEntry" element={<ProductionOrderDetail />} />
          <Route path="production/material-requirements" element={<MaterialRequirements />} />
          <Route path="production/consumption" element={<Consumption />} />
          <Route path="production/receipts" element={<Receipts />} />
          <Route path="production/analytics" element={<ProductionAnalytics />} />

          {/* Finance — real SAP B1 data via GET /api/finance/* */}
          <Route path="finance" element={<FinanceDashboard />} />
          <Route path="finance/chart-of-accounts" element={<ChartOfAccounts />} />
          <Route path="finance/ledger" element={<GeneralLedger />} />
          <Route path="finance/journal-entries" element={<JournalEntries />} />
          <Route path="finance/journal-entries/:transId" element={<JournalEntryDetail />} />
          <Route path="finance/bp-ledger" element={<BpLedger />} />
          <Route path="finance/receivables" element={<Receivables />} />
          <Route path="finance/payables" element={<Payables />} />
          <Route path="finance/incoming-payments" element={<FinanceIncomingPayments />} />
          <Route path="finance/outgoing-payments" element={<FinanceOutgoingPayments />} />
          <Route path="finance/bank-cash" element={<BankCash />} />
          <Route path="finance/trial-balance" element={<TrialBalance />} />
          <Route path="finance/profit-loss" element={<ProfitLoss />} />
          <Route path="finance/balance-sheet" element={<BalanceSheet />} />
          <Route path="finance/tax" element={<Tax />} />
          <Route path="finance/analytics" element={<FinanceAnalytics />} />

          {/* Modules requested in the design brief that have no backend API yet
              (see README "Roadmap") — shown honestly, never with fake data. */}
          <Route
            path="crm"
            element={
              <ComingSoon
                title="CRM"
                icon={Contact}
                description="Leads, opportunity pipeline, activities and follow-ups."
                requiredApis={['GET /api/crm/opportunities', 'GET /api/crm/activities']}
              />
            }
          />
          {/* Reports Center — real SAP B1 data, reusing the Sales/Purchase/
              Production/Finance/Inventory APIs above via src/data/reportCatalog.ts,
              plus the small set of genuinely new GET /api/reports/* endpoints. */}
          <Route path="reports" element={<ReportsCenter />} />
          <Route path="reports/management/summary" element={<ManagementSummaryReport />} />
          <Route path="reports/:categoryId" element={<ReportCategoryPage />} />
          <Route path="reports/:categoryId/:reportId" element={<ReportPage />} />

          {/* Administration — RBAC: Users / Roles / Permissions. Each route also
              requires Administration.View; the menu item itself is hidden without it. */}
          <Route
            path="administration"
            element={
              <ProtectedRoute>
                <Navigate to="/administration/users" replace />
              </ProtectedRoute>
            }
          />
          <Route
            path="administration/users"
            element={
              <ProtectedRoute>
                <AdminUsers />
              </ProtectedRoute>
            }
          />
          <Route
            path="administration/roles"
            element={
              <ProtectedRoute>
                <AdminRoles />
              </ProtectedRoute>
            }
          />
          <Route
            path="administration/permissions"
            element={
              <ProtectedRoute>
                <AdminPermissions />
              </ProtectedRoute>
            }
          />
          <Route
            path="administration/server-configuration"
            element={
              <ProtectedRoute>
                <AdminServerConfiguration />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center px-4">
      <div className="h-12 w-12 rounded-2xl bg-surface-tertiary text-ink-tertiary flex items-center justify-center mb-4">
        <Compass className="h-5 w-5" />
      </div>
      <h1 className="text-xl font-semibold text-ink-primary mb-1.5">Page not found</h1>
      <p className="text-ink-secondary text-sm">The page you're looking for doesn't exist.</p>
    </div>
  );
}
