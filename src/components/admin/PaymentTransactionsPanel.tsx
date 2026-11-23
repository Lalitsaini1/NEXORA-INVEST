import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Lock, ShieldAlert, ShieldCheck, Webhook } from 'lucide-react';
import { AdminActorContext } from '../../services/adminService';
import {
  subscribeAllPaymentTransactions,
  subscribePaymentWebhookEvents,
  verifyPaymentWithPlaceholderWebhook,
} from '../../services/paymentTransactionService';
import {
  DepositRequest,
  PaymentGatewayProvider,
  PaymentTransactionRecord,
  PaymentWebhookEventRecord,
} from '../../types/domain';
import { formatCoins, formatDateTimeInr, formatInr } from '../../utils/formatters';

interface PaymentTransactionsPanelProps {
  actor: AdminActorContext;
  deposits: DepositRequest[];
  searchQuery: string;
}

export function PaymentTransactionsPanel({
  actor,
  deposits,
  searchQuery,
}: PaymentTransactionsPanelProps) {
  const [paymentTxs, setPaymentTxs] = useState<PaymentTransactionRecord[]>([]);
  const [webhookEvents, setWebhookEvents] = useState<PaymentWebhookEventRecord[]>([]);
  const [loadingTxs, setLoadingTxs] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [busyDepositId, setBusyDepositId] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] =
    useState<PaymentGatewayProvider>('PLACEHOLDER_WEBHOOK');

  useEffect(() => {
    const unsubTxs = subscribeAllPaymentTransactions(
      (items) => {
        setPaymentTxs(items);
        setLoadingTxs(false);
      },
      (msg) => {
        setErrorMsg(msg);
        setLoadingTxs(false);
      }
    );
    const unsubEvents = subscribePaymentWebhookEvents(
      (items) => {
        setWebhookEvents(items);
        setLoadingEvents(false);
      },
      (msg) => {
        setErrorMsg((prev) => prev || msg);
        setLoadingEvents(false);
      }
    );
    return () => {
      unsubTxs();
      unsubEvents();
    };
  }, []);

  const depositById = useMemo(() => {
    const map = new Map<string, DepositRequest>();
    for (const d of deposits) {
      map.set(d.depositId, d);
    }
    return map;
  }, [deposits]);

  const filteredTxs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return paymentTxs;
    return paymentTxs.filter(
      (tx) =>
        tx.paymentTxId.toLowerCase().includes(q) ||
        tx.depositId.toLowerCase().includes(q) ||
        tx.userId.toLowerCase().includes(q) ||
        tx.idempotencyKey.toLowerCase().includes(q) ||
        tx.creditLockId.toLowerCase().includes(q) ||
        (tx.utrReference || '').toLowerCase().includes(q)
    );
  }, [paymentTxs, searchQuery]);

  const pendingOrReviewDeposits = useMemo(
    () =>
      deposits.filter((d) => d.status === 'PENDING' || d.status === 'UNDER_REVIEW').slice(0, 12),
    [deposits]
  );

  const handleRunPlaceholderWebhook = async (
    deposit: DepositRequest,
    simulatedOutcome: 'VERIFY' | 'HOLD' | 'REJECT_SIGNATURE'
  ) => {
    setErrorMsg(null);
    setNoticeMsg(null);
    setBusyDepositId(deposit.depositId);
    try {
      const res = await verifyPaymentWithPlaceholderWebhook({
        actor,
        deposit,
        provider: selectedProvider,
        simulatedOutcome,
      });
      setNoticeMsg(
        `Webhook check ${res.eventId}: ${res.outcome} (${res.duplicatePrevented ? 'Duplicate blocked' : res.note})`
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to execute placeholder webhook check.'
      );
    } finally {
      setBusyDepositId(null);
    }
  };

  return (
    <div className="p-5 sm:p-6 space-y-6">
      <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-bold text-[#0B1A30] flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
            <span>
              Backend-Ready Idempotent Payment Ledger &amp; Placeholder Webhook Verification
            </span>
          </p>
          <p className="text-[11px] text-slate-600">
            Every payment order binds to deterministic write-once{' '}
            <code className="font-mono text-[#0B1A30]">paymentCreditLocks</code> (Deposit ID +
            normalized UTR). Live webhook auto-crediting stays paused until gateway signing secrets
            and server backend verification are configured.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <label htmlFor="webhook-provider-select" className="text-[11px] font-semibold text-slate-600">
            Adapter:
          </label>
          <select
            id="webhook-provider-select"
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value as PaymentGatewayProvider)}
            className="px-3 py-1.5 text-xs font-mono text-[#0B1A30] bg-white border border-slate-300 rounded-lg cursor-pointer"
          >
            <option value="PLACEHOLDER_WEBHOOK">PLACEHOLDER_WEBHOOK</option>
            <option value="RAZORPAY">RAZORPAY (Sandbox)</option>
            <option value="CASHFREE">CASHFREE (Sandbox)</option>
            <option value="PHONEPE_PG">PHONEPE_PG (Sandbox)</option>
            <option value="PAYTM_PG">PAYTM_PG (Sandbox)</option>
          </select>
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2"
        >
          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{errorMsg}</span>
        </div>
      )}

      {noticeMsg && (
        <div
          role="status"
          className="p-3 text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2"
        >
          <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" aria-hidden="true" />
          <span>{noticeMsg}</span>
        </div>
      )}

      {/* Pending Deposit Quick Webhook Verification Runner */}
      {pendingOrReviewDeposits.length > 0 && (
        <div className="space-y-2.5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#0B1A30] flex items-center gap-1.5">
            <Webhook className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
            <span>Open Orders Eligible for Placeholder Webhook Dry-Run</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pendingOrReviewDeposits.map((dep) => {
              const busy = busyDepositId === dep.depositId;
              return (
                <div
                  key={dep.depositId}
                  className="p-3.5 bg-white border border-slate-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="text-xs space-y-0.5">
                    <p className="font-mono font-bold text-[#0B1A30]">
                      {dep.userId} · {formatInr(dep.amountInr)} ({formatCoins(dep.coinsRequested)})
                    </p>
                    <p className="font-mono text-[11px] text-slate-500 truncate max-w-[260px]">
                      {dep.depositId} · UTR: {dep.utrNumber || 'N/A'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleRunPlaceholderWebhook(dep, 'VERIFY')}
                      className="px-2.5 py-1.5 text-[11px] font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] disabled:opacity-50 rounded-md cursor-pointer"
                    >
                      Verify Webhook
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleRunPlaceholderWebhook(dep, 'REJECT_SIGNATURE')}
                      className="px-2.5 py-1.5 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 disabled:opacity-50 rounded-md cursor-pointer"
                    >
                      Simulate Bad Sig
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tracked Payment Transactions Table */}
      <div className="space-y-2.5">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[#0B1A30]">
          Tracked Payment Transactions ({filteredTxs.length})
        </h3>

        {loadingTxs ? (
          <p className="text-xs text-slate-500">Loading payment transactions...</p>
        ) : filteredTxs.length === 0 ? (
          <p className="text-xs text-slate-500">
            No tracked payment transaction records yet. New UPI deposit submissions and verified
            settlements automatically populate here with immutable credit locks.
          </p>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full min-w-[860px] border-collapse text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th scope="col" className="py-2.5 px-4">
                    Payment Tx &amp; Order
                  </th>
                  <th scope="col" className="py-2.5 px-4">
                    Member / Amount
                  </th>
                  <th scope="col" className="py-2.5 px-4">
                    Idempotency &amp; Credit Locks
                  </th>
                  <th scope="col" className="py-2.5 px-4">
                    Webhook State
                  </th>
                  <th scope="col" className="py-2.5 px-4">
                    Lifecycle Status
                  </th>
                  <th scope="col" className="py-2.5 px-4 text-right">
                    Duplicate Check
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredTxs.map((tx) => {
                  const linkedDep = depositById.get(tx.depositId);
                  return (
                    <tr key={tx.paymentTxId} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono text-[11px]">
                        <p className="font-bold text-[#0B1A30]">{tx.paymentTxId}</p>
                        <p className="text-slate-500">{tx.provider}</p>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] whitespace-nowrap">
                        <p className="font-bold text-[#0B1A30]">{tx.userId}</p>
                        <p className="text-slate-600">
                          {formatInr(tx.amountInr)} · {formatCoins(tx.coinsToCredit)}
                        </p>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-600">
                        <p className="truncate max-w-[200px]">Lock: {tx.creditLockId}</p>
                        <p className="text-slate-500 truncate max-w-[200px]">
                          UTR: {tx.utrReference || '—'}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-[11px]">
                        <span className="font-mono font-semibold text-[#0B1A30]">
                          {tx.webhookVerificationStatus}
                        </span>
                        {tx.coinTransactionId && (
                          <p className="font-mono text-emerald-700 truncate max-w-[160px]">
                            Ledger: {tx.coinTransactionId}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${
                            tx.status === 'CREDITED'
                              ? 'bg-emerald-50 text-emerald-700'
                              : tx.status === 'WEBHOOK_VERIFIED'
                              ? 'bg-blue-50 text-blue-700'
                              : tx.status === 'DUPLICATE_BLOCKED' ||
                                tx.status === 'FAILED' ||
                                tx.status === 'REJECTED'
                              ? 'bg-red-50 text-red-700'
                              : 'bg-[#F8F1DE] text-[#8A6518]'
                          }`}
                        >
                          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                          <span>{tx.status}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        {linkedDep ? (
                          <button
                            type="button"
                            disabled={busyDepositId === linkedDep.depositId}
                            onClick={() => void handleRunPlaceholderWebhook(linkedDep, 'VERIFY')}
                            className="px-2.5 py-1 text-[11px] font-semibold text-[#0B1A30] bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded cursor-pointer"
                          >
                            Test Re-Verify
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Immutable Webhook Verification Events Log */}
      <div className="space-y-2.5 pt-2 border-t border-slate-200">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[#0B1A30]">
          Immutable Webhook Verification Audit Events ({webhookEvents.length})
        </h3>

        {loadingEvents ? (
          <p className="text-xs text-slate-500">Loading webhook events...</p>
        ) : webhookEvents.length === 0 ? (
          <p className="text-xs text-slate-500">No placeholder or gateway webhook events logged yet.</p>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full min-w-[780px] border-collapse text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th scope="col" className="py-2.5 px-4">
                    Timestamp
                  </th>
                  <th scope="col" className="py-2.5 px-4">
                    Provider &amp; Event ID
                  </th>
                  <th scope="col" className="py-2.5 px-4">
                    Digest Fingerprint
                  </th>
                  <th scope="col" className="py-2.5 px-4">
                    Outcome
                  </th>
                  <th scope="col" className="py-2.5 px-4">
                    Audit Note
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {webhookEvents.slice(0, 15).map((evt) => (
                  <tr key={evt.eventId} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap">
                      {evt.createdAt ? formatDateTimeInr(evt.createdAt) : 'Syncing...'}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px]">
                      <p className="font-bold text-[#0B1A30]">{evt.provider}</p>
                      <p className="text-slate-500 truncate max-w-[180px]">{evt.gatewayEventId}</p>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-600">
                      {evt.computedDigestPreview}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${
                          evt.verificationStatus === 'VERIFIED_READY_FOR_CREDIT'
                            ? 'bg-emerald-50 text-emerald-700'
                            : evt.verificationStatus === 'DUPLICATE_IGNORED'
                            ? 'bg-amber-50 text-amber-800'
                            : evt.verificationStatus === 'SIGNATURE_INVALID' ||
                              evt.verificationStatus === 'FAILED'
                            ? 'bg-red-50 text-red-700'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {evt.verificationStatus}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-600 max-w-xs truncate">{evt.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
