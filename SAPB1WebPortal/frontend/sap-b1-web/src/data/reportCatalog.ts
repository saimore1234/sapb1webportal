import type { LucideIcon } from 'lucide-react';
import {
  ShoppingCart, ShoppingBag, Warehouse, Factory, Wallet, Users, Receipt, Package,
  BarChart3, Activity
} from 'lucide-react';
import type { ReportDataSourceKey } from './reportDataSources';
import { salesReports } from './salesReports';

export type ReportCategoryId =
  | 'sales' | 'purchase' | 'inventory' | 'production' | 'finance'
  | 'business-partners' | 'tax' | 'warehouse' | 'items' | 'management' | 'operational';

export interface ReportCategory {
  id: ReportCategoryId;
  label: string;
  icon: LucideIcon;
  description: string;
}

export const reportCategories: ReportCategory[] = [
  { id: 'sales', label: 'Sales', icon: ShoppingCart, description: 'Orders, invoices, deliveries and customer performance' },
  { id: 'purchase', label: 'Purchase', icon: ShoppingBag, description: 'Vendors, purchase orders, GRPO and A/P invoices' },
  { id: 'inventory', label: 'Inventory', icon: Warehouse, description: 'Stock levels, valuation, ageing and movement' },
  { id: 'production', label: 'Production', icon: Factory, description: 'Production orders, BOM and material consumption' },
  { id: 'finance', label: 'Finance', icon: Wallet, description: 'Ledger, journal entries and financial statements' },
  { id: 'business-partners', label: 'Business Partners', icon: Users, description: 'Customer and vendor master data and history' },
  { id: 'tax', label: 'Tax / GST', icon: Receipt, description: 'Output/input tax and tax code breakdowns' },
  { id: 'warehouse', label: 'Warehouse', icon: Warehouse, description: 'Warehouse-level stock, movement and comparisons' },
  { id: 'items', label: 'Items', icon: Package, description: 'Item master, pricing, movement and valuation' },
  { id: 'management', label: 'Management', icon: BarChart3, description: 'Executive KPIs across every module' },
  { id: 'operational', label: 'Operations', icon: Activity, description: 'Open, pending and overdue documents' }
];

/**
 * A report is either:
 *  - "link": deep-links to an already-built, real page elsewhere in this
 *    portal (Sales Orders, Receivables, Chart of Accounts, ...). No new code
 *    behind it — it IS the real module page.
 *  - "table": rendered by the generic ReportViewer against a real
 *    ReportDataSource (src/data/reportDataSources.tsx), which itself wraps
 *    an existing Sales/Purchase/Production/Finance Analytics endpoint or one
 *    of the three new Reports endpoints.
 *  - "unavailable": named in the brief but this SAP B1 installation has no
 *    corresponding real data to show (batch/serial tracking, e-invoice/e-way
 *    bill, approval workflows — none configured here) or the underlying
 *    data source is empty in every company this project has access to
 *    (documented honestly rather than shown with fabricated numbers).
 */
export interface ReportDefinition {
  id: string;
  name: string;
  category: ReportCategoryId;
  description: string;
  tags: string[];
  kind: 'link' | 'table' | 'unavailable';
  route?: string;
  dataSource?: ReportDataSourceKey;
  unavailableReason?: string;
}

function link(id: string, name: string, category: ReportCategoryId, description: string, route: string, tags: string[] = []): ReportDefinition {
  return { id, name, category, description, tags, kind: 'link', route };
}
function table(id: string, name: string, category: ReportCategoryId, description: string, dataSource: ReportDataSourceKey, tags: string[] = []): ReportDefinition {
  return { id, name, category, description, tags, kind: 'table', dataSource };
}
function unavailable(id: string, name: string, category: ReportCategoryId, description: string, reason: string, tags: string[] = []): ReportDefinition {
  return { id, name, category, description, tags, kind: 'unavailable', unavailableReason: reason };
}

const NO_TRACKING = 'This SAP B1 installation does not use batch/serial tracking on any configured company — there is no real data to report on.';
const NO_EINVOICE = 'No e-Invoice/e-Way Bill data is present in this installation\'s configured companies.';
const NO_APPROVALS = 'This installation has no SAP B1 approval workflow configured — there are no pending approvals to report on.';

export const reportCatalog: ReportDefinition[] = [
  // ------------------------------------------------------------- SALES
  // Sales Dashboard sections, as full reports (see data/salesReports.ts).
  ...salesReports
    .filter((r) => r.built)
    .map((r) => link(`sales-dashboard-${r.id}`, r.name, 'sales', r.description, r.path, ['dashboard'])),
  table('sales-summary', 'Sales Summary', 'sales', 'Monthly sales value trend from real A/R invoices.', 'salesByMonth', ['revenue', 'summary']),
  table('sales-by-customer', 'Sales by Customer', 'sales', 'Top customers by invoiced revenue.', 'salesByCustomer', ['customer']),
  table('sales-by-item', 'Sales by Item', 'sales', 'Top-selling items by sales value and quantity.', 'salesByItem', ['item']),
  link('sales-by-item-group', 'Sales by Item Group', 'sales', 'Browse sold items grouped by item group.', '/items', ['item', 'group']),
  table('sales-by-employee', 'Sales by Sales Employee', 'sales', 'Revenue attributed to each sales employee.', 'salesByEmployee', ['employee']),
  table('sales-by-warehouse', 'Sales by Warehouse', 'sales', 'Sales value shipped from each warehouse.', 'salesByWarehouse', ['warehouse']),
  table('sales-by-month', 'Sales by Month', 'sales', 'Sales value trend over the last 12 months.', 'salesByMonth', ['trend', 'month']),
  link('sales-by-customer-group', 'Sales by Customer Group', 'sales', 'Browse customers grouped by customer group.', '/customers', ['customer', 'group']),
  link('sales-order-status', 'Sales Order Status', 'sales', 'All sales orders with live status.', '/sales/orders', ['order', 'status']),
  link('open-sales-orders', 'Open Sales Orders', 'sales', 'Sales orders not yet fully delivered.', '/sales/orders', ['order', 'open']),
  link('sales-order-pending-delivery', 'Sales Order Pending Delivery', 'sales', 'Open sales orders awaiting delivery.', '/sales/orders', ['order', 'delivery', 'pending']),
  link('delivery-status', 'Delivery Status', 'sales', 'All deliveries with live status.', '/sales/deliveries', ['delivery']),
  link('open-deliveries', 'Open Deliveries', 'sales', 'Deliveries not yet fully invoiced.', '/sales/deliveries', ['delivery', 'open']),
  link('ar-invoice-summary', 'A/R Invoice Summary', 'sales', 'All A/R invoices with totals and balances.', '/sales/invoices', ['invoice', 'ar']),
  link('ar-invoice-outstanding', 'A/R Invoice Outstanding', 'sales', 'A/R invoices with an unpaid balance.', '/finance/receivables', ['invoice', 'outstanding']),
  link('sales-credit-memo', 'Sales Return / Credit Memo Report', 'sales', 'All A/R credit memos.', '/sales/credit-memos', ['return', 'credit memo']),
  link('customer-sales-history', 'Customer Sales History', 'sales', 'Full invoice history per customer.', '/customers', ['customer', 'history']),
  table('top-selling-items-sales', 'Top Selling Items', 'sales', 'Best-selling items by sales value.', 'salesByItem', ['top', 'item']),
  table('top-customers', 'Top Customers', 'sales', 'Highest-revenue customers.', 'salesByCustomer', ['top', 'customer']),
  unavailable('sales-margin', 'Sales Margin Report', 'sales', 'Gross margin per sales invoice line.', 'No verified per-line cost/COGS field is linked to sales invoice lines in this installation — showing a margin figure without it would be a guess, not real data.', ['margin', 'profit']),
  link('quotation-analysis', 'Quotation Analysis', 'sales', 'All sales quotations.', '/sales/quotations', ['quotation']),
  link('quotation-to-order', 'Quotation to Order Conversion', 'sales', 'Open the sales document flow from any quotation to see if/how it converted to an order.', '/sales/quotations', ['conversion', 'flow']),
  link('order-to-delivery', 'Order to Delivery Analysis', 'sales', 'Open a sales order to see its real delivery document flow.', '/sales/orders', ['flow']),
  link('delivery-to-invoice', 'Delivery to Invoice Analysis', 'sales', 'Open a delivery to see its real invoice document flow.', '/sales/deliveries', ['flow']),
  link('sales-document-flow', 'Sales Document Flow', 'sales', 'Quotation → Order → Delivery → Invoice → Payment, from real SAP B1 document links.', '/sales/orders', ['flow', 'chain']),

  // ------------------------------------------------------------ PURCHASE
  table('purchase-summary', 'Purchase Summary', 'purchase', 'Monthly purchase value trend from real A/P invoices.', 'purchaseByMonth', ['summary']),
  table('purchase-by-vendor', 'Purchase by Vendor', 'purchase', 'Top vendors by purchase value.', 'purchaseByVendor', ['vendor']),
  table('purchase-by-item', 'Purchase by Item', 'purchase', 'Top purchased items by value and quantity.', 'purchaseByItem', ['item']),
  link('purchase-by-item-group', 'Purchase by Item Group', 'purchase', 'Browse purchased items grouped by item group.', '/items', ['item', 'group']),
  table('purchase-by-warehouse', 'Purchase by Warehouse', 'purchase', 'Purchase value received into each warehouse.', 'purchaseByWarehouse', ['warehouse']),
  table('purchase-by-month', 'Purchase by Month', 'purchase', 'Purchase value trend over the last 12 months.', 'purchaseByMonth', ['trend', 'month']),
  link('purchase-order-status', 'Purchase Order Status', 'purchase', 'All purchase orders with live status.', '/purchase/orders', ['order', 'status']),
  link('open-purchase-orders', 'Open Purchase Orders', 'purchase', 'Purchase orders not yet fully received.', '/purchase/orders', ['order', 'open']),
  link('pending-grpo', 'Pending GRPO', 'purchase', 'Purchase orders awaiting goods receipt.', '/purchase/orders', ['grpo', 'pending']),
  link('grpo-summary', 'GRPO Summary', 'purchase', 'All goods receipts.', '/purchase/grpo', ['grpo']),
  link('ap-invoice-summary', 'A/P Invoice Summary', 'purchase', 'All A/P invoices with totals and balances.', '/purchase/invoices', ['invoice', 'ap']),
  link('outstanding-ap', 'Outstanding A/P', 'purchase', 'A/P invoices with an unpaid balance.', '/finance/payables', ['outstanding']),
  link('purchase-return', 'Purchase Return Report', 'purchase', 'All A/P credit memos.', '/purchase/credit-memos', ['return', 'credit memo']),
  link('vendor-purchase-history', 'Vendor Purchase History', 'purchase', 'Full purchase history per vendor.', '/suppliers', ['vendor', 'history']),
  table('top-vendors', 'Top Vendors', 'purchase', 'Highest-spend vendors.', 'purchaseByVendor', ['top', 'vendor']),
  unavailable('purchase-price-analysis', 'Purchase Price Analysis', 'purchase', 'Price variance for the same item across purchase orders.', 'No purchase price history table is populated in this installation to compare against — the module only exposes each order\'s own line price, not a trend.', ['price']),
  link('po-pending-receipt', 'Purchase Order Pending Receipt', 'purchase', 'Open purchase orders awaiting goods receipt.', '/purchase/orders', ['pending', 'receipt']),
  link('grpo-to-invoice', 'GRPO to Invoice Analysis', 'purchase', 'Open a GRPO to see its real A/P invoice document flow.', '/purchase/grpo', ['flow']),
  link('purchase-document-flow', 'Purchase Document Flow', 'purchase', 'Request → Quotation → Order → GRPO → Invoice → Payment, from real SAP B1 document links.', '/purchase/orders', ['flow', 'chain']),
  unavailable('purchase-variance', 'Purchase Variance Report', 'purchase', 'Ordered vs. received vs. invoiced quantity/price variance.', 'This requires cross-referencing PO/GRPO/Invoice quantities and prices per line, which this installation has essentially zero real multi-stage purchase flows to validate against (most POs here have no linked GRPO/Invoice yet).', ['variance']),

  // ----------------------------------------------------------- INVENTORY
  table('stock-summary', 'Stock Summary', 'inventory', 'Real-time on-hand, committed and available stock per item/warehouse.', 'stockSummary', ['stock']),
  link('stock-by-warehouse', 'Stock by Warehouse', 'inventory', 'Stock levels filtered by warehouse.', '/inventory', ['stock', 'warehouse']),
  link('stock-by-item', 'Stock by Item', 'inventory', 'Stock levels filtered by item.', '/inventory', ['stock', 'item']),
  link('stock-by-item-group', 'Stock by Item Group', 'inventory', 'Browse stock grouped by item group.', '/items', ['stock', 'group']),
  table('stock-valuation', 'Stock Valuation', 'inventory', 'On-hand quantity valued at average price.', 'stockSummary', ['valuation']),
  table('stock-ageing', 'Stock Ageing', 'inventory', 'Days since each item/warehouse last received stock, bucketed.', 'stockAgeing', ['ageing']),
  table('inventory-audit', 'Inventory Audit', 'inventory', 'Full stock position for reconciliation against a physical count.', 'stockSummary', ['audit']),
  table('inventory-movement', 'Inventory Movement', 'inventory', 'Real inbound/outbound stock transactions.', 'inventoryMovement', ['movement']),
  table('stock-ledger', 'Stock Ledger', 'inventory', 'Chronological stock transaction ledger.', 'inventoryMovement', ['ledger']),
  unavailable('stock-transfer', 'Stock Transfer Report', 'inventory', 'Warehouse-to-warehouse stock transfers.', 'No stock transfer documents (OWTR) exist in any company configured in this environment.', ['transfer']),
  link('goods-receipt-report', 'Goods Receipt Report', 'inventory', 'All goods receipts (GRPO).', '/purchase/grpo', ['receipt']),
  link('goods-issue-report', 'Goods Issue Report', 'inventory', 'All deliveries (goods issued to customers).', '/sales/deliveries', ['issue']),
  table('inventory-reconciliation', 'Inventory Reconciliation', 'inventory', 'Compare on-hand stock against real movement history.', 'inventoryMovement', ['reconciliation']),
  table('negative-stock', 'Negative Stock Report', 'inventory', 'Items with negative on-hand or available quantity.', 'negativeStock', ['negative']),
  table('zero-stock', 'Zero Stock Report', 'inventory', 'Items with zero on-hand quantity.', 'zeroStock', ['zero']),
  table('slow-moving-items', 'Slow Moving Items', 'inventory', 'Items whose stock has aged past 90 days since last receipt.', 'stockAgeing', ['slow moving']),
  table('non-moving-items', 'Non Moving Items', 'inventory', 'Items with on-hand stock and no movement history at all.', 'stockAgeing', ['non moving']),
  table('fast-moving-items', 'Fast Moving Items', 'inventory', 'Items whose stock has moved within the last 30 days.', 'stockAgeing', ['fast moving']),
  table('stock-below-min', 'Stock Below Minimum Level', 'inventory', 'Items flagged Low Stock against their configured minimum.', 'lowStock', ['minimum', 'reorder']),
  link('stock-above-max', 'Stock Above Maximum Level', 'inventory', 'Browse stock and compare against each item\'s maximum level.', '/inventory', ['maximum']),
  link('committed-stock', 'Committed Stock', 'inventory', 'Stock committed to open sales orders.', '/inventory', ['committed']),
  link('available-stock', 'Available Stock', 'inventory', 'On-hand minus committed, per item/warehouse.', '/inventory', ['available']),
  unavailable('batch-stock', 'Batch Stock Report', 'inventory', 'On-hand quantity by batch number.', NO_TRACKING, ['batch']),
  unavailable('serial-stock', 'Serial Number Stock Report', 'inventory', 'On-hand quantity by serial number.', NO_TRACKING, ['serial']),
  link('warehouse-comparison-inv', 'Warehouse Comparison', 'inventory', 'Compare stock levels side-by-side across warehouses.', '/inventory', ['warehouse', 'compare']),
  link('item-warehouse-matrix', 'Item Warehouse Matrix', 'inventory', 'Every item\'s stock across every warehouse.', '/inventory', ['matrix']),

  // ---------------------------------------------------------- PRODUCTION
  link('production-order-summary', 'Production Order Summary', 'production', 'All production orders with planned/produced quantities.', '/production/orders', ['summary']),
  link('open-production-orders', 'Open Production Orders', 'production', 'Production orders still Planned or Released.', '/production/orders', ['open']),
  table('production-order-status', 'Production Order Status', 'production', 'Production order count by real SAP B1 status.', 'productionByStatus', ['status']),
  table('planned-vs-produced', 'Planned vs Produced', 'production', 'Planned vs. actually produced quantity by month.', 'productionByMonth', ['planned', 'produced']),
  table('production-by-item', 'Production by Item', 'production', 'Top finished goods by produced quantity.', 'topProducedItems', ['item']),
  table('production-by-warehouse', 'Production by Warehouse', 'production', 'Production orders and output by warehouse.', 'productionByWarehouse', ['warehouse']),
  table('production-by-month', 'Production by Month', 'production', 'Production order count and quantity trend.', 'productionByMonth', ['trend', 'month']),
  link('bom-summary', 'BOM Summary', 'production', 'All bills of materials.', '/production/boms', ['bom']),
  link('bom-component-report', 'BOM Component Report', 'production', 'Open a BOM to see its real component list.', '/production/boms', ['bom', 'component']),
  link('material-requirement-report', 'Material Requirement Report', 'production', 'Components required by open production orders, with live availability.', '/production/material-requirements', ['material']),
  link('material-consumption', 'Material Consumption', 'production', 'Planned vs. issued quantity per component.', '/production/consumption', ['consumption']),
  link('component-variance', 'Component Variance', 'production', 'Issued minus planned quantity per component.', '/production/consumption', ['variance']),
  link('production-receipt-report', 'Production Receipt Report', 'production', 'Real finished-goods receipts from production.', '/production/receipts', ['receipt']),
  table('finished-goods-produced', 'Finished Goods Produced', 'production', 'Finished goods by total produced quantity.', 'topProducedItems', ['finished goods']),
  table('raw-material-consumption', 'Raw Material Consumption', 'production', 'Raw materials by total issued quantity.', 'topConsumedMaterials', ['raw material']),
  link('production-completion', 'Production Completion Report', 'production', 'Production orders with their completion percentage.', '/production/orders', ['completion']),
  link('production-order-ageing', 'Production Order Ageing', 'production', 'Open a production order to see how long it has been open.', '/production/orders', ['ageing']),
  unavailable('production-efficiency', 'Production Efficiency', 'production', 'Actual vs. standard production time per order.', 'No standard/expected production time is configured on any BOM or routing in this installation to compare actual time against.', ['efficiency']),
  unavailable('yield-report', 'Yield Report', 'production', 'Output quantity vs. input material quantity ratio.', 'This installation\'s production orders have zero recorded component issues to compute a real input/output yield ratio from.', ['yield']),
  unavailable('production-cost-analysis', 'Production Cost Analysis', 'production', 'Standard vs. actual cost per production order.', 'No item cost/standard-cost data is linked to production orders in this installation.', ['cost']),

  // -------------------------------------------------------------- FINANCE
  link('general-ledger-report', 'General Ledger', 'finance', 'Every G/L posting, with running balance.', '/finance/ledger', ['ledger', 'gl']),
  link('journal-entry-report', 'Journal Entry Report', 'finance', 'All journal entries with debit/credit totals.', '/finance/journal-entries', ['journal']),
  link('trial-balance-report', 'Trial Balance', 'finance', 'Opening, period and closing debit/credit per account.', '/finance/trial-balance', ['trial balance']),
  link('balance-sheet-report', 'Balance Sheet', 'finance', 'Assets, liabilities and equity as of a date.', '/finance/balance-sheet', ['balance sheet']),
  link('profit-loss-report', 'Profit & Loss', 'finance', 'Revenue, COGS, expenses and net profit for a period.', '/finance/profit-loss', ['p&l', 'profit']),
  table('cash-flow-report', 'Cash Flow', 'finance', 'Incoming minus outgoing payments by month.', 'financeCashFlow', ['cash flow']),
  link('accounts-receivable-report', 'Accounts Receivable', 'finance', 'All open A/R invoices with ageing.', '/finance/receivables', ['ar']),
  link('accounts-payable-report', 'Accounts Payable', 'finance', 'All open A/P invoices with ageing.', '/finance/payables', ['ap']),
  link('ar-ageing-report', 'A/R Ageing', 'finance', 'Receivables bucketed by days overdue.', '/finance/receivables', ['ageing']),
  link('ap-ageing-report', 'A/P Ageing', 'finance', 'Payables bucketed by days overdue.', '/finance/payables', ['ageing']),
  link('customer-ledger', 'Customer Ledger', 'finance', 'G/L activity per customer.', '/finance/bp-ledger', ['customer', 'ledger']),
  link('vendor-ledger', 'Vendor Ledger', 'finance', 'G/L activity per vendor.', '/finance/bp-ledger', ['vendor', 'ledger']),
  link('bank-book', 'Bank Book', 'finance', 'Real bank account balances from the chart of accounts.', '/finance/bank-cash', ['bank']),
  link('cash-book', 'Cash Book', 'finance', 'Real cash account balances from the chart of accounts.', '/finance/bank-cash', ['cash']),
  link('incoming-payments-report', 'Incoming Payments', 'finance', 'All customer payments received.', '/finance/incoming-payments', ['payment']),
  link('outgoing-payments-report', 'Outgoing Payments', 'finance', 'All vendor payments made.', '/finance/outgoing-payments', ['payment']),
  table('expense-analysis', 'Expense Analysis', 'finance', 'Top expense accounts by net activity.', 'financeTopExpenseAccounts', ['expense']),
  table('revenue-analysis', 'Revenue Analysis', 'finance', 'Revenue trend by month.', 'financeRevenueTrend', ['revenue']),
  link('account-balance-report', 'Account Balance Report', 'finance', 'Every G/L account with its current balance.', '/finance/chart-of-accounts', ['balance']),
  link('financial-summary', 'Financial Summary', 'finance', 'Live financial KPIs.', '/finance', ['summary']),

  // --------------------------------------------------- BUSINESS PARTNERS
  link('customer-master', 'Customer Master Report', 'business-partners', 'Full customer list.', '/customers', ['customer', 'master']),
  link('vendor-master', 'Vendor Master Report', 'business-partners', 'Full vendor list.', '/suppliers', ['vendor', 'master']),
  link('customer-outstanding', 'Customer Outstanding', 'business-partners', 'Open A/R balance per customer.', '/finance/receivables', ['customer', 'outstanding']),
  link('vendor-outstanding', 'Vendor Outstanding', 'business-partners', 'Open A/P balance per vendor.', '/finance/payables', ['vendor', 'outstanding']),
  link('customer-ageing-bp', 'Customer Ageing', 'business-partners', 'Customer receivables bucketed by days overdue.', '/finance/receivables', ['ageing']),
  link('vendor-ageing-bp', 'Vendor Ageing', 'business-partners', 'Vendor payables bucketed by days overdue.', '/finance/payables', ['ageing']),
  table('customer-sales-bp', 'Customer Sales', 'business-partners', 'Revenue per customer.', 'salesByCustomer', ['customer', 'sales']),
  table('vendor-purchase-bp', 'Vendor Purchase', 'business-partners', 'Purchase value per vendor.', 'purchaseByVendor', ['vendor', 'purchase']),
  link('customer-payment-history', 'Customer Payment History', 'business-partners', 'All incoming payments per customer.', '/finance/incoming-payments', ['payment', 'history']),
  link('vendor-payment-history', 'Vendor Payment History', 'business-partners', 'All outgoing payments per vendor.', '/finance/outgoing-payments', ['payment', 'history']),
  link('customer-transaction-history', 'Customer Transaction History', 'business-partners', 'Full G/L transaction history per customer.', '/finance/bp-ledger', ['customer', 'transaction']),
  link('vendor-transaction-history', 'Vendor Transaction History', 'business-partners', 'Full G/L transaction history per vendor.', '/finance/bp-ledger', ['vendor', 'transaction']),
  link('customer-credit-limit', 'Customer Credit Limit', 'business-partners', 'Configured credit limit per customer.', '/customers', ['credit limit']),
  link('customer-credit-utilization', 'Customer Credit Utilization', 'business-partners', 'Current balance vs. credit limit per customer.', '/customers', ['credit']),
  link('vendor-balance', 'Vendor Balance', 'business-partners', 'Current balance per vendor.', '/suppliers', ['balance']),
  link('inactive-partners', 'Inactive Business Partners', 'business-partners', 'Customers/vendors flagged inactive.', '/customers', ['inactive']),

  // ------------------------------------------------------------- TAX/GST
  link('gst-summary', 'GST Summary', 'tax', 'Output tax, input tax and net tax position.', '/finance/tax', ['gst', 'summary']),
  link('output-tax', 'Output Tax', 'tax', 'Tax collected on sales.', '/finance/tax', ['output']),
  link('input-tax', 'Input Tax', 'tax', 'Tax paid on purchases.', '/finance/tax', ['input']),
  table('tax-code-summary', 'Tax Code Summary', 'tax', 'Sales tax activity broken down by tax code.', 'salesTaxByCode', ['tax code']),
  table('tax-rate-summary', 'Tax Rate Summary', 'tax', 'Tax codes with their configured rate, where the tax group master has one.', 'salesTaxByCode', ['rate']),
  table('sales-tax-report', 'Sales Tax Report', 'tax', 'Output tax by tax code, from real A/R invoice lines.', 'salesTaxByCode', ['sales tax']),
  table('purchase-tax-report', 'Purchase Tax Report', 'tax', 'Input tax by tax code, from real A/P invoice lines.', 'purchaseTaxByCode', ['purchase tax']),
  link('taxable-sales', 'Taxable Sales', 'tax', 'Total taxable sales amount for a period.', '/finance/tax', ['taxable']),
  link('taxable-purchases', 'Taxable Purchases', 'tax', 'Total taxable purchase amount for a period.', '/finance/tax', ['taxable']),
  link('credit-memo-tax', 'Credit Memo Tax', 'tax', 'Browse A/R credit memos for their tax impact.', '/sales/credit-memos', ['credit memo']),
  table('tax-by-month', 'Tax by Month', 'tax', 'Output vs. input tax trend by month.', 'taxByMonth', ['trend']),
  link('gst-reconciliation', 'GST Reconciliation', 'tax', 'Compare output/input tax against the general ledger tax accounts.', '/finance/tax', ['reconciliation']),
  unavailable('e-invoice-report', 'E-Invoice Report', 'tax', 'IRN/e-Invoice status per A/R invoice.', NO_EINVOICE, ['e-invoice']),
  unavailable('e-way-bill-report', 'E-Way Bill Report', 'tax', 'E-Way Bill number/status per delivery.', NO_EINVOICE, ['e-way bill']),

  // -------------------------------------------------------------- WAREHOUSE
  link('warehouse-stock', 'Warehouse Stock', 'warehouse', 'Stock levels per warehouse.', '/inventory', ['stock']),
  table('warehouse-stock-value', 'Warehouse Stock Value', 'warehouse', 'Stock summary with valuation, filterable by warehouse.', 'stockSummary', ['value']),
  table('warehouse-movement', 'Warehouse Movement', 'warehouse', 'Real inbound/outbound stock transactions.', 'inventoryMovement', ['movement']),
  unavailable('warehouse-transfer', 'Warehouse Transfer', 'warehouse', 'Warehouse-to-warehouse stock transfers.', 'No stock transfer documents (OWTR) exist in any company configured in this environment.', ['transfer']),
  table('warehouse-sales', 'Warehouse-wise Sales', 'warehouse', 'Sales value shipped from each warehouse.', 'salesByWarehouse', ['sales']),
  table('warehouse-purchase', 'Warehouse-wise Purchase', 'warehouse', 'Purchase value received into each warehouse.', 'purchaseByWarehouse', ['purchase']),
  table('warehouse-production', 'Warehouse-wise Production', 'warehouse', 'Production orders and output per warehouse.', 'productionByWarehouse', ['production']),
  link('warehouse-consumption', 'Warehouse-wise Consumption', 'warehouse', 'Material consumption filterable by warehouse.', '/production/consumption', ['consumption']),
  link('warehouse-comparison', 'Warehouse Comparison', 'warehouse', 'Compare stock levels side-by-side across warehouses.', '/inventory', ['compare']),
  link('warehouse-item-availability', 'Warehouse Item Availability', 'warehouse', 'Available quantity per item, per warehouse.', '/inventory', ['availability']),

  // ------------------------------------------------------------------ ITEMS
  link('item-master', 'Item Master', 'items', 'Full item catalog.', '/items', ['master']),
  link('item-stock', 'Item Stock', 'items', 'Stock levels per item.', '/inventory', ['stock']),
  table('item-sales', 'Item Sales', 'items', 'Top-selling items by sales value.', 'salesByItem', ['sales']),
  table('item-purchase', 'Item Purchase', 'items', 'Top purchased items by value.', 'purchaseByItem', ['purchase']),
  table('item-movement', 'Item Movement', 'items', 'Real inbound/outbound stock transactions.', 'inventoryMovement', ['movement']),
  table('item-valuation', 'Item Valuation', 'items', 'On-hand quantity valued at average price.', 'stockSummary', ['valuation']),
  link('item-price-list', 'Item Price List', 'items', 'Item master with pricing.', '/items', ['price']),
  link('item-warehouse-stock', 'Item Warehouse Stock', 'items', 'Open an item to see its stock across every warehouse.', '/items', ['warehouse']),
  link('item-group-summary', 'Item Group Summary', 'items', 'Browse items grouped by item group.', '/items', ['group']),
  table('item-transaction-history', 'Item Transaction History', 'items', 'Real transaction history per item.', 'inventoryMovement', ['history']),
  table('item-consumption', 'Item Consumption', 'items', 'Raw materials by issued quantity.', 'topConsumedMaterials', ['consumption']),
  table('item-production', 'Item Production', 'items', 'Finished goods by produced quantity.', 'topProducedItems', ['production']),
  table('top-selling-items', 'Top Selling Items', 'items', 'Best-selling items by sales value.', 'salesByItem', ['top']),
  table('slow-moving-items-2', 'Slow Moving Items', 'items', 'Items whose stock has aged past 90 days since last receipt.', 'stockAgeing', ['slow moving']),
  table('non-moving-items-2', 'Non Moving Items', 'items', 'Items with on-hand stock and no movement history at all.', 'stockAgeing', ['non moving']),

  // -------------------------------------------------------------- MANAGEMENT
  link('management-dashboard', 'Management Dashboard', 'management', 'Cross-module executive KPIs — sales, purchase, finance and production in one view.', '/reports/management/summary', ['dashboard', 'executive']),
  link('business-summary', 'Business Summary', 'management', 'Cross-module executive KPIs.', '/reports/management/summary', ['summary']),
  link('sales-vs-purchase', 'Sales vs Purchase', 'management', 'This month\'s sales value against this month\'s purchase value.', '/reports/management/summary', ['comparison']),
  link('revenue-vs-expense', 'Revenue vs Expense', 'management', 'This month\'s revenue against this month\'s expenses.', '/reports/management/summary', ['comparison']),
  link('receivable-vs-payable', 'Receivable vs Payable', 'management', 'Total outstanding receivables against total outstanding payables.', '/reports/management/summary', ['comparison']),
  link('inventory-value-mgmt', 'Inventory Value', 'management', 'Total on-hand stock value.', '/reports/management/summary', ['inventory']),
  unavailable('inventory-turnover', 'Inventory Turnover', 'management', 'COGS divided by average inventory value.', 'This installation\'s companies have essentially no A/R invoice history (COGS activity) to compute a meaningful turnover ratio against current stock value.', ['turnover']),
  table('top-customers-mgmt', 'Top Customers', 'management', 'Highest-revenue customers.', 'financeTopCustomers', ['top']),
  table('top-vendors-mgmt', 'Top Vendors', 'management', 'Highest-spend vendors.', 'financeTopVendors', ['top']),
  table('top-items-mgmt', 'Top Items', 'management', 'Best-selling items by sales value.', 'salesByItem', ['top']),
  table('sales-trend-mgmt', 'Sales Trend', 'management', 'Sales value trend, last 12 months.', 'financeRevenueTrend', ['trend']),
  table('purchase-trend-mgmt', 'Purchase Trend', 'management', 'Purchase value trend, last 12 months.', 'financePurchaseTrend', ['trend']),
  table('profit-trend-mgmt', 'Profit Trend', 'management', 'Net profit trend, last 12 months.', 'financeNetProfitTrend', ['trend']),
  link('cash-position', 'Cash Position', 'management', 'Real cash and bank balances.', '/finance/bank-cash', ['cash']),
  link('working-capital', 'Working Capital Summary', 'management', 'Receivables + cash + bank - payables.', '/reports/management/summary', ['working capital']),
  link('business-kpi-summary', 'Business KPI Summary', 'management', 'Cross-module executive KPIs.', '/reports/management/summary', ['kpi']),

  // ------------------------------------------------------------- OPERATIONAL
  link('open-documents', 'Open Documents', 'operational', 'All open sales and purchase orders.', '/sales/orders', ['open']),
  unavailable('pending-approvals', 'Pending Approvals', 'operational', 'Documents awaiting an SAP B1 approval step.', NO_APPROVALS, ['approval']),
  link('pending-sales-orders', 'Pending Sales Orders', 'operational', 'Sales orders not yet fully delivered.', '/sales/orders', ['pending']),
  link('pending-purchase-orders', 'Pending Purchase Orders', 'operational', 'Purchase orders not yet fully received.', '/purchase/orders', ['pending']),
  link('pending-deliveries-op', 'Pending Deliveries', 'operational', 'Sales orders awaiting delivery.', '/sales/orders', ['pending']),
  link('pending-grpo-op', 'Pending GRPO', 'operational', 'Purchase orders awaiting goods receipt.', '/purchase/orders', ['pending']),
  link('pending-invoices', 'Pending Invoices', 'operational', 'Deliveries not yet invoiced / GRPOs not yet invoiced.', '/sales/deliveries', ['pending']),
  link('outstanding-receivables-op', 'Outstanding Receivables', 'operational', 'Open A/R balance with ageing.', '/finance/receivables', ['outstanding']),
  link('outstanding-payables-op', 'Outstanding Payables', 'operational', 'Open A/P balance with ageing.', '/finance/payables', ['outstanding']),
  link('pending-production', 'Pending Production', 'operational', 'Production orders still Planned or Released.', '/production/orders', ['pending']),
  table('stock-shortage', 'Stock Shortage', 'operational', 'Material requirements where available stock can\'t cover what\'s required.', 'stockAgeing', ['shortage']),
  table('negative-stock-op', 'Negative Stock', 'operational', 'Items with negative on-hand or available quantity.', 'negativeStock', ['negative']),
  link('document-ageing', 'Document Ageing', 'operational', 'Open a receivable or payable to see real days-overdue ageing.', '/finance/receivables', ['ageing']),
  link('cancelled-documents', 'Cancelled Documents', 'operational', 'Browse documents and filter by Cancelled status.', '/sales/orders', ['cancelled']),
  link('document-status-summary', 'Document Status Summary', 'operational', 'Production order status breakdown.', '/production/orders', ['status'])
];

export function getReportsByCategory(category: ReportCategoryId): ReportDefinition[] {
  return reportCatalog.filter((r) => r.category === category);
}

export function searchReports(query: string): ReportDefinition[] {
  const q = query.trim().toLowerCase();
  if (!q) return reportCatalog;
  return reportCatalog.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.category.toLowerCase().includes(q) ||
      r.tags.some((t) => t.toLowerCase().includes(q))
  );
}
