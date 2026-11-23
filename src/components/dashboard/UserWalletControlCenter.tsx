import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Clock,
  Coins,
  CreditCard,
  Edit3,
  History,
  IndianRupee,
  Landmark,
  Loader2,
  Lock,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Star,
  Trash2,
  Wallet,
  XCircle,
} from 'lucide-react';
import { WITHDRAWAL_PRESET_AMOUNTS_INR } from '../../config/constants';
import { subscribeUserTransactions } from '../../services/transactionService';
import {
  deleteUserPayoutMethod,
  saveUserBankAccount,
  saveUserUpiMethod,
  setDefaultUserPayoutMethod,
  submitWalletWithdrawal,
  subscribeUserPayoutMethods,
  subscribeUserWithdrawals,
  subscribeWalletPayoutStatus,
  WalletPayoutRuntimeStatus,
} from '../../services/walletService';
import {
  CoinTransaction,
  CoinWallet,
  PayoutVerificationStatus,
  UserPayoutMethod,
  WithdrawalRequest,
} from '../../types/domain';
import { formatCoins, formatDateTimeInr, formatInr } from '../../utils/formatters';
import {
  getWithdrawalStatusDisplay,
  maskBankAccountNumber,
  maskUpiId,
  MAX_WITHDRAWAL_INR,
  MIN_WITHDRAWAL_INR,
  UPI_HANDLE_OPTIONS,
  validateWithdrawalAmountInr,
} from '../../utils/walletControl';

type WalletTab = 'WITHDRAW' | 'UPI' | 'BANK' | 'WITHDRAWALS' | 'LEDGER';

interface UserWalletControlCenterProps {
  uid: string;
  userId?: string;
  accountStatus?: string;
  wallet: CoinWallet | null;
  highContrast?: boolean;
}

function getVerificationVisual(status: PayoutVerificationStatus): {
  label: string;
  textClass: string;
  Icon: typeof CheckCircle2;
} {
  switch (status) {
    case 'VERIFIED':
      return {
        label: 'Verified for Payouts',
        textClass: 'text-emerald-700',
        Icon: CheckCircle2,
      };
    case 'REJECTED':
      return {
        label: 'Verification Rejected',
        textClass: 'text-red-700',
        Icon: XCircle,
      };
    case 'PENDING_VERIFICATION':
    default:
      return {
        label: 'Pending Ownership Verification',
        textClass: 'text-amber-700',
        Icon: Clock,
      };
  }
}

function getWithdrawalToneClass(tone: 'amber' | 'navy' | 'blue' | 'red' | 'emerald'): string {
  switch (tone) {
    case 'emerald':
      return 'text-emerald-700';
    case 'blue':
      return 'text-blue-700';
    case 'navy':
      return 'text-[#0B1A30]';
    case 'red':
      return 'text-red-700';
    case 'amber':
    default:
      return 'text-amber-700';
  }
}

export function UserWalletControlCenter({
  uid,
  userId,
  accountStatus,
  wallet,
  highContrast = false,
}: UserWalletControlCenterProps) {
  const [activeTab, setActiveTab] = useState<WalletTab>('WITHDRAW');
  const [payoutStatus, setPayoutStatus] = useState<WalletPayoutRuntimeStatus>({
    payoutsEnabled: false,
    securityNotice: '',
  });

  const [payoutMethods, setPayoutMethods] = useState<UserPayoutMethod[]>([]);
  const [loadingMethods, setLoadingMethods] = useState(true);
  const [methodsError, setMethodsError] = useState<string | null>(null);

  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [loadingWithdrawals, setLoadingWithdrawals] = useState(true);
  const [withdrawalsError, setWithdrawalsError] = useState<string | null>(null);

  const [walletTransactions, setWalletTransactions] = useState<CoinTransaction[]>([]);
  const [loadingTx, setLoadingTx] = useState(true);

  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyMethodId, setBusyMethodId] = useState<string | null>(null);

  // UPI Form State (Add / Edit)
  const [showUpiForm, setShowUpiForm] = useState(false);
  const [editingUpiMethodId, setEditingUpiMethodId] = useState<string | undefined>(undefined);
  const [upiLabel, setUpiLabel] = useState('');
  const [upiIdInput, setUpiIdInput] = useState('');
  const [upiProvider, setUpiProvider] = useState<string>(UPI_HANDLE_OPTIONS[0]);
  const [upiMakeDefault, setUpiMakeDefault] = useState(true);
  const [savingUpi, setSavingUpi] = useState(false);

  // Bank Account Form State (Add / Replace)
  const [showBankForm, setShowBankForm] = useState(false);
  const [editingBankMethodId, setEditingBankMethodId] = useState<string | undefined>(undefined);
  const [bankLabel, setBankLabel] = useState('');
  const [accountHolderName, setAccountHolderName] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [confirmAccountNumber, setConfirmAccountNumber] = useState('');
  const [ifscCode, setIfscCode] = useState('');
  const [accountType, setAccountType] = useState<'SAVINGS' | 'CURRENT'>('SAVINGS');
  const [bankMakeDefault, setBankMakeDefault] = useState(true);
  const [savingBank, setSavingBank] = useState(false);

  // Withdrawal Form State
  const [withdrawAmountInput, setWithdrawAmountInput] = useState('');
  const [selectedPayoutMethodId, setSelectedPayoutMethodId] = useState('');
  const [submittingWithdrawal, setSubmittingWithdrawal] = useState(false);

  useEffect(() => {
    if (!uid) return;
    setLoadingMethods(true);
    setLoadingWithdrawals(true);
    setLoadingTx(true);

    const unsubStatus = subscribeWalletPayoutStatus((status) => {
      setPayoutStatus(status);
    });
    const unsubMethods = subscribeUserPayoutMethods(
      uid,
      (items) => {
        setPayoutMethods(items);
        setLoadingMethods(false);
        setMethodsError(null);
      },
      (msg) => {
        setMethodsError(msg);
        setLoadingMethods(false);
      }
    );
    const unsubWithdrawals = subscribeUserWithdrawals(
      uid,
      (items) => {
        setWithdrawals(items);
        setLoadingWithdrawals(false);
        setWithdrawalsError(null);
      },
      (msg) => {
        setWithdrawalsError(msg);
        setLoadingWithdrawals(false);
      }
    );
    const unsubTx = subscribeUserTransactions(
      uid,
      (items) => {
        const sorted = [...items].sort(
          (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)
        );
        setWalletTransactions(sorted);
        setLoadingTx(false);
      },
      () => {
        setLoadingTx(false);
      }
    );

    return () => {
      unsubStatus();
      unsubMethods();
      unsubWithdrawals();
      unsubTx();
    };
  }, [uid]);

  const upiMethods = useMemo(
    () => payoutMethods.filter((m) => m.methodType === 'UPI'),
    [payoutMethods]
  );
  const bankMethods = useMemo(
    () => payoutMethods.filter((m) => m.methodType === 'BANK_ACCOUNT'),
    [payoutMethods]
  );
  const verifiedMethods = useMemo(
    () => payoutMethods.filter((m) => m.verificationStatus === 'VERIFIED'),
    [payoutMethods]
  );

  useEffect(() => {
    if (verifiedMethods.length === 0) {
      setSelectedPayoutMethodId('');
      return;
    }
    const stillValid = verifiedMethods.some((m) => m.methodId === selectedPayoutMethodId);
    if (!stillValid) {
      const preferred = verifiedMethods.find((m) => m.isDefault) || verifiedMethods[0];
      setSelectedPayoutMethodId(preferred.methodId);
    }
  }, [verifiedMethods, selectedPayoutMethodId]);

  const availableCoins = wallet?.availableCoins ?? 0;
  const purchasedCoins = wallet?.purchasedCoins ?? 0;
  const earnedCoins = wallet?.earnedCoins ?? 0;
  const coinsUsedForPlans = wallet?.coinsUsedForPlans ?? 0;
  const pendingTransactionCoins = wallet?.pendingTransactionCoins ?? 0;
  const eligibleInr = wallet?.withdrawableBalanceInr ?? 0;

  const parsedAmountInr = Number(withdrawAmountInput);
  const amountValidationError = useMemo(() => {
    if (!withdrawAmountInput.trim()) return null;
    return validateWithdrawalAmountInr(parsedAmountInr, eligibleInr);
  }, [withdrawAmountInput, parsedAmountInr, eligibleInr]);

  const selectedVerifiedMethod = useMemo(
    () => verifiedMethods.find((m) => m.methodId === selectedPayoutMethodId) || null,
    [verifiedMethods, selectedPayoutMethodId]
  );

  const resetUpiForm = () => {
    setShowUpiForm(false);
    setEditingUpiMethodId(undefined);
    setUpiLabel('');
    setUpiIdInput('');
    setUpiProvider(UPI_HANDLE_OPTIONS[0]);
    setUpiMakeDefault(upiMethods.length === 0);
  };

  const resetBankForm = () => {
    setShowBankForm(false);
    setEditingBankMethodId(undefined);
    setBankLabel('');
    setAccountHolderName('');
    setBankName('');
    setAccountNumber('');
    setConfirmAccountNumber('');
    setIfscCode('');
    setAccountType('SAVINGS');
    setBankMakeDefault(bankMethods.length === 0);
  };

  const handleEditUpi = (method: UserPayoutMethod) => {
    setActionError(null);
    setActionNotice(null);
    setActiveTab('UPI');
    setEditingUpiMethodId(method.methodId);
    setUpiLabel(method.label);
    setUpiIdInput(method.upiId || '');
    setUpiProvider(method.upiProvider || UPI_HANDLE_OPTIONS[0]);
    setUpiMakeDefault(method.isDefault);
    setShowUpiForm(true);
  };

  const handleEditBank = (method: UserPayoutMethod) => {
    setActionError(null);
    setActionNotice(null);
    setActiveTab('BANK');
    setEditingBankMethodId(method.methodId);
    setBankLabel(method.label);
    setAccountHolderName(method.accountHolderName || '');
    setBankName(method.bankName || '');
    // Never prefill complete sensitive bank numbers from stored records; user re-enters to update/replace.
    setAccountNumber('');
    setConfirmAccountNumber('');
    setIfscCode(method.ifscCode || '');
    setAccountType(method.accountType === 'CURRENT' ? 'CURRENT' : 'SAVINGS');
    setBankMakeDefault(method.isDefault);
    setShowBankForm(true);
  };

  const handleSaveUpi = async (e: FormEvent) => {
    e.preventDefault();
    if (savingUpi) return;
    setActionError(null);
    setActionNotice(null);
    if (!userId) {
      setActionError('Your NEXORA User ID is still initializing. Please wait a moment.');
      return;
    }

    setSavingUpi(true);
    try {
      await saveUserUpiMethod({
        uid,
        userId,
        methodId: editingUpiMethodId,
        label: upiLabel,
        upiId: upiIdInput,
        upiProvider,
        isDefault: upiMakeDefault,
      });
      setActionNotice(
        editingUpiMethodId
          ? 'UPI ID updated and submitted for ownership verification before payouts.'
          : 'UPI ID added and queued for ownership verification before payouts.'
      );
      resetUpiForm();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to save UPI ID.');
    } finally {
      setSavingUpi(false);
    }
  };

  const handleSaveBank = async (e: FormEvent) => {
    e.preventDefault();
    if (savingBank) return;
    setActionError(null);
    setActionNotice(null);
    if (!userId) {
      setActionError('Your NEXORA User ID is still initializing. Please wait a moment.');
      return;
    }

    setSavingBank(true);
    try {
      await saveUserBankAccount({
        uid,
        userId,
        methodId: editingBankMethodId,
        label: bankLabel,
        accountHolderName,
        bankName,
        accountNumber,
        confirmAccountNumber,
        ifscCode,
        accountType,
        isDefault: bankMakeDefault,
      });
      setActionNotice(
        editingBankMethodId
          ? 'Bank account details replaced and submitted for ownership verification.'
          : 'Bank account added securely (masked) and submitted for ownership verification.'
      );
      resetBankForm();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to save bank account.');
    } finally {
      setSavingBank(false);
    }
  };

  const handleSetDefaultMethod = async (method: UserPayoutMethod) => {
    if (busyMethodId) return;
    setActionError(null);
    setActionNotice(null);
    setBusyMethodId(method.methodId);
    try {
      await setDefaultUserPayoutMethod({
        uid,
        targetMethodId: method.methodId,
        methods: payoutMethods,
      });
      setActionNotice(`"${method.label}" set as your default payout destination.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to update default method.');
    } finally {
      setBusyMethodId(null);
    }
  };

  const handleDeleteMethod = async (method: UserPayoutMethod) => {
    if (busyMethodId) return;
    setActionError(null);
    setActionNotice(null);
    setBusyMethodId(method.methodId);
    try {
      await deleteUserPayoutMethod({ uid, method });
      if (editingUpiMethodId === method.methodId) resetUpiForm();
      if (editingBankMethodId === method.methodId) resetBankForm();
      setActionNotice(`Removed saved payout method "${method.label}".`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to remove payout method.');
    } finally {
      setBusyMethodId(null);
    }
  };

  const handleSubmitWithdrawal = async (e: FormEvent) => {
    e.preventDefault();
    if (submittingWithdrawal) return;
    setActionError(null);
    setActionNotice(null);

    if (!userId) {
      setActionError('Verified NEXORA User ID is required to submit a withdrawal.');
      return;
    }
    if (!payoutStatus.payoutsEnabled) {
      setActionError(
        'Real-money withdrawals are currently disabled until regulatory, KYC/AML, and payment channel approvals are enabled.'
      );
      return;
    }
    if (!selectedVerifiedMethod) {
      setActionError('Select a verified UPI ID or verified Bank Account first.');
      return;
    }

    const cleanAmount = Math.round(Number(withdrawAmountInput));
    const errMsg = validateWithdrawalAmountInr(cleanAmount, eligibleInr);
    if (errMsg) {
      setActionError(errMsg);
      return;
    }

    const idempotencyKey =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `wd_${uid}_${crypto.randomUUID()}`
        : `wd_${uid}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    setSubmittingWithdrawal(true);
    try {
      const res = await submitWalletWithdrawal({
        uid,
        userId,
        amountInr: cleanAmount,
        payoutMethod: selectedVerifiedMethod,
        idempotencyKey,
      });
      setWithdrawAmountInput('');
      setActionNotice(
        `Withdrawal request ${res.withdrawalId} for ${formatInr(
          res.amountInr
        )} submitted atomically (Status: Pending).`
      );
      setActiveTab('WITHDRAWALS');
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Unable to submit withdrawal request.'
      );
    } finally {
      setSubmittingWithdrawal(false);
    }
  };

  const openAddPaymentMethod = (type: 'UPI' | 'BANK') => {
    setActionError(null);
    setActionNotice(null);
    if (type === 'UPI') {
      resetUpiForm();
      setActiveTab('UPI');
      setShowUpiForm(true);
    } else {
      resetBankForm();
      setActiveTab('BANK');
      setShowBankForm(true);
    }
  };

  const containerBorder = highContrast
    ? 'border-2 border-slate-900'
    : 'border border-slate-200';

  const tabs: { id: WalletTab; label: string; Icon: typeof Wallet }[] = [
    { id: 'WITHDRAW', label: 'Withdraw INR', Icon: ArrowUpRight },
    { id: 'UPI', label: `Manage UPI (${upiMethods.length})`, Icon: Smartphone },
    { id: 'BANK', label: `Manage Bank (${bankMethods.length})`, Icon: Landmark },
    { id: 'WITHDRAWALS', label: `Withdrawal History (${withdrawals.length})`, Icon: History },
    { id: 'LEDGER', label: 'Wallet Ledger', Icon: CreditCard },
  ];

  return (
    <section
      id="my-wallet"
      aria-labelledby="my-wallet-heading"
      className={`bg-white rounded-xl overflow-hidden ${containerBorder}`}
    >
      {/* Top Wallet Header & Quick Actions */}
      <div className="p-5 sm:p-6 bg-[#0B1A30] text-white border-b border-[#1D3A68]">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#D8B45A] font-semibold">
              <Wallet className="h-4 w-4" aria-hidden="true" />
              <span>My Wallet Control Center</span>
              <span aria-hidden="true">·</span>
              <span className="text-slate-300 font-normal">
                Real-Time Firestore Ledger Sync
              </span>
            </div>
            <h2 id="my-wallet-heading" className="font-display text-xl sm:text-2xl font-bold">
              Segregated Coin &amp; Eligible INR Wallet
            </h2>
            <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
              Purchased Coins, Earned Coins, and Eligible Withdrawable INR are maintained in
              separate audited ledgers. Virtual coins are never automatically converted into INR.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => openAddPaymentMethod('UPI')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0B1A30] bg-[#C59B3B] hover:bg-[#D8B45A] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Add UPI ID</span>
            </button>
            <button
              type="button"
              onClick={() => openAddPaymentMethod('BANK')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white border border-white/25 hover:border-[#C59B3B] hover:bg-white/10 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 text-[#D8B45A]" aria-hidden="true" />
              <span>Add Bank Account</span>
            </button>
          </div>
        </div>
      </div>

      {/* Real-Time Segregated 4-Balance Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border-b border-slate-200 bg-slate-50/70">
        <div className="p-5 space-y-1">
          <p className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
            <Coins className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
            <span>Available Coins</span>
          </p>
          <p className="font-mono text-2xl font-bold text-[#0B1A30] tabular-nums">
            {formatCoins(availableCoins)}
          </p>
          <p className="text-[11px] text-slate-500 font-mono tabular-nums">
            {coinsUsedForPlans > 0
              ? `${formatCoins(coinsUsedForPlans)} allocated in plans`
              : 'Ready for structured plans'}
          </p>
        </div>

        <div className="p-5 space-y-1">
          <p className="text-xs font-medium text-slate-500">Purchased Coins</p>
          <p className="font-mono text-2xl font-bold text-[#0B1A30] tabular-nums">
            {formatCoins(purchasedCoins)}
          </p>
          <p className="text-[11px] text-slate-500 font-mono tabular-nums">
            {pendingTransactionCoins > 0
              ? `${formatCoins(pendingTransactionCoins)} pending review`
              : 'Separate coin purchase ledger'}
          </p>
        </div>

        <div className="p-5 space-y-1">
          <p className="text-xs font-medium text-slate-500">Earned Coins</p>
          <p className="font-mono text-2xl font-bold text-[#A37B22] tabular-nums">
            {formatCoins(earnedCoins)}
          </p>
          <p className="text-[11px] text-slate-500">
            Daily plan rewards · Never auto-converted
          </p>
        </div>

        <div className="p-5 space-y-1 bg-white">
          <p className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
            <IndianRupee className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
            <span>Eligible Withdrawable Balance</span>
          </p>
          <p className="font-mono text-2xl font-bold text-emerald-700 tabular-nums">
            {formatInr(eligibleInr)}
          </p>
          <p className="text-[11px] text-slate-500">
            {payoutStatus.payoutsEnabled
              ? 'Payout channel active'
              : 'Payouts await regulatory review'}
          </p>
        </div>
      </div>

      {/* Interactive Workspace Tab Navigation */}
      <div className="px-5 sm:px-6 pt-4 pb-3 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="User Wallet Control Modules"
          className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto"
        >
          {tabs.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(id)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-white text-[#0B1A30] shadow-xs'
                    : 'text-slate-600 hover:text-[#0B1A30]'
                }`}
              >
                <Icon className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 shrink-0">
          <Lock className="h-3 w-3 text-[#A37B22]" aria-hidden="true" />
          <span>Backend-enforced balance protection</span>
        </div>
      </div>

      {/* Inline Feedback Notices */}
      {(actionError || actionNotice) && (
        <div className="px-5 sm:px-6 pt-4 space-y-2">
          {actionError && (
            <div
              role="alert"
              className="p-3.5 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2"
            >
              <AlertCircle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{actionError}</span>
            </div>
          )}
          {actionNotice && (
            <div
              role="status"
              className="p-3.5 text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-2"
            >
              <CheckCircle2
                className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <span>{actionNotice}</span>
            </div>
          )}
        </div>
      )}

      {/* TAB 1: WALLET-BASED WITHDRAWAL */}
      {activeTab === 'WITHDRAW' && (
        <div className="p-5 sm:p-6 space-y-6">
          {!payoutStatus.payoutsEnabled && (
            <div
              role="status"
              className="p-4 bg-[#F8F1DE]/70 border border-[#C59B3B]/50 rounded-lg flex items-start gap-3 text-xs text-slate-800"
            >
              <ShieldAlert className="h-4 w-4 text-[#8A6518] shrink-0 mt-0.5" aria-hidden="true" />
              <div className="space-y-1">
                <p className="font-semibold text-[#0B1A30]">
                  Real-Money Withdrawals Pending Regulatory &amp; Payment Flow Approval
                </p>
                <p className="text-slate-700 leading-relaxed">
                  {payoutStatus.securityNotice ||
                    'Real-money INR withdrawals are enabled only after business model, payment flow, KYC/AML, and applicable Indian regulatory requirements are reviewed and approved by administration. You can add and verify your UPI ID or Bank Account now to stay ready.'}
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Withdrawal Request Form */}
            <form onSubmit={handleSubmitWithdrawal} className="lg:col-span-7 space-y-4">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200">
                <div>
                  <h3 className="font-display text-base font-bold text-[#0B1A30]">
                    Request Eligible INR Withdrawal
                  </h3>
                  <p className="text-xs text-slate-500">
                    Deducted exclusively from your Eligible Withdrawable INR Balance via an atomic
                    ledger transaction.
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[11px] text-slate-500">Eligible Balance</p>
                  <p className="font-mono text-base font-bold text-emerald-700 tabular-nums">
                    {formatInr(eligibleInr)}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="withdraw-amount-inr"
                    className="block text-xs font-semibold text-[#0B1A30]"
                  >
                    Withdrawal Amount (INR)
                  </label>
                  {eligibleInr >= MIN_WITHDRAWAL_INR && (
                    <button
                      type="button"
                      onClick={() =>
                        setWithdrawAmountInput(
                          String(Math.min(eligibleInr, MAX_WITHDRAWAL_INR))
                        )
                      }
                      className="text-[11px] font-semibold text-[#A37B22] hover:text-[#0B1A30] cursor-pointer"
                    >
                      Use Max ({formatInr(Math.min(eligibleInr, MAX_WITHDRAWAL_INR))})
                    </button>
                  )}
                </div>

                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-mono font-bold text-slate-500">
                    ₹
                  </span>
                  <input
                    id="withdraw-amount-inr"
                    type="number"
                    min={MIN_WITHDRAWAL_INR}
                    max={MAX_WITHDRAWAL_INR}
                    step={1}
                    inputMode="numeric"
                    value={withdrawAmountInput}
                    onChange={(e) => setWithdrawAmountInput(e.target.value)}
                    placeholder={`Enter amount (₹${MIN_WITHDRAWAL_INR} – ₹${MAX_WITHDRAWAL_INR.toLocaleString('en-IN')})`}
                    className="w-full pl-8 pr-4 py-2.5 text-sm font-mono tabular-nums text-[#0B1A30] bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:bg-white focus:border-[#0B1A30]"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {WITHDRAWAL_PRESET_AMOUNTS_INR.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setWithdrawAmountInput(String(preset))}
                      className={`px-3 py-1.5 text-xs font-mono font-semibold rounded-md border transition-colors cursor-pointer whitespace-nowrap ${
                        withdrawAmountInput === String(preset)
                          ? 'bg-[#0B1A30] text-white border-[#0B1A30]'
                          : 'bg-white text-slate-700 border-slate-300 hover:border-[#0B1A30]'
                      }`}
                    >
                      {formatInr(preset)}
                    </button>
                  ))}
                </div>

                {amountValidationError && (
                  <p className="text-xs text-red-700 font-medium">{amountValidationError}</p>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="payout-destination-select"
                    className="block text-xs font-semibold text-[#0B1A30]"
                  >
                    Verified Payout Destination (UPI or Bank Account)
                  </label>
                  <button
                    type="button"
                    onClick={() => setActiveTab('UPI')}
                    className="text-[11px] font-semibold text-[#A37B22] hover:text-[#0B1A30] cursor-pointer"
                  >
                    Manage Payout Methods
                  </button>
                </div>

                {loadingMethods ? (
                  <p className="text-xs text-slate-500">Loading verified payout methods...</p>
                ) : verifiedMethods.length === 0 ? (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
                    <p className="text-xs font-semibold text-[#0B1A30]">
                      No verified UPI ID or Bank Account available yet
                    </p>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {payoutMethods.length > 0
                        ? 'Your saved payout methods are currently pending ownership verification. Payouts are enabled only after verification completes.'
                        : 'Add a UPI ID or Bank Account and complete ownership verification before initiating withdrawals.'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openAddPaymentMethod('UPI')}
                        className="px-3 py-1.5 text-xs font-semibold text-[#0B1A30] bg-[#C59B3B] hover:bg-[#D8B45A] rounded-md cursor-pointer"
                      >
                        Add UPI ID
                      </button>
                      <button
                        type="button"
                        onClick={() => openAddPaymentMethod('BANK')}
                        className="px-3 py-1.5 text-xs font-semibold text-[#0B1A30] bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
                      >
                        Add Bank Account
                      </button>
                    </div>
                  </div>
                ) : (
                  <select
                    id="payout-destination-select"
                    value={selectedPayoutMethodId}
                    onChange={(e) => setSelectedPayoutMethodId(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs font-semibold text-[#0B1A30] bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:bg-white focus:border-[#0B1A30] cursor-pointer"
                  >
                    {verifiedMethods.map((method) => {
                      const masked =
                        method.methodType === 'UPI'
                          ? `${method.upiProvider || 'UPI'} · ${maskUpiId(method.upiId || '')}`
                          : `${method.bankName || 'Bank'} · ${
                              method.accountNumberMasked ||
                              `•••• •••• ${method.accountLast4 || ''}`
                            }`;
                      return (
                        <option key={method.methodId} value={method.methodId}>
                          {method.label} ({masked}){method.isDefault ? ' — Default' : ''}
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>

              <button
                type="submit"
                disabled={
                  submittingWithdrawal ||
                  !payoutStatus.payoutsEnabled ||
                  !selectedVerifiedMethod ||
                  !withdrawAmountInput.trim() ||
                  Boolean(amountValidationError) ||
                  accountStatus !== 'ACTIVE'
                }
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold text-[#0B1A30] bg-[#C59B3B] hover:bg-[#D8B45A] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors cursor-pointer"
              >
                {submittingWithdrawal ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    <span>Processing Atomic Debit...</span>
                  </>
                ) : (
                  <>
                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Submit Withdrawal Request</span>
                  </>
                )}
              </button>
            </form>

            {/* Accounting & Security Guardrails Column */}
            <div className="lg:col-span-5 p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-[#0B1A30]">
                <ShieldCheck className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
                <span>Wallet Accounting &amp; Security Rules</span>
              </div>
              <ul className="space-y-2 text-xs text-slate-600 leading-relaxed">
                <li>
                  • <strong className="text-[#0B1A30]">Independent Wallet:</strong> Your wallet is
                  strictly isolated to UID <span className="font-mono">{userId || uid}</span> and
                  cannot be manually edited.
                </li>
                <li>
                  • <strong className="text-[#0B1A30]">Segregated Assets:</strong> Purchased Coins (
                  <span className="font-mono tabular-nums">{formatCoins(purchasedCoins)}</span>) and
                  Earned Coins (
                  <span className="font-mono tabular-nums">{formatCoins(earnedCoins)}</span>) remain
                  separate from Eligible INR (
                  <span className="font-mono tabular-nums">{formatInr(eligibleInr)}</span>).
                </li>
                <li>
                  • <strong className="text-[#0B1A30]">Atomic Ledger Debit:</strong> Withdrawals
                  deduct from Eligible INR in a single atomic Firestore transaction with unique
                  idempotency keys to block duplicate payouts.
                </li>
                <li>
                  • <strong className="text-[#0B1A30]">Verified Destinations Only:</strong> Unverified
                  UPI IDs and Bank Accounts are blocked from receiving withdrawals.
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: UPI MANAGEMENT */}
      {activeTab === 'UPI' && (
        <div className="p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
            <div>
              <h3 className="font-display text-base font-bold text-[#0B1A30]">
                Manage Personal UPI IDs
              </h3>
              <p className="text-xs text-slate-500">
                Add, update, or remove your UPI handles. Adding or editing a UPI ID resets its
                status to Pending Ownership Verification before payouts.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (showUpiForm && !editingUpiMethodId) {
                  resetUpiForm();
                } else {
                  resetUpiForm();
                  setShowUpiForm(true);
                }
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 text-[#D8B45A]" aria-hidden="true" />
              <span>{showUpiForm && !editingUpiMethodId ? 'Close Form' : 'Add New UPI ID'}</span>
            </button>
          </div>

          {showUpiForm && (
            <form
              onSubmit={handleSaveUpi}
              className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-4"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-[#0B1A30]">
                  {editingUpiMethodId ? 'Update Saved UPI ID' : 'Add New UPI ID'}
                </h4>
                <button
                  type="button"
                  onClick={resetUpiForm}
                  className="text-xs font-semibold text-slate-500 hover:text-[#0B1A30] cursor-pointer"
                >
                  Cancel
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="upi-label" className="block text-xs font-semibold text-[#0B1A30]">
                    Nickname / Label
                  </label>
                  <input
                    id="upi-label"
                    type="text"
                    required
                    minLength={2}
                    maxLength={60}
                    value={upiLabel}
                    onChange={(e) => setUpiLabel(e.target.value)}
                    placeholder="e.g., Primary Google Pay"
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="upi-id-input" className="block text-xs font-semibold text-[#0B1A30]">
                    UPI ID (VPA)
                  </label>
                  <input
                    id="upi-id-input"
                    type="text"
                    required
                    value={upiIdInput}
                    onChange={(e) => setUpiIdInput(e.target.value)}
                    placeholder="yourname@okicici"
                    className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="upi-provider-select"
                    className="block text-xs font-semibold text-[#0B1A30]"
                  >
                    UPI App / Provider
                  </label>
                  <select
                    id="upi-provider-select"
                    value={upiProvider}
                    onChange={(e) => setUpiProvider(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30] cursor-pointer"
                  >
                    {UPI_HANDLE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={upiMakeDefault}
                    onChange={(e) => setUpiMakeDefault(e.target.checked)}
                    className="rounded border-slate-300 text-[#0B1A30]"
                  />
                  <span>Set as default payout method</span>
                </label>

                <button
                  type="submit"
                  disabled={savingUpi}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-[#0B1A30] bg-[#C59B3B] hover:bg-[#D8B45A] disabled:opacity-50 rounded-lg cursor-pointer"
                >
                  {savingUpi && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                  <span>{editingUpiMethodId ? 'Update UPI ID' : 'Save UPI ID'}</span>
                </button>
              </div>
            </form>
          )}

          {loadingMethods ? (
            <div className="py-6 text-xs text-slate-500">Loading saved UPI IDs...</div>
          ) : methodsError ? (
            <div role="alert" className="p-4 text-xs text-red-700 bg-red-50 rounded-lg">
              {methodsError}
            </div>
          ) : upiMethods.length === 0 ? (
            <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <Smartphone className="h-6 w-6 text-[#A37B22] mx-auto" aria-hidden="true" />
              <div className="space-y-1 max-w-md mx-auto">
                <p className="text-sm font-semibold text-[#0B1A30]">No UPI IDs saved yet</p>
                <p className="text-xs text-slate-500">
                  Add a personal UPI ID to prepare for verified INR withdrawals once payouts are
                  enabled.
                </p>
              </div>
              <button
                type="button"
                onClick={() => openAddPaymentMethod('UPI')}
                className="px-4 py-2 text-xs font-bold text-[#0B1A30] bg-[#C59B3B] hover:bg-[#D8B45A] rounded-lg cursor-pointer"
              >
                Add First UPI ID
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
              {upiMethods.map((method) => {
                const verifyMeta = getVerificationVisual(method.verificationStatus);
                const VerifyIcon = verifyMeta.Icon;
                const isBusy = busyMethodId === method.methodId;

                return (
                  <div
                    key={method.methodId}
                    className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/70"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-bold text-sm text-[#0B1A30]">{method.label}</span>
                        {method.isDefault && (
                          <>
                            <span aria-hidden="true" className="text-slate-300">
                              ·
                            </span>
                            <span className="inline-flex items-center gap-1 font-semibold text-[#A37B22]">
                              <Star className="h-3 w-3" aria-hidden="true" />
                              <span>Default</span>
                            </span>
                          </>
                        )}
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 font-semibold ${verifyMeta.textClass}`}
                        >
                          <VerifyIcon className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{verifyMeta.label}</span>
                        </span>
                      </div>
                      <p className="text-xs font-mono text-slate-700">
                        {method.upiProvider || 'UPI'} · {maskUpiId(method.upiId || '')}
                      </p>
                      {method.verificationNote && (
                        <p className="text-[11px] text-slate-500">{method.verificationNote}</p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {!method.isDefault && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleSetDefaultMethod(method)}
                          className="px-3 py-1.5 text-xs font-semibold text-[#0B1A30] border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer disabled:opacity-50"
                        >
                          Set Default
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleEditUpi(method)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-[#0B1A30] border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer disabled:opacity-50"
                      >
                        <Edit3 className="h-3 w-3" aria-hidden="true" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleDeleteMethod(method)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-md cursor-pointer disabled:opacity-50"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                        <span>Remove</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: BANK ACCOUNT MANAGEMENT */}
      {activeTab === 'BANK' && (
        <div className="p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
            <div>
              <h3 className="font-display text-base font-bold text-[#0B1A30]">
                Manage Bank Accounts (Masked Storage Display)
              </h3>
              <p className="text-xs text-slate-500">
                Complete account numbers are never displayed publicly. Adding or replacing a bank
                account requires ownership verification before withdrawals are enabled.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (showBankForm && !editingBankMethodId) {
                  resetBankForm();
                } else {
                  resetBankForm();
                  setShowBankForm(true);
                }
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 text-[#D8B45A]" aria-hidden="true" />
              <span>
                {showBankForm && !editingBankMethodId ? 'Close Form' : 'Add Bank Account'}
              </span>
            </button>
          </div>

          {showBankForm && (
            <form
              onSubmit={handleSaveBank}
              className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-4"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-[#0B1A30]">
                  {editingBankMethodId
                    ? 'Update / Replace Saved Bank Account'
                    : 'Add New Bank Account'}
                </h4>
                <button
                  type="button"
                  onClick={resetBankForm}
                  className="text-xs font-semibold text-slate-500 hover:text-[#0B1A30] cursor-pointer"
                >
                  Cancel
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="bank-label-input"
                    className="block text-xs font-semibold text-[#0B1A30]"
                  >
                    Account Label
                  </label>
                  <input
                    id="bank-label-input"
                    type="text"
                    required
                    minLength={2}
                    maxLength={60}
                    value={bankLabel}
                    onChange={(e) => setBankLabel(e.target.value)}
                    placeholder="e.g., HDFC Primary Savings"
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="bank-holder-input"
                    className="block text-xs font-semibold text-[#0B1A30]"
                  >
                    Account Holder Full Name
                  </label>
                  <input
                    id="bank-holder-input"
                    type="text"
                    required
                    minLength={2}
                    maxLength={80}
                    value={accountHolderName}
                    onChange={(e) => setAccountHolderName(e.target.value)}
                    placeholder="As per bank passbook"
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="bank-name-input"
                    className="block text-xs font-semibold text-[#0B1A30]"
                  >
                    Bank Name
                  </label>
                  <input
                    id="bank-name-input"
                    type="text"
                    required
                    minLength={2}
                    maxLength={80}
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="e.g., HDFC Bank / SBI / ICICI"
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="bank-account-number"
                    className="block text-xs font-semibold text-[#0B1A30]"
                  >
                    Account Number
                  </label>
                  <input
                    id="bank-account-number"
                    type="password"
                    autoComplete="off"
                    required
                    inputMode="numeric"
                    minLength={9}
                    maxLength={18}
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
                    placeholder="9–18 numeric digits"
                    className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="bank-account-confirm"
                    className="block text-xs font-semibold text-[#0B1A30]"
                  >
                    Confirm Account Number
                  </label>
                  <input
                    id="bank-account-confirm"
                    type="text"
                    autoComplete="off"
                    required
                    inputMode="numeric"
                    minLength={9}
                    maxLength={18}
                    value={confirmAccountNumber}
                    onChange={(e) => setConfirmAccountNumber(e.target.value.replace(/\D/g, ''))}
                    placeholder="Re-enter account number"
                    className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="bank-ifsc-input"
                    className="block text-xs font-semibold text-[#0B1A30]"
                  >
                    IFSC Code
                  </label>
                  <input
                    id="bank-ifsc-input"
                    type="text"
                    required
                    maxLength={11}
                    value={ifscCode}
                    onChange={(e) => setIfscCode(e.target.value.toUpperCase())}
                    placeholder="HDFC0001234"
                    className="w-full px-3 py-2 text-xs font-mono uppercase bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="inline-flex items-center gap-2 text-xs">
                    <span className="font-semibold text-[#0B1A30]">Account Type:</span>
                    <select
                      aria-label="Bank account type"
                      value={accountType}
                      onChange={(e) =>
                        setAccountType(e.target.value === 'CURRENT' ? 'CURRENT' : 'SAVINGS')
                      }
                      className="px-2.5 py-1.5 text-xs font-semibold bg-white border border-slate-300 rounded-md cursor-pointer"
                    >
                      <option value="SAVINGS">Savings</option>
                      <option value="CURRENT">Current</option>
                    </select>
                  </div>

                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={bankMakeDefault}
                      onChange={(e) => setBankMakeDefault(e.target.checked)}
                      className="rounded border-slate-300 text-[#0B1A30]"
                    />
                    <span>Set as default payout method</span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={savingBank}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-[#0B1A30] bg-[#C59B3B] hover:bg-[#D8B45A] disabled:opacity-50 rounded-lg cursor-pointer"
                >
                  {savingBank && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                  <span>
                    {editingBankMethodId ? 'Replace Bank Account' : 'Save Bank Account'}
                  </span>
                </button>
              </div>
            </form>
          )}

          {loadingMethods ? (
            <div className="py-6 text-xs text-slate-500">Loading saved bank accounts...</div>
          ) : methodsError ? (
            <div role="alert" className="p-4 text-xs text-red-700 bg-red-50 rounded-lg">
              {methodsError}
            </div>
          ) : bankMethods.length === 0 ? (
            <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <Building2 className="h-6 w-6 text-[#A37B22] mx-auto" aria-hidden="true" />
              <div className="space-y-1 max-w-md mx-auto">
                <p className="text-sm font-semibold text-[#0B1A30]">
                  No bank accounts linked yet
                </p>
                <p className="text-xs text-slate-500">
                  Link a bank account for verified INR payouts. Account numbers are masked publicly
                  to protect sensitive details.
                </p>
              </div>
              <button
                type="button"
                onClick={() => openAddPaymentMethod('BANK')}
                className="px-4 py-2 text-xs font-bold text-[#0B1A30] bg-[#C59B3B] hover:bg-[#D8B45A] rounded-lg cursor-pointer"
              >
                Link Bank Account
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
              {bankMethods.map((method) => {
                const verifyMeta = getVerificationVisual(method.verificationStatus);
                const VerifyIcon = verifyMeta.Icon;
                const isBusy = busyMethodId === method.methodId;
                const maskedDisplay =
                  method.accountNumberMasked ||
                  maskBankAccountNumber(method.accountLast4 || '');

                return (
                  <div
                    key={method.methodId}
                    className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/70"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-bold text-sm text-[#0B1A30]">{method.label}</span>
                        {method.isDefault && (
                          <>
                            <span aria-hidden="true" className="text-slate-300">
                              ·
                            </span>
                            <span className="inline-flex items-center gap-1 font-semibold text-[#A37B22]">
                              <Star className="h-3 w-3" aria-hidden="true" />
                              <span>Default</span>
                            </span>
                          </>
                        )}
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 font-semibold ${verifyMeta.textClass}`}
                        >
                          <VerifyIcon className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>{verifyMeta.label}</span>
                        </span>
                      </div>
                      <p className="text-xs font-mono text-slate-700">
                        {method.bankName || 'Bank'} · {maskedDisplay} · IFSC:{' '}
                        {method.ifscCode || '—'} · {method.accountType || 'SAVINGS'}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Holder: {method.accountHolderName || 'Member'}
                        {method.verificationNote ? ` · ${method.verificationNote}` : ''}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {!method.isDefault && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleSetDefaultMethod(method)}
                          className="px-3 py-1.5 text-xs font-semibold text-[#0B1A30] border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer disabled:opacity-50"
                        >
                          Set Default
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleEditBank(method)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-[#0B1A30] border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer disabled:opacity-50"
                      >
                        <Edit3 className="h-3 w-3" aria-hidden="true" />
                        <span>Replace</span>
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleDeleteMethod(method)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 rounded-md cursor-pointer disabled:opacity-50"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                        <span>Remove</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: WITHDRAWAL HISTORY */}
      {activeTab === 'WITHDRAWALS' && (
        <div className="divide-y divide-slate-200">
          <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-bold text-[#0B1A30]">
                Withdrawal History
              </h3>
              <p className="text-xs text-slate-500">
                Audited INR payout requests showing Pending, Processing, Approved, Rejected, or
                Completed status.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('WITHDRAW')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0B1A30] border border-slate-300 hover:bg-slate-50 rounded-lg self-start sm:self-auto cursor-pointer"
            >
              <ArrowUpRight className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
              <span>New Withdrawal</span>
            </button>
          </div>

          {loadingWithdrawals ? (
            <div className="p-6 text-xs text-slate-500">Loading withdrawal history...</div>
          ) : withdrawalsError ? (
            <div role="alert" className="p-6 text-xs text-red-700 bg-red-50">
              {withdrawalsError}
            </div>
          ) : withdrawals.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <History className="h-6 w-6 text-[#A37B22] mx-auto" aria-hidden="true" />
              <p className="text-sm font-semibold text-[#0B1A30]">
                No withdrawal requests submitted yet
              </p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Submitted INR withdrawals to your verified UPI ID or Bank Account will appear here
                with live status tracking.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[660px] border-collapse text-left">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th scope="col" className="py-3 px-5 whitespace-nowrap">
                      Requested Date
                    </th>
                    <th scope="col" className="py-3 px-4">
                      Payout Destination
                    </th>
                    <th scope="col" className="py-3 px-4 text-right whitespace-nowrap">
                      Amount
                    </th>
                    <th scope="col" className="py-3 px-5 whitespace-nowrap">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {withdrawals.map((wd) => {
                    const statusMeta = getWithdrawalStatusDisplay(wd.status);
                    const toneClass = getWithdrawalToneClass(statusMeta.tone);
                    return (
                      <tr key={wd.withdrawalId} className="hover:bg-slate-50/70">
                        <td className="py-3 px-5 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {formatDateTimeInr(wd.createdAt)}
                        </td>
                        <td className="py-3 px-4 max-w-xs">
                          <p className="font-semibold text-[#0B1A30] truncate">
                            {wd.payoutDestinationMasked || wd.payoutLabel || 'Verified Payout'}
                          </p>
                          <p className="text-[11px] text-slate-500 font-mono truncate">
                            Ref: {wd.withdrawalId}
                            {wd.remarks ? ` · ${wd.remarks}` : ''}
                          </p>
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-[#0B1A30] tabular-nums whitespace-nowrap">
                          {formatInr(wd.amountInr)}
                        </td>
                        <td className={`py-3 px-5 font-semibold whitespace-nowrap ${toneClass}`}>
                          {statusMeta.label}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 5: WALLET LEDGER PREVIEW */}
      {activeTab === 'LEDGER' && (
        <div className="divide-y divide-slate-200">
          <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="font-display text-base font-bold text-[#0B1A30]">
                Complete Wallet Transaction Ledger
              </h3>
              <p className="text-xs text-slate-500">
                Real-time immutable ledger of coin deposits, plan allocations, rewards, and INR
                withdrawals.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href="#investment-history"
                className="px-3 py-1.5 text-xs font-semibold text-[#0B1A30] border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap"
              >
                View Investment History
              </a>
              <a
                href="#tx-history-heading"
                className="px-3 py-1.5 text-xs font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] rounded-md whitespace-nowrap"
              >
                Full Transaction Export
              </a>
            </div>
          </div>

          {loadingTx ? (
            <div className="p-6 text-xs text-slate-500">Syncing wallet ledger...</div>
          ) : walletTransactions.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <CreditCard className="h-6 w-6 text-[#A37B22] mx-auto" aria-hidden="true" />
              <p className="text-sm font-semibold text-[#0B1A30]">
                No wallet ledger entries recorded yet
              </p>
              <p className="text-xs text-slate-500">
                Every coin deposit, plan enrollment, daily reward, and withdrawal request is
                recorded here with before/after balances.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[660px] border-collapse text-left">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th scope="col" className="py-3 px-5 whitespace-nowrap">
                      Date
                    </th>
                    <th scope="col" className="py-3 px-4">
                      Description
                    </th>
                    <th scope="col" className="py-3 px-4 text-right whitespace-nowrap">
                      Amount
                    </th>
                    <th scope="col" className="py-3 px-5 whitespace-nowrap">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {walletTransactions.slice(0, 10).map((tx) => {
                    const isInr = tx.assetType === 'INR';
                    const isDebit =
                      tx.amount < 0 ||
                      tx.type === 'WITHDRAWAL_REQUEST' ||
                      tx.type === 'PLAN_INVESTMENT';
                    const abs = Math.abs(Math.round(tx.amount));
                    const formattedAmt = isInr ? formatInr(abs) : formatCoins(abs);
                    return (
                      <tr key={tx.transactionId} className="hover:bg-slate-50/70">
                        <td className="py-3 px-5 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {formatDateTimeInr(tx.createdAt)}
                        </td>
                        <td className="py-3 px-4 max-w-xs">
                          <p className="font-semibold text-[#0B1A30] truncate">
                            {tx.description || tx.type}
                          </p>
                          <p className="text-[11px] text-slate-500 font-mono truncate">
                            {tx.assetType || 'COINS'} · Ref: {tx.referenceId || tx.transactionId}
                          </p>
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-mono font-bold tabular-nums whitespace-nowrap ${
                            isDebit ? 'text-[#0B1A30]' : 'text-emerald-700'
                          }`}
                        >
                          {isDebit ? `-${formattedAmt}` : `+${formattedAmt}`}
                        </td>
                        <td className="py-3 px-5 font-semibold text-slate-700 whitespace-nowrap">
                          {tx.status}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
