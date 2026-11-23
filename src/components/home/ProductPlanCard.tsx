import { useState } from 'react';
import { ArrowRight, CalendarDays, Coins, Info } from 'lucide-react';
import { ProductPlan } from '../../types/domain';
import { calculateDailyDistribution, formatCoins, formatInr } from '../../utils/formatters';
import { ImageWithFallback } from '../common/ImageWithFallback';

interface ProductPlanCardProps {
  plan: ProductPlan;
  onInvestClick: (plan: ProductPlan) => void;
}

export function ProductPlanCard({ plan, onInvestClick }: ProductPlanCardProps) {
  const [showSchedule, setShowSchedule] = useState(false);
  const distribution = calculateDailyDistribution(plan.totalCoinReward, plan.durationDays);
  const minDaily = distribution.length ? Math.min(...distribution) : 0;
  const maxDaily = distribution.length ? Math.max(...distribution) : 0;
  const dailyRangeLabel =
    minDaily === maxDaily ? `${minDaily} Coins/day` : `${minDaily}–${maxDaily} Coins/day`;

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
            <span className="tabular-nums">{plan.durationDays} Days</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{plan.planId}</span>
          </div>
          <h3 className="font-display text-xl font-bold text-[#0B1A30]">{plan.productName}</h3>
          <p className="text-sm text-slate-600 leading-relaxed">{plan.description}</p>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 py-4 border-y border-slate-100 text-sm">
          <div>
            <dt className="text-xs text-slate-500">Displayed Value</dt>
            <dd className="font-mono font-semibold text-[#0B1A30] tabular-nums mt-0.5">
              {formatInr(plan.displayedValueInr)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Plan Price</dt>
            <dd className="font-mono font-semibold text-[#0B1A30] tabular-nums mt-0.5">
              {formatInr(plan.planPriceInr)} ({plan.coinDeductionAmount} Coins)
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Total Coin Reward</dt>
            <dd className="font-mono font-semibold text-[#A37B22] tabular-nums mt-0.5">
              {formatCoins(plan.totalCoinReward)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Daily Distribution</dt>
            <dd className="font-mono font-medium text-slate-800 tabular-nums mt-0.5">
              {dailyRangeLabel}
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
            <span className="tabular-nums">Sum: {plan.totalCoinReward}</span>
          </span>
        </div>

        {showSchedule && (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <p className="text-xs font-medium text-[#0B1A30]">
              Integer Remainder Schedule ({plan.durationDays} Intervals):
            </p>
            <div className="flex flex-wrap gap-1.5 font-mono text-[11px] tabular-nums text-slate-700">
              {distribution.slice(0, 14).map((coins, idx) => (
                <span key={idx} className="px-1.5 py-0.5 bg-white border border-slate-200 rounded">
                  D{idx + 1}:{coins}
                </span>
              ))}
              {distribution.length > 14 && (
                <span className="px-1.5 py-0.5 text-slate-500">
                  +{distribution.length - 14} more days
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 leading-snug flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-400" aria-hidden="true" />
              <span>{plan.termsAndConditions}</span>
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
