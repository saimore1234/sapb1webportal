import { CheckCircle2, Wallet } from 'lucide-react';
import SalesDocumentDetail from '../../components/sales/SalesDocumentDetail';
import ErpNextInvoicePanel from '../../components/sales/ErpNextInvoicePanel';
import { getArInvoiceByEntry } from '../../api/sales';

function formatMoney(value: number, currency: string | null) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 2 }).format(value);
  } catch {
    return value.toLocaleString();
  }
}

export default function ArInvoiceDetail() {
  return (
    <SalesDocumentDetail
      printType="ar-invoice"
      documentLabel="A/R Invoice"
      backLabel="Back to A/R Invoices"
      backRoute="/sales/invoices"
      fetchFn={getArInvoiceByEntry}
      title={(d) => d.customerName || d.customerCode}
      subtitle={(d) => d.customerCode}
      extraFields={(d) => [
        { label: 'Due Date', value: d.dueDate ? new Date(d.dueDate).toLocaleDateString() : '—' },
        { label: 'Sales Employee', value: d.salesEmployee }
      ]}
      extraStatCards={(d) => [
        { label: 'Paid', value: formatMoney(d.paid, d.currency), icon: CheckCircle2, accent: 'green' },
        { label: 'Balance', value: formatMoney(d.balance, d.currency), icon: Wallet, accent: d.balance > 0 ? 'amber' : 'slate' }
      ]}
      extraSections={(d) => <ErpNextInvoicePanel docEntry={d.docEntry} docNum={d.docNum} currency={d.currency} />}
    />
  );
}
