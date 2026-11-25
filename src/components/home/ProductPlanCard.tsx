import { useState } from 'react';
import { ArrowRight, CalendarDays, Coins, Info } from 'lucide-react';
import { ProductPlan } from '../../types/domain';
import { formatCoins, formatInr } from '../../utils/formatters';
import { computePlanEconomics } from '../../utils/planInvestment';
import { ImageWithFallback } from '../common/ImageWithFallback';

interface ProductPlanCardProps {
  plan: ProductPlan;
  onInvestClick: (plan: ProductPlan) => void;
}

export function ProductPlanCard({ plan, onInvestClick }: ProductPlanCardProps) {
  const [showSchedule, setShowSchedule] = useState(false);
  const economics = computePlanEconomics({ plan });
  const isRangePlan = economics.maxInvestmentInr > economics.minInvestmentInr;

  return (
    <article className="flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden transition-colors hover:border-[#C59B3B]">
      <div className="aspect-[4/3] w-full bg-slate-100 overflow-hidden border-b border-slate-200">
        <ImageWithFallback
          src={plan.imageUrl}
          alt={`${plan.productName} — ${plan.category}`}
          fallbackTitle={plan.productName}
          className="w-full h-full object-cover"
        />
      </div>

      <div className="flex flex-col flex-1 p-5 sm:p-6 space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>{plan.category}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{economics.durationDays} Days</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{plan.planId}</span>
          </div>
          <h3 className="font-display text-xl font-bold text-[#0B1A30]">{plan.productName}</h3>
          <p className="text-sm text-slate-600 leading-relaxed">{plan.description}</p>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 py-4 border-y border-slate-100 text-sm">
          <div>
            <dt className="text-xs text-slate-500">
              {isRangePlan ? 'Investment Range (INR)' : 'Investment Amount (INR)'}
            </dt>
            <dd className="font-mono font-semibold text-[#0B1A30] tabular-nums mt-0.5">
              {isRangePlan
                ? `${formatInr(economics.minInvestmentInr)} – ${formatInr(economics.maxInvestmentInr)}`
                : formatInr(economics.minInvestmentInr)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Expected Return (Est.)</dt>
            <dd className="font-mono font-semibold text-[#8A6518] tabular-nums mt-0.5">
              {economics.expectedReturnPercent}% ({economics.durationDays}d)
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Est. Total Payout</dt>
            <dd className="font-mono font-semibold text-emerald-700 tabular-nums mt-0.5">
              {formatInr(economics.estimatedTotalPayoutInr)}
              {isRangePlan ? '+' : ''}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Est. Daily Earnings</dt>
            <dd className="font-mono font-medium text-slate-800 tabular-nums mt-0.5">
              {formatInr(economics.dailyEarningsInr)} / day
            </dd>
          </div>
        </dl>

        <div className="flex items-center justify-between text-xs text-slate-500">
          <button
            type="button"
            onClick={() => setShowSchedule((prev) => !prev)}
            className="inline-flex items-center gap-1.5 font-medium text-[#0B1A30] hover:text-[#A37B22] transition-colors cursor-pointer"
          >
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{showSchedule ? 'Hide Schedule Breakdown' : 'Inspect Daily Breakdown'}</span>
          </button>
          <span className="inline-flex items-center gap-1 text-slate-500">
            <Coins className="h-3.5 w-3.5 text-[#C59B3B]" aria-hidden="true" />
            <span className="tabular-nums">
              Base: {formatCoins(economics.estimatedTotalPayoutInr)}
            </span>
          </span>
        </div>

        {showSchedule && (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <p className="text-xs font-medium text-[#0B1A30]">
              Indicative Schedule at {formatInr(economics.investmentAmountInr)} (
              {economics.durationDays} Intervals):
            </p>
            <div className="flex flex-wrap gap-1.5 font-mono text-[11px] tabular-nums text-slate-700">
              {economics.dailyDistribution.slice(0, 14).map((coins, idx) => (
                <span key={idx} className="px-1.5 py-0.5 bg-white border border-slate-200 rounded">
                  D{idx + 1}:{coins}
                </span>
              ))}
              {economics.dailyDistribution.length > 14 && (
                <span className="px-1.5 py-0.5 text-slate-500">
                  +{economics.dailyDistribution.length - 14} more days
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 leading-snug flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-400" aria-hidden="true" />
              <span>
                {plan.termsAndConditions} Returns shown are indicative estimates and are not
                guaranteed.
              </span>
            </p>
          </div>
        )}

        <div className="pt-1 mt-auto">
          <button
            type="button"
            onClick={() => onInvestClick(plan)}
            className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 text-sm font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] rounded-lg transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C59B3B]"
          >
            <span>INVEST NOW</span>
            <ArrowRight className="h-4 w-4 text-[#D8B45A]" aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}
