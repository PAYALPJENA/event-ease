import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Download } from 'lucide-react';
import { StatTile } from '../../components/Charts';
import ErrorState from '../../components/ErrorState';
import { fetchPayments } from '../../services/adminService';
import type { PaymentRow } from '../../services/adminService';
import { ApiError } from '../../services/api';
import { formatRupees } from '../../services/studentService';
import { downloadFile } from '../../utils/eventActions';
import { formatDateTime } from '../../utils/format';
import { registrationStatusLabel } from '../../utils/status';

/** Payment reconciliation (V5): every order with its gateway references, refunds and registration state. */

const STATUS_STYLE: Record<PaymentRow['status'], string> = {
  paid: 'text-green-700',
  refunded: 'text-indigo-700',
  created: 'text-amber-700',
  failed: 'text-red-600',
};
const STATUS_LABEL: Record<PaymentRow['status'], string> = { paid: 'Paid', refunded: 'Refunded', created: 'Awaiting payment', failed: 'Failed' };

const csvCell = (v: unknown) => {
  let t = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@]/.test(t)) t = `'${t}`;
  return `"${t.replace(/"/g, '""')}"`;
};

const AdminPayments = () => {
  const [data, setData] = useState<{ payments: PaymentRow[]; totals: { collected: number; refunded: number; pending: number } } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await fetchPayments());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load payments.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const exportCsv = () => {
    if (!data) return;
    const header = ['Event', 'Student', 'Roll number', 'Registration', 'Amount (₹)', 'Status', 'Gateway', 'Order ID', 'Payment ID', 'Refund ID', 'Created', 'Paid', 'Refunded'];
    const rows = data.payments.map(p => [p.eventTitle, p.name, p.universityId, p.registrationCode, p.amount / 100, p.status, p.gateway, p.orderId, p.paymentId, p.refundRef, p.createdAt, p.paidAt, p.refundedAt]);
    downloadFile('payments.csv', [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
  };

  return (
    <div className="space-y-8">
      <Link to="/admin" className="flex items-center text-sm font-medium text-gray-600 hover:text-indigo-600">
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Organizer
      </Link>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Payments</h1>
          <p className="text-gray-600">Every order from paid events, matched to its registration. Seats are only confirmed by the gateway's signed webhook.</p>
        </div>
        <button type="button" onClick={exportCsv} disabled={!data?.payments.length} className="btn btn-secondary">
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </button>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !data ? (
        <p role="status" className="text-gray-500">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatTile label="collected" value={formatRupees(data.totals.collected)} />
            <StatTile label="refunded" value={formatRupees(data.totals.refunded)} />
            <StatTile label="awaiting payment" value={formatRupees(data.totals.pending)} />
          </div>
          {data.payments.length === 0 ? (
            <p className="text-gray-600">No payments yet.</p>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
              <table className="min-w-full text-sm">
                <caption className="sr-only">Payments</caption>
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    {['Event', 'Student', 'Amount', 'Status', 'Registration', 'Gateway reference', 'When'].map(h => <th key={h} scope="col" className="px-4 py-3 font-medium">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.payments.map(p => (
                    <tr key={p.id}>
                      <td className="px-4 py-3 text-gray-900">{p.eventTitle}</td>
                      <td className="px-4 py-3">{p.name}<span className="block text-xs text-gray-600 font-mono">{p.universityId}</span></td>
                      <td className="px-4 py-3 tabular-nums">{formatRupees(p.amount)}</td>
                      <td className={`px-4 py-3 font-medium ${STATUS_STYLE[p.status]}`}>{STATUS_LABEL[p.status]}</td>
                      <td className="px-4 py-3">
                        <span className="font-mono">{p.registrationCode}</span>
                        <span className={`block text-xs ${registrationStatusLabel(p.registrationStatus).className}`}>{registrationStatusLabel(p.registrationStatus).label}</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">
                        {p.orderId}
                        {p.paymentId && <span className="block">{p.paymentId}</span>}
                        {p.refundRef && <span className="block">refund {p.refundRef}</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatDateTime(p.refundedAt ?? p.paidAt ?? p.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AdminPayments;
