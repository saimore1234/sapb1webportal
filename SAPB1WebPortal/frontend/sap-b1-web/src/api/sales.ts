import { apiClient } from './client';
import type {
  ApiResponse,
  PagedResult,
  SalesDocumentQuery,
  SalesQuotation,
  SalesQuotationDetail,
  SalesOrder,
  SalesOrderDetail,
  Delivery,
  DeliveryDetail,
  ArInvoice,
  ArInvoiceDetail,
  ArCreditMemo,
  ArCreditMemoDetail,
  IncomingPayment,
  IncomingPaymentDetail,
  SalesDashboard,
  SalesAnalytics,
  SalesOverview,
  OpenSalesOrders,
  InvoiceRegister,
  InvoiceRegisterQuery,
  CustomerOutstanding,
  CustomerLookup,
  CustomerLedger,
  SalesAnalyticsQuery,
  SalesAnalyticsReport,
  SalesAnalyticsOptions,
  TurnoverBreakup,
  TurnoverQuery
} from '../types';

// Every function here talks to the existing GET /api/sales/* endpoints —
// the company is always resolved server-side from the JWT; nothing here ever
// sends a database/company parameter.

async function unwrap<T>(promise: Promise<{ data: ApiResponse<T> }>, notFoundMessage: string): Promise<T> {
  const { data } = await promise;
  if (!data.success || data.data === null || data.data === undefined) {
    throw new Error(data.message || notFoundMessage);
  }
  return data.data;
}

export const getSalesDashboard = () =>
  unwrap<SalesDashboard>(apiClient.get('/sales/dashboard'), 'Failed to load the sales dashboard.');

export const getSalesAnalytics = () =>
  unwrap<SalesAnalytics>(apiClient.get('/sales/analytics'), 'Failed to load sales analytics.');

export const getSalesOverview = () =>
  unwrap<SalesOverview>(apiClient.get('/sales/overview'), 'Failed to load the sales overview.');

export const getOpenSalesOrdersBoard = (params: { filter?: string; search?: string; page?: number; pageSize?: number }) =>
  unwrap<OpenSalesOrders>(apiClient.get('/sales/overview/open-orders', { params }), 'Failed to load open sales orders.');

export const getInvoiceRegister = (query: InvoiceRegisterQuery) =>
  unwrap<InvoiceRegister>(apiClient.get('/sales/reports/invoice-register', { params: query }), 'Failed to load the invoice register.');

export const getCustomerOutstanding = () =>
  unwrap<CustomerOutstanding>(apiClient.get('/sales/reports/customer-outstanding'), 'Failed to load customer outstanding.');

export const lookupSalesCustomers = (search: string) =>
  unwrap<CustomerLookup[]>(apiClient.get('/sales/reports/customer-lookup', { params: { search } }), 'Failed to search customers.');

export const getCustomerLedger = (params: { customer: string; dateFrom?: string; dateTo?: string }) =>
  unwrap<CustomerLedger>(apiClient.get('/sales/reports/customer-ledger', { params }), 'Customer not found.');

export const getTurnoverBreakup = (params: TurnoverQuery) =>
  unwrap<TurnoverBreakup>(apiClient.get('/sales/reports/turnover-breakup', { params }), 'Failed to load turnover.');

export const getSalesAnalyticsOptions = () =>
  unwrap<SalesAnalyticsOptions>(apiClient.get('/sales/reports/analytics-options'), 'Failed to load analytics filters.');

export const getSalesAnalyticsReport = (query: SalesAnalyticsQuery) =>
  unwrap<SalesAnalyticsReport>(apiClient.get('/sales/reports/analytics', { params: query }), 'Failed to load sales analytics.');

export const getSalesQuotations = (query: SalesDocumentQuery) =>
  unwrap<PagedResult<SalesQuotation>>(apiClient.get('/sales/quotations', { params: query }), 'Failed to load sales quotations.');
export const getSalesQuotationByEntry = (docEntry: number) =>
  unwrap<SalesQuotationDetail>(apiClient.get(`/sales/quotations/${docEntry}`), 'Sales Quotation not found.');

export const getSalesOrders = (query: SalesDocumentQuery) =>
  unwrap<PagedResult<SalesOrder>>(apiClient.get('/sales/orders', { params: query }), 'Failed to load sales orders.');
export const getSalesOrderByEntry = (docEntry: number) =>
  unwrap<SalesOrderDetail>(apiClient.get(`/sales/orders/${docEntry}`), 'Sales Order not found.');

export const getDeliveries = (query: SalesDocumentQuery) =>
  unwrap<PagedResult<Delivery>>(apiClient.get('/sales/deliveries', { params: query }), 'Failed to load deliveries.');
export const getDeliveryByEntry = (docEntry: number) =>
  unwrap<DeliveryDetail>(apiClient.get(`/sales/deliveries/${docEntry}`), 'Delivery not found.');

export const getArInvoices = (query: SalesDocumentQuery) =>
  unwrap<PagedResult<ArInvoice>>(apiClient.get('/sales/invoices', { params: query }), 'Failed to load A/R invoices.');
export const getArInvoiceByEntry = (docEntry: number) =>
  unwrap<ArInvoiceDetail>(apiClient.get(`/sales/invoices/${docEntry}`), 'A/R Invoice not found.');

export const getArCreditMemos = (query: SalesDocumentQuery) =>
  unwrap<PagedResult<ArCreditMemo>>(apiClient.get('/sales/credit-memos', { params: query }), 'Failed to load A/R credit memos.');
export const getArCreditMemoByEntry = (docEntry: number) =>
  unwrap<ArCreditMemoDetail>(apiClient.get(`/sales/credit-memos/${docEntry}`), 'A/R Credit Memo not found.');

export const getIncomingPayments = (query: SalesDocumentQuery) =>
  unwrap<PagedResult<IncomingPayment>>(apiClient.get('/sales/payments', { params: query }), 'Failed to load payments.');
export const getIncomingPaymentByEntry = (docEntry: number) =>
  unwrap<IncomingPaymentDetail>(apiClient.get(`/sales/payments/${docEntry}`), 'Payment not found.');
