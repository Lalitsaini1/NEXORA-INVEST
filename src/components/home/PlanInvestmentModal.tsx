import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Coins,
  FileCheck2,
  Loader2,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react';
import { ROUTES } from '../../config/constants';
import { useAuth } from '../../context/AuthContext';
import { investInProductPlan } from '../../services/planService';
import { CoinWallet, ProductPlan, UserPlan, UserProfile } from '../../types/domain';
import { calculateDailyDistribution, formatCoins, formatInr } from '../../utils/formatters';
import { evaluatePlanInvestmentEligibility } from '../../utils/planInvestment';
import { buildAuthUrlWithPlan } from '../../utils/planNavigation';

function createSessionIdempotencyKey(planId: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 12);
  return `${planId}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96);
}

interface PlanInvestmentModalProps {
  plan: ProductPlan;
  profile: UserProfile | null;
  wallet: CoinWallet | null;
  profileInitializing: boolean;
  onClose: () => void;
}

export function PlanInvestmentModal({
  plan,
  profile,
  wallet,
  profileInitializing,
  onClose,
}: PlanInvestmentModalProps) {
  const { firebaseUser } = useAuth();
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedPlan, setConfirmedPlan] = useState<UserPlan | null>(null);
  const [coinTxId, setCoinTxId] = useState<string | null>(null);
  const [savedRequestId, setSavedRequestId] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    createSessionIdempotencyKey(plan.planId)
  );

  useEffect(() => {
    setAcceptedTerms(false);
    setSubmitting(false);
    setError(null);
    setConfirmedPlan(null);
    setCoinTxId(null);
    setSavedRequestId(null);
    setIdempotencyKey(createSessionIdempotencyKey(plan.planId));
  }, [plan.planId]);

  const availableCoins = wallet?.availableCoins ?? 0;
  const eligibility = evaluatePlanInvestmentEligibility({
    plan,
    availableCoins,
    accountStatus: profile?.status,
    acceptedTerms,
  });

  const distribution = calculateDailyDistribution(plan.totalCoinReward, plan.durationDays);
  const minDaily = distribution.length ? Math.min(...distribution) : 0;
  const maxDaily = distribution.length ? Math.max(...distribution) : 0;
  const dailyRangeLabel =
    minDaily === maxDaily ? `${minDaily} Coins/day` : `${minDaily}–${maxDaily} Coins/day`;

  const depositRedirectUrl = `${buildAuthUrlWithPlan(ROUTES.USER_DASHBOARD, {
    planId: plan.planId,
  })}#add-coins-gateway`;

  const handleConfirmInvestment = async () => {
    if (submitting || !profile || !wallet) return;
    setError(null);

    if (!firebaseUser || profile.uid !== firebaseUser.uid) {
      setError('Active Firebase Authentication session mismatch. Please sign in again.');
      return;
    }

    if (!eligibility.eligible) {
      setError(eligibility.reason || 'Cannot confirm investment.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await investInProductPlan({
        uid: profile.uid,
        userId: profile.userId,
        plan,
        acceptedTerms,
        idempotencyKey,
      });
      setConfirmedPlan(result.userPlan);
      setCoinTxId(result.coinTransactionId);
      setSavedRequestId(result.requestId);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to activate investment plan. Please verify your wallet balance and try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="plan-investment-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1A30]/75 backdrop-blur-xs p-4 overflow-y-auto"
    >
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-6 space-y-5 shadow-xl my-auto">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-[#A37B22] uppercase tracking-wider">
              {confirmedPlan ? 'Verified Investment Active' : 'Investment Plan Confirmation'}
            </p>
            <h3
              id="plan-investment-modal-title"
              className="font-display text-xl font-bold text-[#0B1A30]"
            >
              {plan.productName}
            </h3>
            <p className="text-xs text-slate-500">
              {plan.category} · Plan ID <span className="font-mono">{plan.planId}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-[#0B1A30] rounded-lg hover:bg-slate-100 cursor-pointer"
            aria-label="Close confirmation modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Core Preserved Plan Specifications */}
        <dl className="grid grid-cols-2 gap-3 p-4 bg-slate-50 border border-slate-200 rounded-lg text-sm">
          <div>
            <dt className="text-[11px] font-medium text-slate-500">Plan Name</dt>
            <dd className="font-semibold text-[#0B1A30] mt-0.5">{plan.productName}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium text-slate-500">Investment Amount</dt>
            <dd className="font-mono font-semibold text-[#0B1A30] tabular-nums mt-0.5">
              {formatInr(plan.planPriceInr)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium text-slate-500">Coin Allocation</dt>
            <dd className="font-mono font-semibold text-[#0B1A30] tabular-nums mt-0.5">
              {formatCoins(plan.coinDeductionAmount)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium text-slate-500">Investment Duration</dt>
            <dd className="font-mono font-semibold text-[#0B1A30] tabular-nums mt-0.5 flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
              <span>{plan.durationDays} Days</span>
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium text-slate-500">Total Reward Entitlement</dt>
            <dd className="font-mono font-bold text-[#A37B22] tabular-nums mt-0.5">
              {formatCoins(plan.totalCoinReward)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-medium text-slate-500">Daily Distribution</dt>
            <dd className="font-mono font-medium text-slate-800 tabular-nums mt-0.5">
              {dailyRangeLabel}
            </dd>
          </div>
        </dl>

        {/* Plan Terms & Conditions */}
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
          <p className="text-xs font-semibold text-[#0B1A30] flex items-center gap-1.5">
            <FileCheck2 className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
            <span>Plan Terms and Conditions</span>
          </p>
          <p className="text-xs text-slate-600 leading-relaxed">{plan.termsAndConditions}</p>
        </div>

        {confirmedPlan ? (
          <div className="space-y-4">
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg space-y-2">
              <div className="flex items-start gap-2.5 text-emerald-900">
                <CheckCircle2 className="h-5 w-5 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="text-sm font-bold">
                    Investment Activated &amp; Recorded in Firestore Ledger
                  </p>
                  <p className="text-xs text-emerald-800">
                    {formatCoins(confirmedPlan.coinCost)} verified and deducted via backend ledger
                    transaction. Your {confirmedPlan.durationDays}-day reward cycle is now active.
                  </p>
                </div>
              </div>
              <div className="pt-2 border-t border-emerald-200/80 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono text-emerald-950">
                <div>
                  <span className="text-emerald-700">Plan Ref:</span> {confirmedPlan.userPlanId}
                </div>
                {coinTxId && (
                  <div>
                    <span className="text-emerald-700">Ledger Tx:</span> {coinTxId}
                  </div>
                )}
                {savedRequestId && (
                  <div className="sm:col-span-2">
                    <span className="text-emerald-700">Request ID:</span> {savedRequestId}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={onClose}
                className="py-2.5 px-4 text-sm font-semibold text-[#0B1A30] border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Browse Plans
              </button>
              <Link
                to={ROUTES.USER_DASHBOARD}
                onClick={onClose}
                className="inline-flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold text-[#0B1A30] bg-[#C59B3B] hover:bg-[#D8B45A] rounded-lg"
              >
                <span>Open Dashboard</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        ) : profileInitializing || !profile || !wallet ? (
          <div className="p-4 bg-[#F8F1DE] border border-[#C59B3B]/40 rounded-lg flex items-center gap-3 text-xs sm:text-sm text-[#0B1A30]">
            <Loader2 className="h-4 w-4 animate-spin text-[#A37B22] shrink-0" aria-hidden="true" />
            <span>Syncing your verified NEXORA member profile and wallet balance...</span>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Verified Member Wallet Check */}
            <div className="p-3.5 bg-[#0B1A30] text-white rounded-lg flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-[11px] uppercase tracking-wider text-[#D8B45A] font-semibold flex items-center gap-1.5">
                  <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Verified Coin Balance ({profile.userId})</span>
                </p>
                <p className="font-mono text-lg font-bold tabular-nums">
                  {formatCoins(availableCoins)}
                </p>
              </div>

              {eligibility.shortfallCoins === 0 ? (
                <div className="text-right">
                  <p className="text-[11px] text-slate-300">Balance After Activation</p>
                  <p className="font-mono text-sm font-semibold text-emerald-300 tabular-nums">
                    {formatCoins(eligibility.postInvestmentCoins)}
                  </p>
                </div>
              ) : (
                <div className="text-right">
                  <p className="text-[11px] text-amber-200">Verified Coins Needed</p>
                  <p className="font-mono text-sm font-semibold text-amber-300 tabular-nums">
                    +{formatCoins(eligibility.shortfallCoins)}
                  </p>
                </div>
              )}
            </div>

            {eligibility.shortfallCoins > 0 ? (
              <div className="space-y-3">
                <div
                  role="status"
                  className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2.5 text-xs text-amber-950"
                >
                  <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="space-y-1">
                    <p className="font-semibold">
                      Verified Payment Required Before Plan Activation
                    </p>
                    <p className="leading-relaxed">
                      You currently hold {formatCoins(availableCoins)}, which is{' '}
                      <strong>
                        {formatCoins(eligibility.shortfallCoins)} ({formatInr(eligibility.shortfallCoins)})
                      </strong>{' '}
                      short of the required {formatCoins(plan.coinDeductionAmount)}. Complete a
                      verified UPI coin deposit in your dashboard to activate this plan.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="py-2.5 px-4 text-sm font-semibold text-[#0B1A30] border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <Link
                    to={depositRedirectUrl}
                    onClick={onClose}
                    className="inline-flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold text-[#0B1A30] bg-[#C59B3B] hover:bg-[#D8B45A] rounded-lg"
                  >
                    <Coins className="h-4 w-4" aria-hidden="true" />
                    <span>Add Coins via UPI</span>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(e) => {
                      setAcceptedTerms(e.target.checked);
                      if (e.target.checked) setError(null);
                    }}
                    disabled={submitting}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#0B1A30] focus:ring-[#C59B3B]"
                  />
                  <span>
                    I confirm deduction of{' '}
                    <strong className="font-mono">
                      {formatCoins(plan.coinDeductionAmount)} ({formatInr(plan.planPriceInr)})
                    </strong>{' '}
                    and accept the Plan Terms and Conditions &amp; Risk Disclosures.
                  </span>
                </label>

                {error && (
                  <div
                    role="alert"
                    className="p-3 text-xs sm:text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg"
                  >
                    {error}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={submitting}
                    className="py-2.5 px-4 text-sm font-semibold text-[#0B1A30] border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleConfirmInvestment()}
                    disabled={submitting || !acceptedTerms}
                    className="inline-flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] disabled:opacity-60 rounded-lg cursor-pointer"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        <span>Activating...</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="h-4 w-4 text-[#D8B45A]" aria-hidden="true" />
                        <span>Confirm &amp; Invest</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
