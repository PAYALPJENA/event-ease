import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CreditCard, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useEvents } from '../context/EventsContext';
import { useUserEvents } from '../context/UserEventsContext';
import { ApiError } from '../services/api';
import { fetchOrder, formatRupees, mockCheckout } from '../services/studentService';
import type { OrderSummary } from '../services/studentService';
import { formatDateTime } from '../utils/format';

/**
 * Checkout for paid events (V5). In development this is the mock gateway's
 * payment screen: "Pay" makes the gateway send its signed webhook, and only
 * that webhook confirms the seat. With a real gateway (e.g. Razorpay), this
 * page opens the gateway's checkout instead.
 */
const Pay = () => {
  const { orderId = '' } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { refresh } = useUserEvents();
  const { refetch } = useEvents();
  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchOrder(orderId)
      .then(setOrder)
      .catch(err => setError(err instanceof ApiError ? err.message : 'Unable to load this order.'));
  }, [orderId]);

  const pay = async (outcome: 'success' | 'failure') => {
    if (!order) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await mockCheckout(order.orderId, outcome);
      await Promise.all([refresh(), refetch()]);
      if (outcome === 'failure') {
        setMessage('The payment failed. Your seat is still held — go back to your registration to try again.');
        setOrder({ ...order, status: 'failed' });
      } else if (res.status === 'refunded') {
        setMessage('Your seat had already been released, so this payment is being refunded.');
      } else {
        navigate(`/register-success/${order.event.id}`);
      }
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Payment could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p role="alert" className="py-24 text-center text-red-600">{error}</p>;
  if (!order) return <p role="status" className="py-24 text-center text-gray-500">Loading your order…</p>;

  return (
    <div className="max-w-md mx-auto py-12">
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
        <div className="bg-gray-900 text-white p-6">
          <p className="text-xs uppercase tracking-wider text-gray-300 mb-1">EventEase test gateway</p>
          <h1 className="text-xl font-bold">{order.event.title}</h1>
          <p className="text-3xl font-extrabold mt-3">{formatRupees(order.amount)}</p>
        </div>
        <div className="p-6 space-y-4">
          <p className="flex items-start text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 mr-2 mt-0.5 shrink-0" />
            Development mode: no real money moves. A real payment gateway replaces this screen in production.
          </p>
          {order.dueAt && order.status === 'created' && (
            <p className="text-sm text-gray-700">Your seat is held until {formatDateTime(order.dueAt)}.</p>
          )}
          <p role="status" className="text-sm text-gray-800">{message}</p>
          {order.status === 'created' ? (
            <div className="space-y-2">
              <button type="button" disabled={busy} onClick={() => pay('success')} className="btn btn-primary w-full py-3 text-base">
                <CreditCard className="w-5 h-5 mr-2" />
                {busy ? 'Processing…' : `Pay ${formatRupees(order.amount)}`}
              </button>
              <button type="button" disabled={busy} onClick={() => pay('failure')} className="btn btn-secondary w-full">
                Simulate a failed payment
              </button>
            </div>
          ) : (
            <Link to={`/register-success/${order.event.id}`} className="btn btn-primary w-full">Back to my registration</Link>
          )}
          <p className="flex items-center justify-center text-xs text-gray-500">
            <ShieldCheck className="w-4 h-4 mr-1" />
            Your seat is confirmed by the gateway's signed notification, not by this page.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Pay;
