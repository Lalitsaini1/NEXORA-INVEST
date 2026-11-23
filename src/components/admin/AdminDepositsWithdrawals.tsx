import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Landmark,
  Search,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  AdminActorContext,
  reviewDepositRequest,
  reviewUserPayoutMethod,
  reviewWithdrawalRequest,
  subscribeAllDeposits,
  subscribeAllPayoutMethods,
  subscribeAllUsers,
  subscribeAllWithdrawals,
} from '../../services/adminService';
import {
  DepositRequest,
  DepositStatus,
  PayoutVerificationStatus,
  UserPayoutMethod,
  UserProfile,
  WithdrawalRequest,
  WithdrawalStatus,
} from '../../types/domain';
import { formatAdminActionError } from '../../utils/cloudFunctionErrorFormatter';
import {
  DepositVerificationChannel,
  validateDepositApprovalRequirements,
} from '../../utils/depositVerification';
import { formatCoins, formatDateTimeInr, formatInr } from '../../utils/formatters';
import { maskBankAccountNumber, maskUpiId } from '../../utils/walletControl';
import { PaymentTransactionsPanel } from './PaymentTransactionsPanel';

interface AdminDepositsWithdrawalsProps {
  actor: AdminActorContext;
}

export function AdminDepositsWithdrawals({ actor }: AdminDepositsWithdrawalsProps) {
  const [subTab, setSubTab] = useState<
    'DEPOSITS' | 'WITHDRAWALS' | 'PAYOUT_METHODS' | 'PAYMENT_LEDGER'
  >('DEPOSITS');
  const [deposits, setDeposits] = useState<DepositRequest[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [payoutMethods, setPayoutMethods] = useState<UserPayoutMethod[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loadingDeposits, setLoadingDeposits] = useState(true);
  const [loadingWithdrawals, setLoadingWithdrawals] = useState(true);
  const [loadingPayoutMethods, setLoadingPayoutMethods] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [depositStatusFilter, setDepositStatusFilter] = useState<'ALL' | DepositStatus>('ALL');
  const [withdrawalStatusFilter, setWithdrawalStatusFilter] = useState<'ALL' | WithdrawalStatus>('ALL');
  const [payoutStatusFilter, setPayoutStatusFilter] = useState<'ALL' | PayoutVerificationStatus>('ALL');

  const [approvingDeposit, setApprovingDeposit] = useState<DepositRequest | null>(null);
  const [verificationChannel, setVerificationChannel] =
    useState<'BANK_STATEMENT' | 'GATEWAY_SETTLEMENT'>('BANK_STATEMENT');
  const [externalTransactionId, setExternalTransactionId] = useState('');
  const [settlementReference, setSettlementReference] = useState('');
  const [reconciledAmountInr, setReconciledAmountInr] = useState('');

  const [rejectingDeposit, setRejectingDeposit] = useState<DepositRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  useEffect(() => {
    const unsubDep = subscribeAllDeposits(
      (items) => {
        setDeposits(items);
        setLoadingDeposits(false);
      },
      (msg) => {
        setErrorMsg((prev) => prev || msg);
        setLoadingDeposits(false);
      }
    );
    const unsubWd = subscribeAllWithdrawals(
      (items) => {
        setWithdrawals(items);
        setLoadingWithdrawals(false);
      },
      (msg) => {
        setErrorMsg((prev) => prev || msg);
        setLoadingWithdrawals(false);
      }
    );
    const unsubMethods = subscribeAllPayoutMethods(
      (items) => {
        setPayoutMethods(items);
        setLoadingPayoutMethods(false);
      },
      (msg) => {
        setErrorMsg((prev) => prev || msg);
        setLoadingPayoutMethods(false);
      }
    );
    const unsubUsers = subscribeAllUsers(
      (items) => setUsers(items),
      () => {}
    );
    return () => {
      unsubDep();
      unsubWd();
      unsubMethods();
      unsubUsers();
    };
  }, []);

  const userByUid = useMemo(() => {
    const map = new Map<string, UserProfile>();
    for (const u of users) {
      map.set(u.uid, u);
    }
    return map;
  }, [users]);

  const depositSummary = useMemo(() => {
    let pending = 0;
    let approved = 0;
    let rejected = 0;
    for (const d of deposits) {
      if (d.status === 'APPROVED') approved += 1;
      else if (d.status === 'REJECTED') rejected += 1;
      else pending += 1;
    }
    return { pending, approved, rejected };
  }, [deposits]);

  const filteredDeposits = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return deposits.filter((dep) => {
      if (depositStatusFilter !== 'ALL' && dep.status !== depositStatusFilter) return false;
      if (!q) return true;
      const owner = userByUid.get(dep.uid);
      return (
        dep.userId.toLowerCase().includes(q) ||
        dep.depositId.toLowerCase().includes(q) ||
        dep.assignedUpiId.toLowerCase().includes(q) ||
        (dep.utrNumber || '').toLowerCase().includes(q) ||
        (dep.externalTransactionId || '').toLowerCase().includes(q) ||
        (dep.settlementReference || '').toLowerCase().includes(q) ||
        (owner?.email || '').toLowerCase().includes(q) ||
        (owner?.fullName || '').toLowerCase().includes(q)
      );
    });
  }, [deposits, depositStatusFilter, searchQuery, userByUid]);

  const filteredWithdrawals = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return withdrawals.filter((wd) => {
      if (withdrawalStatusFilter !== 'ALL' && wd.status !== withdrawalStatusFilter) return false;
      if (!q) return true;
      const owner = userByUid.get(wd.uid);
      return (
        wd.userId.toLowerCase().includes(q) ||
        wd.withdrawalId.toLowerCase().includes(q) ||
        (wd.remarks || '').toLowerCase().includes(q) ||
        (owner?.email || '').toLowerCase().includes(q) ||
        (owner?.fullName || '').toLowerCase().includes(q)
      );
    });
  }, [withdrawals, withdrawalStatusFilter, searchQuery, userByUid]);

  const openApprovalVerificationForm = (deposit: DepositRequest) => {
    setErrorMsg(null);
    setNoticeMsg(null);
    setRejectingDeposit(null);
    setRejectionReason('');
    setApprovingDeposit(deposit);
    setVerificationChannel('BANK_STATEMENT');
    setExternalTransactionId('');
    setSettlementReference('');
    setReconciledAmountInr(String(deposit.amountInr));
  };

  const resetApprovalForm = () => {
    setApprovingDeposit(null);
    setExternalTransactionId('');
    setSettlementReference('');
    setReconciledAmountInr('');
  };

  const handleConfirmDepositApproval = async (deposit: DepositRequest) => {
    setErrorMsg(null);
    setNoticeMsg(null);
    setBusyId(deposit.depositId);
    try {
      const parsedAmount = Math.round(Number(reconciledAmountInr));
      const proof = {
        verificationChannel: verificationChannel as Extract<
          DepositVerificationChannel,
          'BANK_STATEMENT' | 'GATEWAY_SETTLEMENT'
        >,
        externalTransactionId: externalTransactionId.trim(),
        settlementReference: settlementReference.trim(),
        reconciledAmountInr: parsedAmount,
      };

      // Validate locally first for immediate, crisp feedback
      validateDepositApprovalRequirements({
        deposit,
        settlementProof: proof,
      });

      await reviewDepositRequest({
        actor,
        deposit,
        decision: 'APPROVED',
        settlementProof: proof,
      });

      resetApprovalForm();
      setNoticeMsg(
        `Deposit ${deposit.depositId} verified via ${proof.verificationChannel} (${proof.externalTransactionId}) and credited ${formatCoins(deposit.coinsRequested)} to ${deposit.userId}.`
      );
    } catch (err) {
      setErrorMsg(
        formatAdminActionError(
          err,
          'Unable to verify and credit deposit. Check payment reference and retry.'
        )
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleRejectDeposit = async (deposit: DepositRequest, reason: string) => {
    setErrorMsg(null);
    setNoticeMsg(null);
    setBusyId(deposit.depositId);
    try {
      await reviewDepositRequest({
        actor,
        deposit,
        decision: 'REJECTED',
        rejectionReason: reason,
      });
      if (rejectingDeposit?.depositId === deposit.depositId) {
        setRejectingDeposit(null);
        setRejectionReason('');
      }
      setNoticeMsg(`Deposit ${deposit.depositId} marked REJECTED.`);
    } catch (err) {
      setErrorMsg(formatAdminActionError(err, 'Unable to reject deposit request.'));
    } finally {
      setBusyId(null);
    }
  };

  const filteredPayoutMethods = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return payoutMethods.filter((method) => {
      if (payoutStatusFilter !== 'ALL' && method.verificationStatus !== payoutStatusFilter) {
        return false;
      }
      if (!q) return true;
      const owner = userByUid.get(method.uid);
      return (
        method.userId.toLowerCase().includes(q) ||
        method.label.toLowerCase().includes(q) ||
        (method.upiId || '').toLowerCase().includes(q) ||
        (method.bankName || '').toLowerCase().includes(q) ||
        (method.ifscCode || '').toLowerCase().includes(q) ||
        (owner?.email || '').toLowerCase().includes(q) ||
        (owner?.fullName || '').toLowerCase().includes(q)
      );
    });
  }, [payoutMethods, payoutStatusFilter, searchQuery, userByUid]);

  const handleReviewWithdrawal = async (
    withdrawal: WithdrawalRequest,
    nextStatus: 'PROCESSING' | 'APPROVED' | 'COMPLETED' | 'PAID' | 'REJECTED'
  ) => {
    setErrorMsg(null);
    setNoticeMsg(null);
    setBusyId(withdrawal.withdrawalId);
    try {
      await reviewWithdrawalRequest({ actor, withdrawal, nextStatus });
      setNoticeMsg(`Withdrawal ${withdrawal.withdrawalId} marked ${nextStatus}.`);
    } catch (err) {
      setErrorMsg(formatAdminActionError(err, 'Unable to review withdrawal request.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleReviewPayoutMethod = async (
    method: UserPayoutMethod,
    decision: 'VERIFIED' | 'REJECTED'
  ) => {
    setErrorMsg(null);
    setNoticeMsg(null);
    setBusyId(method.methodId);
    try {
      await reviewUserPayoutMethod({ actor, method, decision });
      setNoticeMsg(`Payout method "${method.label}" (${method.userId}) marked ${decision}.`);
    } catch (err) {
      setErrorMsg(formatAdminActionError(err, 'Unable to review payout method.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section
      aria-labelledby="deposits-withdrawals-heading"
      className="bg-white border border-slate-200 rounded-xl overflow-hidden"
    >
      <div className="p-5 sm:p-6 border-b border-slate-200 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <h2
              id="deposits-withdrawals-heading"
              className="font-display text-lg font-bold text-[#0B1A30]"
            >
              Deposit &amp; Withdrawal Review Queue
            </h2>
            <p className="text-xs text-slate-500">
              Verify deposits against bank settlement or payment gateway records before crediting
              member coin wallets, or finalize/refund withdrawals atomically.
            </p>
          </div>

          <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
            <button
              type="button"
              onClick={() => setSubTab('DEPOSITS')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                subTab === 'DEPOSITS'
                  ? 'bg-white text-[#0B1A30] shadow-xs'
                  : 'text-slate-600 hover:text-[#0B1A30]'
              }`}
            >
              <ArrowDownLeft className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
              <span>Deposits ({deposits.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('WITHDRAWALS')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                subTab === 'WITHDRAWALS'
                  ? 'bg-white text-[#0B1A30] shadow-xs'
                  : 'text-slate-600 hover:text-[#0B1A30]'
              }`}
            >
              <ArrowUpRight className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
              <span>Withdrawals ({withdrawals.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('PAYOUT_METHODS')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                subTab === 'PAYOUT_METHODS'
                  ? 'bg-white text-[#0B1A30] shadow-xs'
                  : 'text-slate-600 hover:text-[#0B1A30]'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
              <span>Payout Verification ({payoutMethods.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('PAYMENT_LEDGER')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                subTab === 'PAYMENT_LEDGER'
                  ? 'bg-white text-[#0B1A30] shadow-xs'
                  : 'text-slate-600 hover:text-[#0B1A30]'
              }`}
            >
              <span>Payment Ledger &amp; Webhooks</span>
            </button>
          </div>
        </div>

        {/* Search & Status Filter Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search
              className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by NX User ID, member email, UTR/Bank ref, UPI ID, or order ID"
              className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:bg-white focus:border-[#0B1A30]"
            />
          </div>

          {subTab === 'DEPOSITS' ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                <span>Pending: {depositSummary.pending}</span>
                <span>·</span>
                <span className="text-emerald-700">Approved: {depositSummary.approved}</span>
                <span>·</span>
                <span className="text-red-700">Rejected: {depositSummary.rejected}</span>
              </div>
              <select
                aria-label="Filter deposits by status"
                value={depositStatusFilter}
                onChange={(e) => setDepositStatusFilter(e.target.value as 'ALL' | DepositStatus)}
                className="px-3 py-2 text-xs font-semibold text-[#0B1A30] bg-slate-50 border border-slate-300 rounded-lg cursor-pointer"
              >
                <option value="ALL">All Deposit Statuses</option>
                <option value="PENDING">Pending</option>
                <option value="UNDER_REVIEW">Under Review</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>
          ) : subTab === 'PAYOUT_METHODS' ? (
            <select
              aria-label="Filter payout methods by verification status"
              value={payoutStatusFilter}
              onChange={(e) =>
                setPayoutStatusFilter(e.target.value as 'ALL' | PayoutVerificationStatus)
              }
              className="px-3 py-2 text-xs font-semibold text-[#0B1A30] bg-slate-50 border border-slate-300 rounded-lg cursor-pointer"
            >
              <option value="ALL">All Verification Statuses</option>
              <option value="PENDING_VERIFICATION">Pending Verification</option>
              <option value="VERIFIED">Verified</option>
              <option value="REJECTED">Rejected</option>
            </select>
          ) : subTab === 'WITHDRAWALS' ? (
            <select
              aria-label="Filter withdrawals by status"
              value={withdrawalStatusFilter}
              onChange={(e) =>
                setWithdrawalStatusFilter(e.target.value as 'ALL' | WithdrawalStatus)
              }
              className="px-3 py-2 text-xs font-semibold text-[#0B1A30] bg-slate-50 border border-slate-300 rounded-lg cursor-pointer"
            >
              <option value="ALL">All Withdrawal Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="PROCESSING">Processing</option>
              <option value="UNDER_REVIEW">Under Review</option>
              <option value="APPROVED">Approved</option>
              <option value="COMPLETED">Completed</option>
              <option value="PAID">Paid</option>
              <option value="REJECTED">Rejected</option>
            </select>
          ) : (
            <div className="text-[11px] font-semibold text-slate-600 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
              Atomic Idempotency Locks &amp; Payment Reconciliation Ledger
            </div>
          )}
        </div>

        {/* Authorized Bank / Gateway Settlement Verification Form for Deposit Approval */}
        {approvingDeposit && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleConfirmDepositApproval(approvingDeposit);
            }}
            className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-4 sm:p-5 space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-200/80 pb-3">
              <div className="space-y-0.5">
                <p className="text-xs font-bold text-[#0B1A30] flex items-center gap-1.5">
                  <Landmark className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                  <span>
                    Verify Payment &amp; Credit Wallet — {approvingDeposit.userId} (
                    {formatInr(approvingDeposit.amountInr)} →{' '}
                    {formatCoins(approvingDeposit.coinsRequested)})
                  </span>
                </p>
                <p className="text-[11px] text-slate-600 font-mono">
                  Order: {approvingDeposit.depositId} · User-Submitted UTR:{' '}
                  {approvingDeposit.utrNumber || 'Not attached'} · Assigned UPI:{' '}
                  {approvingDeposit.assignedUpiId}
                </p>
              </div>
              <span className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded">
                Requires Bank or Gateway Settlement Confirmation
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label
                  htmlFor="dep-verification-channel"
                  className="block text-[11px] font-bold text-slate-700 mb-1"
                >
                  Verification Source
                </label>
                <select
                  id="dep-verification-channel"
                  value={verificationChannel}
                  onChange={(e) =>
                    setVerificationChannel(
                      e.target.value as 'BANK_STATEMENT' | 'GATEWAY_SETTLEMENT'
                    )
                  }
                  className="w-full px-3 py-2 text-xs font-semibold text-[#0B1A30] bg-white border border-slate-300 rounded-lg"
                >
                  <option value="BANK_STATEMENT">Authorized Bank Statement</option>
                  <option value="GATEWAY_SETTLEMENT">Payment Gateway Settlement</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="dep-external-tx-id"
                  className="block text-[11px] font-bold text-slate-700 mb-1"
                >
                  Verified Bank / Gateway Txn ID
                </label>
                <input
                  id="dep-external-tx-id"
                  type="text"
                  required
                  minLength={6}
                  maxLength={64}
                  value={externalTransactionId}
                  onChange={(e) => setExternalTransactionId(e.target.value)}
                  placeholder="e.g. HDFC9876543210 or pay_Rzp..."
                  className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label
                  htmlFor="dep-settlement-ref"
                  className="block text-[11px] font-bold text-slate-700 mb-1"
                >
                  Bank Statement / Settlement Ref
                </label>
                <input
                  id="dep-settlement-ref"
                  type="text"
                  required
                  minLength={4}
                  maxLength={120}
                  value={settlementReference}
                  onChange={(e) => setSettlementReference(e.target.value)}
                  placeholder="e.g. ICICI-STMT-20261123-CR"
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label
                  htmlFor="dep-reconciled-amount"
                  className="block text-[11px] font-bold text-slate-700 mb-1"
                >
                  Verified Amount Received (INR)
                </label>
                <input
                  id="dep-reconciled-amount"
                  type="number"
                  required
                  min={100}
                  max={500000}
                  step={1}
                  value={reconciledAmountInr}
                  onChange={(e) => setReconciledAmountInr(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <p className="text-[11px] text-slate-600">
                Atomic lock checks will verify no duplicate credit exists for Order ID, UTR, or
                Bank/Gateway Transaction ID before crediting {approvingDeposit.userId}.
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="submit"
                  disabled={busyId === approvingDeposit.depositId}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg cursor-pointer"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {busyId === approvingDeposit.depositId
                      ? 'Verifying & Crediting...'
                      : 'Confirm Verification & Credit'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={resetApprovalForm}
                  className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Inline Deposit Rejection Reason Form */}
        {rejectingDeposit && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleRejectDeposit(rejectingDeposit, rejectionReason);
            }}
            className="bg-red-50 border border-red-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-end gap-3"
          >
            <div className="flex-1">
              <label
                htmlFor="dep-rejection-reason"
                className="block text-[11px] font-bold text-red-800 mb-1"
              >
                Rejection Reason for {rejectingDeposit.userId} (UTR:{' '}
                {rejectingDeposit.utrNumber || 'N/A'})
              </label>
              <input
                id="dep-rejection-reason"
                type="text"
                required
                minLength={3}
                maxLength={300}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="e.g. UTR reference not found in UPI settlement statement"
                className="w-full px-3 py-2 text-xs bg-white border border-red-300 rounded-lg"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busyId === rejectingDeposit.depositId}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-50 rounded-lg cursor-pointer"
              >
                {busyId === rejectingDeposit.depositId ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRejectingDeposit(null);
                  setRejectionReason('');
                }}
                className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2"
          >
            <ShieldAlert className="h-4 w-4 text-red-700 shrink-0" aria-hidden="true" />
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
      </div>

      {subTab === 'DEPOSITS' ? (
        loadingDeposits ? (
          <div className="p-6 text-xs text-slate-500">Loading deposit requests...</div>
        ) : filteredDeposits.length === 0 ? (
          <div className="p-6 text-xs text-slate-500">
            No deposit requests match your current search or filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th scope="col" className="py-3 px-5">
                    Submitted
                  </th>
                  <th scope="col" className="py-3 px-4">
                    Member Details
                  </th>
                  <th scope="col" className="py-3 px-4">
                    INR / Coins
                  </th>
                  <th scope="col" className="py-3 px-4">
                    UPI &amp; Settlement Ref
                  </th>
                  <th scope="col" className="py-3 px-4">
                    Approval Status
                  </th>
                  <th scope="col" className="py-3 px-5 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredDeposits.map((dep) => {
                  const finalized =
                    dep.status === 'APPROVED' || dep.status === 'REJECTED';
                  const isBusy = busyId === dep.depositId;
                  const owner = userByUid.get(dep.uid);
                  return (
                    <tr key={dep.depositId} className="hover:bg-slate-50/70">
                      <td className="py-3 px-5 font-mono text-slate-600 whitespace-nowrap">
                        <div>{formatDateTimeInr(dep.createdAt)}</div>
                        <div className="text-[10px] text-slate-400">{dep.depositId}</div>
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-mono font-semibold text-[#0B1A30]">{dep.userId}</p>
                        {owner && (
                          <p className="text-[11px] text-slate-500 truncate max-w-[190px]">
                            {owner.fullName} · {owner.email}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono whitespace-nowrap">
                        <div>
                          <span className="font-bold text-[#0B1A30]">
                            {formatInr(dep.amountInr)}
                          </span>{' '}
                          · {formatCoins(dep.coinsRequested)}
                        </div>
                        {Boolean(dep.bonusCoins && dep.bonusCoins > 0) && (
                          <div className="text-[10px] text-[#8A6518]">
                            {dep.packageName || 'Package'} (+{dep.bonusCoins?.toLocaleString('en-IN')}{' '}
                            Bonus)
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-700">
                        <div>{dep.assignedUpiId}</div>
                        <div className="text-slate-500">
                          UTR: {dep.utrNumber || 'Not attached'}
                        </div>
                        {dep.externalTransactionId && (
                          <div className="text-emerald-700">
                            {dep.verificationChannel || 'VERIFIED'}: {dep.externalTransactionId}
                          </div>
                        )}
                        {dep.rejectionReason && dep.status === 'REJECTED' && (
                          <div className="text-red-700 truncate max-w-[240px]">
                            Reason: {dep.rejectionReason}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${
                            dep.status === 'APPROVED'
                              ? 'bg-emerald-50 text-emerald-700'
                              : dep.status === 'REJECTED'
                              ? 'bg-red-50 text-red-700'
                              : 'bg-[#F8F1DE] text-[#8A6518]'
                          }`}
                        >
                          {dep.status}
                        </span>
                        {dep.verifiedAt && (
                          <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                            {formatDateTimeInr(dep.verifiedAt)}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-5 text-right whitespace-nowrap">
                        {finalized ? (
                          <span className="text-slate-400 text-[11px]">Finalized</span>
                        ) : (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => openApprovalVerificationForm(dep)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-md cursor-pointer"
                            >
                              <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                              <span>Approve &amp; Credit</span>
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => {
                                resetApprovalForm();
                                setRejectingDeposit(dep);
                                setRejectionReason('');
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 disabled:opacity-50 rounded-md cursor-pointer"
                            >
                              <XCircle className="h-3 w-3" aria-hidden="true" />
                              <span>Reject</span>
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : subTab === 'PAYMENT_LEDGER' ? (
        <PaymentTransactionsPanel
          actor={actor}
          deposits={deposits}
          searchQuery={searchQuery}
        />
      ) : subTab === 'PAYOUT_METHODS' ? (
        loadingPayoutMethods ? (
          <div className="p-6 text-xs text-slate-500">Loading member payout methods...</div>
        ) : filteredPayoutMethods.length === 0 ? (
          <div className="p-6 text-xs text-slate-500">
            No member UPI or Bank payout methods match your current filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] border-collapse text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th scope="col" className="py-3 px-5">
                    Submitted
                  </th>
                  <th scope="col" className="py-3 px-4">
                    Member
                  </th>
                  <th scope="col" className="py-3 px-4">
                    Method &amp; Masked Details
                  </th>
                  <th scope="col" className="py-3 px-4">
                    Verification
                  </th>
                  <th scope="col" className="py-3 px-5 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredPayoutMethods.map((method) => {
                  const isBusy = busyId === method.methodId;
                  const owner = userByUid.get(method.uid);
                  const maskedDetail =
                    method.methodType === 'UPI'
                      ? `${method.upiProvider || 'UPI'} · ${maskUpiId(method.upiId || '')}`
                      : `${method.bankName || 'Bank'} · ${
                          method.accountNumberMasked ||
                          maskBankAccountNumber(method.accountLast4 || '')
                        } · IFSC: ${method.ifscCode || '—'}`;

                  return (
                    <tr key={method.methodId} className="hover:bg-slate-50/70">
                      <td className="py-3 px-5 font-mono text-slate-600 whitespace-nowrap">
                        {formatDateTimeInr(method.updatedAt || method.createdAt)}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-mono font-semibold text-[#0B1A30]">{method.userId}</p>
                        {owner && (
                          <p className="text-[11px] text-slate-500 truncate max-w-[190px]">
                            {owner.fullName} · {owner.email}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-semibold text-[#0B1A30]">
                          {method.label} ({method.methodType})
                        </p>
                        <p className="font-mono text-[11px] text-slate-600">{maskedDetail}</p>
                      </td>
                      <td className="py-3 px-4 font-semibold whitespace-nowrap">
                        {method.verificationStatus}
                      </td>
                      <td className="py-3 px-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={isBusy || method.verificationStatus === 'VERIFIED'}
                            onClick={() => void handleReviewPayoutMethod(method, 'VERIFIED')}
                            className="px-2.5 py-1.5 text-[11px] font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-md cursor-pointer"
                          >
                            Verify Ownership
                          </button>
                          <button
                            type="button"
                            disabled={isBusy || method.verificationStatus === 'REJECTED'}
                            onClick={() => void handleReviewPayoutMethod(method, 'REJECTED')}
                            className="px-2.5 py-1.5 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 disabled:opacity-50 rounded-md cursor-pointer"
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : loadingWithdrawals ? (
        <div className="p-6 text-xs text-slate-500">Loading withdrawal requests...</div>
      ) : filteredWithdrawals.length === 0 ? (
        <div className="p-6 text-xs text-slate-500">
          No withdrawal requests match your current search or filter.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th scope="col" className="py-3 px-5">
                  Requested
                </th>
                <th scope="col" className="py-3 px-4">
                  Member Details
                </th>
                <th scope="col" className="py-3 px-4">
                  Amount
                </th>
                <th scope="col" className="py-3 px-4">
                  Destination &amp; Remarks
                </th>
                <th scope="col" className="py-3 px-4">
                  Status
                </th>
                <th scope="col" className="py-3 px-5 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredWithdrawals.map((wd) => {
                const finalized =
                  wd.status === 'COMPLETED' || wd.status === 'PAID' || wd.status === 'REJECTED';
                const isBusy = busyId === wd.withdrawalId;
                const owner = userByUid.get(wd.uid);
                return (
                  <tr key={wd.withdrawalId} className="hover:bg-slate-50/70">
                    <td className="py-3 px-5 font-mono text-slate-600 whitespace-nowrap">
                      {formatDateTimeInr(wd.createdAt)}
                    </td>
                    <td className="py-3 px-4">
                      <p className="font-mono font-semibold text-[#0B1A30]">{wd.userId}</p>
                      {owner && (
                        <p className="text-[11px] text-slate-500 truncate max-w-[190px]">
                          {owner.fullName} · {owner.email}
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-[#0B1A30] whitespace-nowrap">
                      {formatInr(wd.amountInr)}
                    </td>
                    <td className="py-3 px-4 text-slate-600 max-w-xs truncate">
                      {wd.payoutDestinationMasked || wd.remarks || '—'}
                    </td>
                    <td className="py-3 px-4 font-semibold whitespace-nowrap">{wd.status}</td>
                    <td className="py-3 px-5 text-right whitespace-nowrap">
                      {finalized ? (
                        <span className="text-slate-400 text-[11px]">Finalized</span>
                      ) : (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleReviewWithdrawal(wd, 'PROCESSING')}
                            className="px-2.5 py-1.5 text-[11px] font-semibold text-blue-800 bg-blue-50 hover:bg-blue-100 rounded-md cursor-pointer"
                          >
                            Processing
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleReviewWithdrawal(wd, 'APPROVED')}
                            className="px-2.5 py-1.5 text-[11px] font-semibold text-[#0B1A30] bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleReviewWithdrawal(wd, 'COMPLETED')}
                            className="px-2.5 py-1.5 text-[11px] font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md cursor-pointer"
                          >
                            Mark Completed
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleReviewWithdrawal(wd, 'REJECTED')}
                            className="px-2.5 py-1.5 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-md cursor-pointer"
                          >
                            Reject &amp; Refund
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
