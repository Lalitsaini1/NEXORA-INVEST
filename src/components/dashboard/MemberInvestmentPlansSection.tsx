import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock,
  Layers,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import { ILLUSTRATIVE_PLANS } from '../../data/catalogPreview';
import { subscribeInvestmentComplianceStatus } from '../../services/depositService';
import { subscribePublicProductPlans } from '../../services/planService';
import { subscribeUserPlans } from '../../services/transactionService';
import { CoinWallet, ProductPlan, UserPlan, UserProfile } from '../../types/domain';
import { formatCoins, formatDateTimeInr, formatInr } from '../../utils/formatters';
import {
  computePlanEconomics,
  evaluateInvestmentComplianceGate,
  InvestmentComplianceStatus,
  resolveCatalogPlans,
} from '../../utils/planInvestment';
import { PlanInvestmentModal } from '../home/PlanInvestmentModal';

interface MemberInvestmentPlansSectionProps {
  uid: string;
  profile: UserProfile | null;
  wallet: CoinWallet | null;
  profileInitializing: boolean;
  highContrast?: boolean;
}

export function MemberInvestmentPlansSection({
  uid,
  profile,
  wallet,
  profileInitializing,
  highContrast = false,
}: MemberInvestmentPlansSectionProps) {
  const [livePlans, setLivePlans] = useState<ProductPlan[]>([]);
  const [plansLoaded, setPlansLoaded] = useState(false);
  const [activeEnrollments, setActiveEnrollments] = useState<UserPlan[]>([]);
  const [enrollmentsLoaded, setEnrollmentsLoaded] = useState(false);
  const [compliance, setCompliance] = useState<InvestmentComplianceStatus>(() =>
    evaluateInvestmentComplianceGate(null)
  );
  const [complianceLoaded, setComplianceLoaded] = useState(false);
  const [amountsByPlanId, setAmountsByPlanId] = useState<Record<string, string>>({});
  const [selectedPlanModal, setSelectedPlanModal] = useState<{
    plan: ProductPlan;
    amountInr?: number;
  } | null>(null);

  useEffect(() => {
    const unsubPlans = subscribePublicProductPlans(
      (plans) => {
        setLivePlans(plans);
        setPlansLoaded(true);
      },
      () => setPlansLoaded(true)
    );
    const unsubCompliance = subscribeInvestmentComplianceStatus((status) => {
      setCompliance(status);
      setComplianceLoaded(true);
    });
    return () => {
      unsubPlans();
      unsubCompliance();
    };
  }, []);

  useEffect(() => {
    if (!uid) return;
    setEnrollmentsLoaded(false);
    const unsubUserPlans = subscribeUserPlans(
      uid,
      (items) => {
        setActiveEnrollments(items.filter((item) => item.status === 'ACTIVE'));
        setEnrollmentsLoaded(true);
      },
      () => setEnrollmentsLoaded(true)
    );
    return () => unsubUserPlans();
  }, [uid]);

  const availablePlans = useMemo(
    () => resolveCatalogPlans(livePlans, ILLUSTRATIVE_PLANS),
    [livePlans]
  );

  const surfaceClass = highContrast
    ? 'bg-white border-2 border-slate-900 rounded-xl'
    : 'bg-white border border-slate-200 rounded-xl';

  return (
    <div className="space-y-8">
      {/* 1. Active Investments */}
      <section aria-labelledby="active-investments-heading" className={`${surfaceClass} p-6 space-y-5`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-4">
          <div>
            <h2
              id="active-investments-heading"
              className="font-display text-lg font-bold text-[#0B1A30] flex items-center gap-2"
            >
              <TrendingUp className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
              <span>Active Investments</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live investment plans currently accruing server-governed ledger payouts.
            </p>
          </div>
          <span className="font-mono text-xs font-semibold text-[#0B1A30] bg-slate-100 border border-slate-200 px-3 py-1 rounded-md self-start sm:self-auto">
            {activeEnrollments.length} Active Plan{activeEnrollments.length === 1 ? '' : 's'}
          </span>
        </div>

        {!enrollmentsLoaded ? (
          <p className="text-xs text-slate-500">Loading active investments...</p>
        ) : activeEnrollments.length === 0 ? (
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 flex items-center gap-2.5">
            <Clock className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
            <span>
              You do not have any active investment cycles yet. Select an available plan below once
              compliance and verified wallet balance requirements are met.
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeEnrollments.map((up) => {
              const economics = computePlanEconomics({
                plan: {
                  planPriceInr: up.coinCost,
                  coinDeductionAmount: up.coinCost,
                  durationDays: up.durationDays,
                  totalCoinReward: up.totalRewardEntitlement,
                },
                investmentAmountInr: up.coinCost,
              });
              const progressPct = Math.min(
                100,
                Math.round((up.daysCompleted / Math.max(1, up.durationDays)) * 100)
              );

              return (
                <article
                  key={up.userPlanId}
                  className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-display text-base font-bold text-[#0B1A30]">
                        {up.productName}
                      </h3>
                      <p className="text-[11px] font-mono text-slate-500">{up.userPlanId}</p>
                    </div>
                    <span className="px-2 py-0.5 text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded">
                      ACTIVE
                    </span>
                  </div>

                  <dl className="grid grid-cols-2 gap-2.5 text-xs">
                    <div>
                      <dt className="text-slate-500">Invested Amount</dt>
                      <dd className="font-mono font-bold text-[#0B1A30] tabular-nums">
                        {formatInr(up.coinCost)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Expected Return (Est.)</dt>
                      <dd className="font-mono font-semibold text-[#8A6518] tabular-nums">
                        {economics.expectedReturnPercent}% ({up.durationDays}d)
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Estimated Total Payout</dt>
                      <dd className="font-mono font-bold text-emerald-700 tabular-nums">
                        {formatInr(up.totalRewardEntitlement)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Daily Earnings (Est.)</dt>
                      <dd className="font-mono font-semibold text-slate-700 tabular-nums">
                        {formatInr(economics.dailyEarningsInr)} / day
                      </dd>
                    </div>
                  </dl>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-600 font-mono tabular-nums">
                      <span>
                        Day {up.daysCompleted} / {up.durationDays} ({progressPct}%)
                      </span>
                      <span>
                        Collected: {formatCoins(up.collectedReward)} / Remaining:{' '}
                        {formatCoins(up.remainingReward)}
                      </span>
                    </div>
                    <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#C59B3B] transition-all"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-500 font-mono">
                    Started: {up.startDate ? formatDateTimeInr(up.startDate) : 'Active'} · Matures:{' '}
                    {up.endDate ? formatDateTimeInr(up.endDate) : 'Scheduled'}
                  </p>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* 2. Available Investment Plans */}
      <section aria-labelledby="available-plans-heading" className={`${surfaceClass} p-6 space-y-5`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h2
              id="available-plans-heading"
              className="font-display text-lg font-bold text-[#0B1A30] flex items-center gap-2"
            >
              <Layers className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
              <span>Available Investment Plans</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Compare duration, indicative return percentage, daily earnings, and estimated payout
              calculated authoritatively on the server.
            </p>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold self-start ${
              compliance.allowed
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-amber-50 text-amber-900 border border-amber-300'
            }`}
          >
            {compliance.allowed ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Compliance Verified</span>
              </>
            ) : (
              <>
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Compliance Hold Active</span>
              </>
            )}
          </span>
        </div>

        {/* Legal & Payment Provider Compliance Gate Notice */}
        {complianceLoaded && !compliance.allowed && (
          <div
            role="status"
            className="p-4 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-3 text-xs text-amber-950"
          >
            <ShieldAlert className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-bold">
                Real-Money Investments Paused Pending Legal &amp; Payment-Provider Compliance
              </p>
              <p className="leading-relaxed">{compliance.reason}</p>
              <p className="text-[11px] text-amber-800">
                Legal Compliance: {compliance.legalComplianceVerified ? 'Verified' : 'Pending'} ·
                Payment Provider Compliance:{' '}
                {compliance.paymentProviderComplianceVerified ? 'Verified' : 'Pending'}
                {compliance.complianceStatusNote ? ` · ${compliance.complianceStatusNote}` : ''}
              </p>
            </div>
          </div>
        )}

        {/* Explicit Risk, Fee & Withdrawal Conditions Banner */}
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 leading-relaxed">
          <strong className="text-[#0B1A30]">Investment Risk &amp; Fee Disclosure:</strong>{' '}
          Expected returns displayed below are indicative estimates only and are{' '}
          <strong>not guaranteed</strong>. Enrollment incurs ₹0 platform fee; applicable gateway
          settlement fees or statutory taxes apply when withdrawing eligible INR to verified payout
          accounts.
        </div>

        {!plansLoaded && availablePlans.length === 0 ? (
          <p className="text-xs text-slate-500">Loading available investment plans...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {availablePlans.map((plan) => {
              const rawInput = amountsByPlanId[plan.planId];
              const parsedInput =
                rawInput !== undefined && rawInput !== '' ? Number(rawInput) : undefined;
              const economics = computePlanEconomics({
                plan,
                investmentAmountInr: parsedInput,
              });
              const isRangePlan = economics.maxInvestmentInr > economics.minInvestmentInr;
              const midpointAmount = Math.round(
                (economics.minInvestmentInr + economics.maxInvestmentInr) / 2
              );

              return (
                <article
                  key={plan.planId}
                  className="p-5 bg-white border border-slate-200 rounded-xl flex flex-col justify-between space-y-4 hover:border-[#C59B3B] transition-colors"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#A37B22]">
                          {plan.category || 'Structured Plan'}
                        </p>
                        <h3 className="font-display text-lg font-bold text-[#0B1A30]">
                          {plan.productName}
                        </h3>
                      </div>
                      <span className="font-mono text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded">
                        {economics.durationDays} Days
                      </span>
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed">{plan.description}</p>

                    {isRangePlan && (
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                        <div className="flex items-center justify-between text-[11px]">
                          <label
                            htmlFor={`dash-amount-${plan.planId}`}
                            className="font-semibold text-[#0B1A30]"
                          >
                            Investment Amount (INR)
                          </label>
                          <span className="font-mono text-slate-500 tabular-nums">
                            {formatInr(economics.minInvestmentInr)} –{' '}
                            {formatInr(economics.maxInvestmentInr)}
                          </span>
                        </div>
                        <input
                          id={`dash-amount-${plan.planId}`}
                          type="number"
                          min={economics.minInvestmentInr}
                          max={economics.maxInvestmentInr}
                          step={1}
                          value={rawInput ?? String(economics.investmentAmountInr)}
                          onChange={(e) =>
                            setAmountsByPlanId((prev) => ({
                              ...prev,
                              [plan.planId]: e.target.value,
                            }))
                          }
                          className="w-full px-3 py-1.5 text-xs font-mono font-semibold bg-white border border-slate-300 rounded-md tabular-nums"
                        />
                        <div className="flex flex-wrap gap-1.5">
                          {[
                            { label: 'Min', value: economics.minInvestmentInr },
                            { label: 'Mid', value: midpointAmount },
                            { label: 'Max', value: economics.maxInvestmentInr },
                          ].map((preset) => (
                            <button
                              key={preset.label}
                              type="button"
                              onClick={() =>
                                setAmountsByPlanId((prev) => ({
                                  ...prev,
                                  [plan.planId]: String(preset.value),
                                }))
                              }
                              className="px-2 py-0.5 text-[10px] font-mono font-semibold bg-white border border-slate-300 hover:border-[#0B1A30] rounded cursor-pointer tabular-nums"
                            >
                              {preset.label}: {formatInr(preset.value)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <dl className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100 text-xs">
                      <div>
                        <dt className="text-slate-500">Investment Amount</dt>
                        <dd className="font-mono font-bold text-[#0B1A30] tabular-nums mt-0.5">
                          {formatInr(economics.investmentAmountInr)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Duration</dt>
                        <dd className="font-mono font-semibold text-[#0B1A30] tabular-nums mt-0.5 flex items-center gap-1">
                          <CalendarDays className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
                          <span>{economics.durationDays} Days</span>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Expected Return (Est.)</dt>
                        <dd className="font-mono font-bold text-[#8A6518] tabular-nums mt-0.5">
                          {economics.expectedReturnPercent}% (Non-Guaranteed)
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Estimated Payout</dt>
                        <dd className="font-mono font-bold text-emerald-700 tabular-nums mt-0.5">
                          {formatInr(economics.estimatedTotalPayoutInr)}
                        </dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-slate-500">Daily Earnings (Indicative)</dt>
                        <dd className="font-mono font-semibold text-slate-700 tabular-nums mt-0.5">
                          {formatInr(economics.dailyEarningsInr)} / day (
                          {economics.dailyRewardPercent}%/day)
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setSelectedPlanModal({
                        plan,
                        amountInr: economics.investmentAmountInr,
                      })
                    }
                    className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-bold text-white bg-[#0B1A30] hover:bg-[#13284A] rounded-lg transition-colors cursor-pointer"
                  >
                    <span>Invest Now</span>
                    <ArrowRight className="h-3.5 w-3.5 text-[#D8B45A]" aria-hidden="true" />
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {selectedPlanModal && (
        <PlanInvestmentModal
          plan={selectedPlanModal.plan}
          initialAmountInr={selectedPlanModal.amountInr}
          profile={profile}
          wallet={wallet}
          profileInitializing={profileInitializing}
          onClose={() => setSelectedPlanModal(null)}
        />
      )}
    </div>
  );
}
