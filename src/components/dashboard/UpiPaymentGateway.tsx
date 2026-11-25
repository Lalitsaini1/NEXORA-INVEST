import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Coins,
  Copy,
  ExternalLink,
  Lock,
  QrCode,
  ShieldCheck,
  Smartphone,
  XCircle,
} from 'lucide-react';
import {
  DEFAULT_GATEWAY_RUNTIME_CONFIG,
  GatewayRuntimeConfig,
  subscribeActiveCoinPackages,
  subscribeActiveUpiAccounts,
  subscribeGatewayRuntimeConfig,
  subscribeUserDeposits,
  subscribeUserPaymentTransactions,
  submitUpiDepositRequest,
} from '../../services/depositService';
import {
  CoinPackageRecord,
  DepositRequest,
  DepositStatus,
  PaymentTransactionRecord,
  UpiAccount,
} from '../../types/domain';
import { formatCoins, formatDateTimeInr, formatInr } from '../../utils/formatters';
import {
  buildCoinPackagesFromCsv,
  buildUpiPaymentIntentUrl,
  calculateCoinsForDepositInr,
  coinPackageRecordToOption,
  evaluateUpiGatewayAvailability,
  getExchangeRateLabel,
  normalizeUtrReference,
  SupportedUpiApp,
  validateDepositAmountInr,
  validateUtrReference,
} from '../../utils/upiGateway';

interface UpiPaymentGatewayProps {
  uid: string;
  userId?: string;
  availableCoins: number;
  highContrast?: boolean;
}

const UPI_APPS: { id: SupportedUpiApp; label: string }[] = [
  { id: 'GPAY', label: 'Google Pay' },
  { id: 'PHONEPE', label: 'PhonePe' },
  { id: 'PAYTM', label: 'Paytm' },
  { id: 'BHIM', label: 'BHIM' },
  { id: 'GENERIC', label: 'Other UPI App' },
];

function getDepositStatusMeta(status: DepositStatus): {
  label: string;
  className: string;
  Icon: typeof Clock;
} {
  switch (status) {
    case 'APPROVED':
      return {
        label: 'Successful · Credited',
        className: 'bg-emerald-50 text-emerald-800 border-emerald-200',
        Icon: CheckCircle2,
      };
    case 'REJECTED':
      return {
        label: 'Failed / Rejected',
        className: 'bg-red-50 text-red-700 border-red-200',
        Icon: XCircle,
      };
    case 'UNDER_REVIEW':
      return {
        label: 'Verifying Settlement',
        className: 'bg-amber-50 text-amber-800 border-amber-200',
        Icon: Clock,
      };
    case 'PENDING':
    default:
      return {
        label: 'Pending Verification',
        className: 'bg-[#F8F1DE] text-[#8A6518] border-[#C59B3B]/50',
        Icon: Clock,
      };
  }
}

export function UpiPaymentGateway({
  uid,
  userId,
  availableCoins,
  highContrast = false,
}: UpiPaymentGatewayProps) {
  const [runtimeConfig, setRuntimeConfig] = useState<GatewayRuntimeConfig>(
    DEFAULT_GATEWAY_RUNTIME_CONFIG
  );
  const [upiAccounts, setUpiAccounts] = useState<UpiAccount[]>([]);
  const [selectedUpiId, setSelectedUpiId] = useState<string>('');
  const [loadingUpi, setLoadingUpi] = useState(true);

  const [deposits, setDeposits] = useState<DepositRequest[]>([]);
  const [paymentTxs, setPaymentTxs] = useState<PaymentTransactionRecord[]>([]);
  const [configuredPackages, setConfiguredPackages] = useState<CoinPackageRecord[]>([]);
  const [loadingDeposits, setLoadingDeposits] = useState(true);

  const dynamicPackages = useMemo(() => {
    const activeConfigured = configuredPackages
      .filter(
        (p) =>
          p.isActive &&
          p.priceInr >= runtimeConfig.minDepositInr &&
          p.priceInr <= runtimeConfig.maxDepositInr
      )
      .map(coinPackageRecordToOption);
    if (activeConfigured.length > 0) {
      return activeConfigured;
    }
    return buildCoinPackagesFromCsv(
      runtimeConfig.coinPackagesCsv,
      runtimeConfig.minDepositInr,
      runtimeConfig.maxDepositInr
    );
  }, [configuredPackages, runtimeConfig]);

  const [selectedPackageId, setSelectedPackageId] = useState<string>('');
  const [amountInput, setAmountInput] = useState<string>('1000');
  const [utrInput, setUtrInput] = useState<string>('');
  const [copiedUpi, setCopiedUpi] = useState(false);

  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [gatewayReadError, setGatewayReadError] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  useEffect(() => {
    if (dynamicPackages.length > 0 && !selectedPackageId) {
      const preferred = dynamicPackages[Math.min(2, dynamicPackages.length - 1)];
      setSelectedPackageId(preferred.id);
      setAmountInput(String(preferred.amountInr));
    }
  }, [dynamicPackages, selectedPackageId]);

  useEffect(() => {
    if (!uid) return;
    setLoadingUpi(true);
    setGatewayReadError(null);
    const unsubConfig = subscribeGatewayRuntimeConfig(
      (cfg) => setRuntimeConfig(cfg),
      (msg) => setGatewayReadError((prev) => prev || msg)
    );
    const unsubUpi = subscribeActiveUpiAccounts(
      (accounts) => {
        setUpiAccounts(accounts);
        setGatewayReadError(null);
        setSelectedUpiId((prev) => {
          if (prev && accounts.some((a) => a.accountId === prev)) {
            return prev;
          }
          return accounts[0]?.accountId || '';
        });
        setLoadingUpi(false);
      },
      (msg) => {
        setGatewayReadError(msg);
        setLoadingUpi(false);
      }
    );

    setLoadingDeposits(true);
    const unsubDeposits = subscribeUserDeposits(
      uid,
      (items) => {
        setDeposits(items);
        setLoadingDeposits(false);
      },
      (msg) => {
        setErrorMsg((prev) => prev || msg);
        setLoadingDeposits(false);
      }
    );

    const unsubPaymentTxs = subscribeUserPaymentTransactions(
      uid,
      (items) => setPaymentTxs(items),
      () => {}
    );

    const unsubCoinPackages = subscribeActiveCoinPackages(
      (items) => setConfiguredPackages(items),
      () => {}
    );

    return () => {
      unsubConfig();
      unsubUpi();
      unsubDeposits();
      unsubPaymentTxs();
      unsubCoinPackages();
    };
  }, [uid]);

  const paymentTxByDepositId = useMemo(() => {
    const map = new Map<string, PaymentTransactionRecord>();
    for (const tx of paymentTxs) {
      map.set(tx.depositId, tx);
    }
    return map;
  }, [paymentTxs]);

  const activeAccount = useMemo(
    () => upiAccounts.find((a) => a.accountId === selectedUpiId) || upiAccounts[0] || null,
    [upiAccounts, selectedUpiId]
  );

  const parsedAmountInr = useMemo(() => {
    const cleaned = Number(amountInput);
    if (!Number.isFinite(cleaned)) return 0;
    return Math.round(cleaned);
  }, [amountInput]);

  const amountValidationError = useMemo(() => {
    if (!amountInput.trim()) return 'Enter a deposit amount in INR.';
    return validateDepositAmountInr(
      Number(amountInput),
      runtimeConfig.minDepositInr,
      runtimeConfig.maxDepositInr
    );
  }, [amountInput, runtimeConfig.minDepositInr, runtimeConfig.maxDepositInr]);

  const activeSelectedPackage = useMemo(() => {
    if (!selectedPackageId || selectedPackageId === 'CUSTOM') return null;
    return (
      dynamicPackages.find(
        (p) => p.id === selectedPackageId && p.amountInr === parsedAmountInr
      ) || null
    );
  }, [dynamicPackages, selectedPackageId, parsedAmountInr]);

  const previewBaseCoins = useMemo(() => {
    if (amountValidationError) return 0;
    return calculateCoinsForDepositInr(parsedAmountInr);
  }, [amountValidationError, parsedAmountInr]);

  const previewBonusCoins = useMemo(() => {
    if (amountValidationError || !activeSelectedPackage) return 0;
    return activeSelectedPackage.bonusCoins || 0;
  }, [amountValidationError, activeSelectedPackage]);

  const previewCoins = useMemo(() => {
    if (amountValidationError) return 0;
    return previewBaseCoins + previewBonusCoins;
  }, [amountValidationError, previewBaseCoins, previewBonusCoins]);

  const txRefTag = useMemo(() => {
    const cleanId = (userId || uid.slice(0, 8)).replace(/[^a-zA-Z0-9]/g, '');
    return `NX${cleanId}_${parsedAmountInr || runtimeConfig.minDepositInr}`.slice(0, 32);
  }, [userId, uid, parsedAmountInr, runtimeConfig.minDepositInr]);

  const standardUpiIntentUrl = useMemo(() => {
    if (!runtimeConfig.upiDepositsEnabled || !activeAccount || amountValidationError) return '';
    return buildUpiPaymentIntentUrl(
      {
        upiId: activeAccount.upiId,
        displayName: activeAccount.displayName,
        amountInr: parsedAmountInr,
        transactionRef: txRefTag,
        note: `NEXORA ${userId || ''} ${previewCoins} Coins`.trim(),
      },
      'GENERIC'
    );
  }, [
    runtimeConfig.upiDepositsEnabled,
    activeAccount,
    amountValidationError,
    parsedAmountInr,
    previewCoins,
    txRefTag,
    userId,
  ]);

  useEffect(() => {
    let active = true;
    if (!standardUpiIntentUrl) {
      setQrDataUrl('');
      return () => {
        active = false;
      };
    }

    QRCode.toDataURL(standardUpiIntentUrl, {
      width: 220,
      margin: 2,
      color: {
        dark: '#0B1A30',
        light: '#FFFFFF',
      },
    })
      .then((dataUrl) => {
        if (active) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });

    return () => {
      active = false;
    };
  }, [standardUpiIntentUrl]);

  const handleSelectPackage = (pkgId: string, amountInr: number) => {
    setSelectedPackageId(pkgId);
    setAmountInput(String(amountInr));
    setErrorMsg(null);
  };

  const handleCustomAmountChange = (val: string) => {
    const digitsOnly = val.replace(/\D/g, '');
    setAmountInput(digitsOnly);
    const num = Number(digitsOnly);
    const matchingPkg = dynamicPackages.find((p) => p.amountInr === num);
    setSelectedPackageId(matchingPkg ? matchingPkg.id : 'CUSTOM');
    setErrorMsg(null);
  };

  const handleCopyUpi = async () => {
    if (!activeAccount?.upiId) return;
    try {
      await navigator.clipboard.writeText(activeAccount.upiId);
      setCopiedUpi(true);
      window.setTimeout(() => setCopiedUpi(false), 2200);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleSubmitDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setNoticeMsg(null);

    if (!runtimeConfig.upiDepositsEnabled) {
      setErrorMsg('UPI deposits are currently paused by platform administration.');
      return;
    }
    if (!userId || !/^NX[0-9]{6,10}$/.test(userId)) {
      setErrorMsg('Your NX User ID is still initializing. Please wait a moment and retry.');
      return;
    }
    if (!activeAccount) {
      setErrorMsg('No active authorized UPI payment endpoint is currently available.');
      return;
    }
    if (amountValidationError) {
      setErrorMsg(amountValidationError);
      return;
    }

    const utrError = validateUtrReference(utrInput);
    if (utrError) {
      setErrorMsg(utrError);
      return;
    }

    const normalizedUtr = normalizeUtrReference(utrInput);
    const duplicateOrder = deposits.find(
      (d) => d.utrNumber?.toUpperCase() === normalizedUtr && d.status !== 'REJECTED'
    );
    if (duplicateOrder) {
      setErrorMsg(
        `UTR reference ${normalizedUtr} is already linked to order ${duplicateOrder.depositId} (${duplicateOrder.status}).`
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await submitUpiDepositRequest({
        uid,
        userId,
        amountInr: parsedAmountInr,
        upiAccount: activeAccount,
        utrNumber: normalizedUtr,
        packageId: activeSelectedPackage?.packageId,
        minDepositInr: runtimeConfig.minDepositInr,
        maxDepositInr: runtimeConfig.maxDepositInr,
      });
      setUtrInput('');
      setNoticeMsg(
        `Order ${res.depositId} (${res.paymentTxId}) created for ${formatCoins(res.coinsRequested)} via atomic Firestore transaction. Wallet balance credits after verified settlement.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to submit UPI deposit request.');
    } finally {
      setSubmitting(false);
    }
  };

  const gatewayStatus = useMemo(
    () =>
      evaluateUpiGatewayAvailability({
        loading: loadingUpi,
        upiDepositsEnabled: runtimeConfig.upiDepositsEnabled,
        hasActiveEndpoint: Boolean(activeAccount),
        readErrorMessage: gatewayReadError,
      }),
    [loadingUpi, runtimeConfig.upiDepositsEnabled, activeAccount, gatewayReadError]
  );

  return (
    <section
      id="add-coins-gateway"
      aria-labelledby="upi-gateway-heading"
      className={`bg-white rounded-xl overflow-hidden ${
        highContrast ? 'border-2 border-slate-900' : 'border border-slate-200'
      }`}
    >
      {/* Header & Applicable Conversion Rate */}
      <div className="p-5 sm:p-6 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2
            id="upi-gateway-heading"
            className="font-display text-lg font-bold text-[#0B1A30] flex items-center gap-2"
          >
            <Coins className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
            <span>Add Virtual Coins via Authorized UPI Gateway</span>
          </h2>
          <p className="text-xs text-slate-600">
            Select a Firestore-configured coin package or enter an INR amount, scan the dynamic
            UPI QR or launch a mobile UPI app, and submit your UTR reference for atomic verification.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="px-3.5 py-2 rounded-lg bg-[#F8F1DE] border border-[#C59B3B]/60 text-xs">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8A6518]">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600"
                aria-hidden="true"
              />
              <span>Real-Time Exchange Rate</span>
            </span>
            <span className="font-mono font-bold text-[#0B1A30] tabular-nums">
              {getExchangeRateLabel()}
            </span>
            <span className="block text-[10px] text-slate-600 mt-0.5">
              {runtimeConfig.settingsDocExists && runtimeConfig.syncedAt
                ? `Live Firestore Sync · ${formatDateTimeInr(runtimeConfig.syncedAt)}`
                : 'Default Parity Rules (Admin Config Pending)'}
            </span>
          </div>
          <div className="px-3.5 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Current Wallet
            </span>
            <span className="font-mono font-bold text-[#0B1A30] tabular-nums">
              {formatCoins(availableCoins)}
            </span>
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-6 space-y-6">
        {errorMsg && (
          <div
            role="alert"
            className="p-3.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}

        {noticeMsg && (
          <div
            role="status"
            className="p-3.5 text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-2"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{noticeMsg}</span>
          </div>
        )}

        {gatewayStatus.reason === 'LOADING' ? (
          <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500">
            {gatewayStatus.detail}
          </div>
        ) : !gatewayStatus.ready ? (
          <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl flex items-start gap-3 text-xs text-slate-700">
            <Lock className="h-4 w-4 text-[#A37B22] shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-bold text-[#0B1A30]">{gatewayStatus.headline}</p>
              <p className="text-slate-600">{gatewayStatus.detail}</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Package Selection, Custom Amount, & UTR Confirmation */}
            <form onSubmit={handleSubmitDeposit} className="lg:col-span-7 space-y-5">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-[#0B1A30]">
                    1. Select Coin Package
                  </label>
                  <span className="text-[11px] font-mono text-slate-500">
                    Min {formatInr(runtimeConfig.minDepositInr)} · Max{' '}
                    {formatInr(runtimeConfig.maxDepositInr)}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {dynamicPackages.map((pkg) => {
                    const selected =
                      selectedPackageId === pkg.id && parsedAmountInr === pkg.amountInr;
                    return (
                      <button
                        key={pkg.id}
                        type="button"
                        onClick={() => handleSelectPackage(pkg.id, pkg.amountInr)}
                        className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                          selected
                            ? 'bg-[#0B1A30] text-white border-[#0B1A30]'
                            : 'bg-slate-50 text-[#0B1A30] border-slate-200 hover:border-[#C59B3B]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className={`text-[10px] font-semibold uppercase ${
                              selected ? 'text-[#D8B45A]' : 'text-slate-500'
                            }`}
                          >
                            {pkg.label}
                          </span>
                          {pkg.tag && (
                            <span
                              className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                                selected
                                  ? 'bg-[#C59B3B] text-[#0B1A30]'
                                  : 'bg-[#F8F1DE] text-[#8A6518]'
                              }`}
                            >
                              {pkg.tag}
                            </span>
                          )}
                        </div>
                        <p className="font-mono text-base font-bold tabular-nums mt-1">
                          {formatInr(pkg.amountInr)}
                        </p>
                        <p
                          className={`font-mono text-[11px] tabular-nums ${
                            selected ? 'text-slate-200' : 'text-slate-600'
                          }`}
                        >
                          +{pkg.baseCoins.toLocaleString('en-IN')} Coins
                          {pkg.bonusCoins > 0
                            ? ` (+${pkg.bonusCoins.toLocaleString('en-IN')} Bonus)`
                            : ''}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="upi-custom-amount"
                    className="block text-xs font-semibold text-[#0B1A30] mb-1.5"
                  >
                    Custom Deposit Amount (INR ₹)
                  </label>
                  <input
                    id="upi-custom-amount"
                    type="text"
                    inputMode="numeric"
                    value={amountInput}
                    onChange={(e) => handleCustomAmountChange(e.target.value)}
                    placeholder="e.g. 1000"
                    className="w-full px-3.5 py-2.5 text-sm font-mono font-semibold text-[#0B1A30] bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
                  />
                  {amountValidationError && (
                    <p className="text-[11px] text-red-700 mt-1">{amountValidationError}</p>
                  )}
                </div>

                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg flex flex-col justify-center">
                  <span className="text-[11px] font-semibold text-slate-500">
                    Verified Coin Credit Allocation
                  </span>
                  <span className="font-mono text-xl font-bold text-[#0B1A30] tabular-nums mt-0.5">
                    +{formatCoins(previewCoins)}
                  </span>
                  {previewBonusCoins > 0 && (
                    <span className="text-[11px] font-mono text-[#8A6518] mt-0.5">
                      Includes +{previewBonusCoins.toLocaleString('en-IN')} Package Bonus Coins
                    </span>
                  )}
                </div>
              </div>

              {upiAccounts.length > 1 && activeAccount && (
                <div>
                  <label
                    htmlFor="upi-endpoint-select"
                    className="block text-xs font-semibold text-[#0B1A30] mb-1.5"
                  >
                    Authorized Collection Endpoint
                  </label>
                  <select
                    id="upi-endpoint-select"
                    value={activeAccount.accountId}
                    onChange={(e) => setSelectedUpiId(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs font-mono text-[#0B1A30] bg-white border border-slate-300 rounded-lg cursor-pointer"
                  >
                    {upiAccounts.map((acc) => (
                      <option key={acc.accountId} value={acc.accountId}>
                        {acc.displayName} ({acc.upiId})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Step 3: UTR Reference Submission */}
              <div className="pt-2 border-t border-slate-200 space-y-3">
                <div>
                  <label
                    htmlFor="upi-utr-input"
                    className="block text-xs font-bold uppercase tracking-wider text-[#0B1A30] mb-1"
                  >
                    3. Submit Verified UPI / UTR Transaction Reference
                  </label>
                  <p className="text-[11px] text-slate-500 mb-2">
                    Complete payment via QR or your UPI app first, then enter the 12-digit UTR /
                    UPI Reference ID shown on your payment receipt. Never enter a UPI PIN here.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <input
                      id="upi-utr-input"
                      type="text"
                      required
                      minLength={8}
                      maxLength={36}
                      value={utrInput}
                      onChange={(e) => setUtrInput(e.target.value.toUpperCase())}
                      placeholder="12-digit UTR / UPI Ref (e.g. 412345678901)"
                      className="flex-1 px-3.5 py-2.5 text-xs font-mono uppercase tracking-wider text-[#0B1A30] bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
                    />
                    <button
                      type="submit"
                      disabled={submitting || Boolean(amountValidationError)}
                      className="px-5 py-2.5 text-xs font-bold text-[#0B1A30] bg-[#C59B3B] hover:bg-[#D8B45A] disabled:opacity-50 rounded-lg whitespace-nowrap cursor-pointer"
                    >
                      {submitting ? 'Submitting...' : 'Submit for Verification'}
                    </button>
                  </div>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-start gap-2.5 text-[11px] text-slate-600">
                  <ShieldCheck
                    className="h-4 w-4 text-[#A37B22] shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <span>
                    Security safeguard: No secret gateway keys exist in the browser. Orders trigger an
                    atomic Firestore transaction and remain <strong className="text-[#0B1A30]">PENDING</strong>{' '}
                    until settlement verification credits your wallet with idempotency protection.
                  </span>
                </div>
              </div>
            </form>

            {/* Right Column: Dynamic QR Code & Mobile UPI Intent Apps */}
            {activeAccount && (
              <div className="lg:col-span-5 bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4 flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-[#0B1A30] flex items-center gap-1.5">
                      <QrCode className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
                      <span>2. Pay via QR or UPI App</span>
                    </p>
                    <span className="text-[11px] font-mono font-bold text-[#0B1A30] tabular-nums">
                      {amountValidationError ? '—' : formatInr(parsedAmountInr)}
                    </span>
                  </div>

                  {/* Scannable QR Display */}
                  <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col items-center text-center space-y-3">
                    {qrDataUrl ? (
                      <img
                        src={qrDataUrl}
                        alt={`UPI QR Code for ${activeAccount.upiId}`}
                        className="w-44 h-44 rounded-lg border border-slate-100"
                      />
                    ) : activeAccount.qrCodeImageUrl ? (
                      <img
                        src={activeAccount.qrCodeImageUrl}
                        alt={`Merchant QR for ${activeAccount.displayName}`}
                        className="w-44 h-44 object-contain rounded-lg border border-slate-100"
                      />
                    ) : (
                      <div className="w-44 h-44 bg-slate-100 rounded-lg flex items-center justify-center text-xs text-slate-500 px-4">
                        Enter a valid deposit amount (₹{runtimeConfig.minDepositInr}+) to generate QR
                      </div>
                    )}

                    <div className="w-full pt-2 border-t border-slate-100 space-y-1.5">
                      <p className="text-xs font-bold text-[#0B1A30]">{activeAccount.displayName}</p>
                      <div className="flex items-center justify-center gap-2">
                        <span className="font-mono text-xs text-slate-700 bg-slate-100 px-2.5 py-1 rounded select-all">
                          {activeAccount.upiId}
                        </span>
                        <button
                          type="button"
                          onClick={handleCopyUpi}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[#0B1A30] bg-white border border-slate-300 hover:bg-slate-50 rounded cursor-pointer"
                        >
                          {copiedUpi ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-700" aria-hidden="true" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" aria-hidden="true" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Mobile UPI Deep-Link Buttons */}
                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold text-slate-600 flex items-center gap-1.5">
                      <Smartphone className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
                      <span>Launch Mobile UPI App (Amount Pre-filled)</span>
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {UPI_APPS.map((app) => {
                        const intentHref =
                          !amountValidationError && activeAccount
                            ? buildUpiPaymentIntentUrl(
                                {
                                  upiId: activeAccount.upiId,
                                  displayName: activeAccount.displayName,
                                  amountInr: parsedAmountInr,
                                  transactionRef: txRefTag,
                                  note: `NEXORA ${userId || ''} ${previewCoins} Coins`.trim(),
                                },
                                app.id
                              )
                            : undefined;

                        return intentHref ? (
                          <a
                            key={app.id}
                            href={intentHref}
                            className={`inline-flex items-center justify-between gap-2 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors ${
                              app.id === 'GENERIC'
                                ? 'col-span-2 bg-[#0B1A30] text-white border-[#0B1A30] hover:bg-[#13284A]'
                                : 'bg-white text-[#0B1A30] border-slate-300 hover:border-[#C59B3B]'
                            }`}
                          >
                            <span>{app.label}</span>
                            <ExternalLink
                              className={`h-3 w-3 shrink-0 ${
                                app.id === 'GENERIC' ? 'text-[#D8B45A]' : 'text-slate-400'
                              }`}
                              aria-hidden="true"
                            />
                          </a>
                        ) : (
                          <span
                            key={app.id}
                            className={`inline-flex items-center justify-between gap-2 px-3 py-2 text-xs font-semibold rounded-lg border bg-slate-100 text-slate-400 border-slate-200 ${
                              app.id === 'GENERIC' ? 'col-span-2' : ''
                            }`}
                          >
                            <span>{app.label}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-slate-500 pt-2 border-t border-slate-200">
                  On desktop browsers, scan the QR code directly from Google Pay, PhonePe, Paytm, or
                  BHIM, then enter your UTR number on the left.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Real-time User Deposit Verification & Status Feed */}
        <div className="border-t border-slate-200 pt-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#0B1A30]">
              Recent UPI Coin Deposit Orders ({deposits.length})
            </h3>
            <span className="text-[11px] text-slate-500">Live Firestore Verification Sync</span>
          </div>

          {loadingDeposits ? (
            <p className="text-xs text-slate-500">Loading deposit status...</p>
          ) : deposits.length === 0 ? (
            <p className="text-xs text-slate-500">
              No UPI deposit orders submitted yet. Completed orders appear here with live status.
            </p>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full min-w-[680px] border-collapse text-left">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th scope="col" className="py-2.5 px-4 whitespace-nowrap">
                      Submitted
                    </th>
                    <th scope="col" className="py-2.5 px-4 whitespace-nowrap">
                      Amount / Coins
                    </th>
                    <th scope="col" className="py-2.5 px-4">
                      UPI Endpoint &amp; UTR
                    </th>
                    <th scope="col" className="py-2.5 px-4 whitespace-nowrap">
                      Status
                    </th>
                    <th scope="col" className="py-2.5 px-4">
                      Verification Note
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {deposits.slice(0, 8).map((dep) => {
                    const statusMeta = getDepositStatusMeta(dep.status);
                    const StatusIcon = statusMeta.Icon;
                    const trackedTx = paymentTxByDepositId.get(dep.depositId);
                    return (
                      <tr key={dep.depositId} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap">
                          <div>{dep.createdAt ? formatDateTimeInr(dep.createdAt) : 'Syncing...'}</div>
                          {trackedTx && (
                            <div className="text-[10px] text-slate-400 truncate max-w-[150px]">
                              {trackedTx.paymentTxId}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 font-mono whitespace-nowrap">
                          <span className="font-bold text-[#0B1A30]">
                            {formatInr(dep.amountInr)}
                          </span>{' '}
                          · {formatCoins(dep.coinsRequested)}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[11px] text-slate-700">
                          <div>{dep.assignedUpiId}</div>
                          <div className="text-slate-500">UTR: {dep.utrNumber || '—'}</div>
                        </td>
                        <td className="py-2.5 px-4 whitespace-nowrap space-y-1">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] font-semibold ${statusMeta.className}`}
                          >
                            <StatusIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span>{statusMeta.label}</span>
                          </span>
                          {trackedTx && (
                            <div className="text-[10px] font-mono text-slate-500">
                              State: {trackedTx.status}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-slate-600 max-w-xs truncate">
                          {dep.status === 'APPROVED'
                            ? trackedTx?.coinTransactionId
                              ? `Credited atomically (${trackedTx.coinTransactionId})`
                              : 'Credited atomically to coin wallet'
                            : dep.status === 'REJECTED'
                            ? dep.rejectionReason || 'Rejected during verification'
                            : trackedTx?.status === 'WEBHOOK_VERIFIED'
                            ? 'Webhook dry-run verified · awaiting settlement lock'
                            : 'Awaiting settlement verification'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
