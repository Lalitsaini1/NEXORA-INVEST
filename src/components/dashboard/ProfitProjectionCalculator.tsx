import { useMemo, useState } from 'react';
import { Calculator, CalendarDays, Coins, Info, TrendingUp } from 'lucide-react';
import { ILLUSTRATIVE_PLANS } from '../../data/catalogPreview';
import {
  calculateProfitProjection,
  formatCoins,
  formatInr,
} from '../../utils/formatters';

interface ProfitProjectionCalculatorProps {
  availableCoins: number;
}

const PRESET_AMOUNTS_INR = [100, 500, 1000, 5000, 10000] as const;
const MIN_INVESTMENT_INR = 100;
const MAX_INVESTMENT_INR = 10_000_000;

export function ProfitProjectionCalculator({
  availableCoins,
}: ProfitProjectionCalculatorProps) {
  const [amountInput, setAmountInput] = useState<string>('1000');
  const [selectedPlanId, setSelectedPlanId] = useState<string>(
    ILLUSTRATIVE_PLANS[2]?.planId || ILLUSTRATIVE_PLANS[0].planId
  );
  const [showDailyBreakdown, setShowDailyBreakdown] = useState(false);

  const parsedInr = useMemo(() => {
    const num = Number(amountInput);
    if (!Number.isFinite(num) || num <= 0) return 0;
    return Math.min(Math.floor(num), MAX_INVESTMENT_INR);
  }, [amountInput]);

  const isBelowMinimum = parsedInr > 0 && parsedInr < MIN_INVESTMENT_INR;
  const effectiveInr = parsedInr >= MIN_INVESTMENT_INR ? parsedInr : 0;

  const selectedPlan = useMemo(
    () =>
      ILLUSTRATIVE_PLANS.find((plan) => plan.planId === selectedPlanId) ||
      ILLUSTRATIVE_PLANS[0],
    [selectedPlanId]
  );

  const selectedProjection = useMemo(
    () => calculateProfitProjection(effectiveInr, selectedPlan),
    [effectiveInr, selectedPlan]
  );

  const allCycleProjections = useMemo(
    () =>
      ILLUSTRATIVE_PLANS.map((plan) => ({
        plan,
        projection: calculateProfitProjection(effectiveInr, plan),
      })),
    [effectiveInr]
  );

  const dailyRangeLabel =
    selectedProjection.minDailyCoins === selectedProjection.maxDailyCoins
      ? `${new Intl.NumberFormat('en-IN').format(selectedProjection.minDailyCoins)} Coins/day`
      : `${new Intl.NumberFormat('en-IN').format(
          selectedProjection.minDailyCoins
        )}–${new Intl.NumberFormat('en-IN').format(
          selectedProjection.maxDailyCoins
        )} Coins/day`;

  return (
    <section
      aria-labelledby="profit-projection-heading"
      className="bg-white border border-slate-200 rounded-xl overflow-hidden"
    >
      {/* Header */}
      <div className="p-5 sm:p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <h2
            id="profit-projection-heading"
            className="font-display text-lg font-bold text-[#0B1A30] flex items-center gap-2"
          >
            <Calculator className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
            <span>Profit Projection Calculator</span>
          </h2>
          <p className="text-xs text-slate-500">
            Estimate virtual coin returns across NEXORA INVEST structured plan cycles
            <span aria-hidden="true"> · </span>
            <span className="font-mono tabular-nums">₹100 = 100 Coins</span>
          </p>
        </div>

        {availableCoins >= MIN_INVESTMENT_INR && (
          <button
            type="button"
            onClick={() => setAmountInput(String(availableCoins))}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#0B1A30] bg-[#F8F1DE] border border-[#C59B3B]/40 hover:bg-[#F3E7C4] rounded-lg whitespace-nowrap shrink-0 cursor-pointer self-start sm:self-auto"
          >
            <Coins className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
            <span className="tabular-nums">
              Use Wallet ({new Intl.NumberFormat('en-IN').format(availableCoins)} Coins)
            </span>
          </button>
        )}
      </div>

      <div className="p-5 sm:p-6 space-y-6">
        {/* Controls Row: Investment Amount + Plan Cycle Selector */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Amount Input & Presets */}
          <div className="lg:col-span-5 space-y-2.5">
            <label
              htmlFor="projection-investment-amount"
              className="block text-xs font-semibold text-slate-700"
            >
              Investment Amount (INR / Virtual Coins)
            </label>
            <div className="relative">
              <span
                aria-hidden="true"
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-mono font-semibold text-slate-500"
              >
                ₹
              </span>
              <input
                id="projection-investment-amount"
                type="number"
                inputMode="numeric"
                min={MIN_INVESTMENT_INR}
                max={MAX_INVESTMENT_INR}
                step={50}
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="1000"
                className="w-full pl-8 pr-24 py-2.5 text-sm font-mono font-semibold text-[#0B1A30] tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-500 tabular-nums pointer-events-none">
                {new Intl.NumberFormat('en-IN').format(parsedInr)} Coins
              </span>
            </div>

            {isBelowMinimum && (
              <p role="alert" className="text-xs text-red-700">
                Enter at least {formatInr(MIN_INVESTMENT_INR)} ({MIN_INVESTMENT_INR} Virtual Coins)
                to compute structured plan projections.
              </p>
            )}

            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {PRESET_AMOUNTS_INR.map((preset) => {
                const isSelected = parsedInr === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAmountInput(String(preset))}
                    className={`px-2.5 py-1.5 text-xs font-mono font-semibold rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                      isSelected
                        ? 'bg-[#0B1A30] text-white border-[#0B1A30]'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-[#C59B3B]'
                    }`}
                  >
                    {formatInr(preset)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Plan Cycle Selector */}
          <div className="lg:col-span-7 space-y-2.5">
            <span className="block text-xs font-semibold text-slate-700">
              Select Structured Plan Cycle
            </span>
            <div
              role="radiogroup"
              aria-label="Structured plan cycle"
              className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
            >
              {ILLUSTRATIVE_PLANS.map((plan) => {
                const active = plan.planId === selectedPlan.planId;
                const yieldPct = Math.round(
                  ((plan.totalCoinReward - plan.coinDeductionAmount) /
                    plan.coinDeductionAmount) *
                    100
                );

                return (
                  <button
                    key={plan.planId}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setSelectedPlanId(plan.planId)}
                    className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#0B1A30] text-white border-[#0B1A30]'
                        : 'bg-white text-slate-800 border-slate-200 hover:border-[#C59B3B]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold truncate">{plan.productName}</span>
                      <span
                        className={`font-mono text-xs font-semibold tabular-nums shrink-0 ${
                          active ? 'text-[#D8B45A]' : 'text-[#A37B22]'
                        }`}
                      >
                        +{yieldPct}%
                      </span>
                    </div>
                    <p
                      className={`text-[11px] font-mono tabular-nums mt-1 ${
                        active ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {plan.durationDays} Days · Base {formatInr(plan.planPriceInr)} →{' '}
                      {plan.totalCoinReward} Coins
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Summary Projection Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border border-slate-200 rounded-lg bg-slate-50/70">
          <div className="p-4 space-y-1">
            <p className="text-xs text-slate-500">Allocated Virtual Coins</p>
            <p className="font-mono text-xl font-bold text-[#0B1A30] tabular-nums">
              {formatCoins(selectedProjection.investedCoins)}
            </p>
            <p className="text-[11px] text-slate-500 font-mono tabular-nums">
              Input: {formatInr(selectedProjection.investmentInr)}
            </p>
          </div>

          <div className="p-4 space-y-1">
            <p className="text-xs text-slate-500">Estimated Total Return</p>
            <p className="font-mono text-xl font-bold text-[#0B1A30] tabular-nums">
              {formatCoins(selectedProjection.estimatedTotalCoins)}
            </p>
            <p className="text-[11px] text-slate-500 tabular-nums">
              Across {selectedProjection.durationDays}-day {selectedPlan.productName}
            </p>
          </div>

          <div className="p-4 space-y-1">
            <p className="text-xs text-slate-500 flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
              <span>Estimated Net Gain</span>
            </p>
            <p className="font-mono text-xl font-bold text-emerald-700 tabular-nums">
              +{formatCoins(selectedProjection.netCoinGain)}
            </p>
            <p className="text-[11px] text-emerald-700 font-mono font-semibold tabular-nums">
              +{selectedProjection.netGainPercent.toFixed(1)}% cycle yield
            </p>
          </div>

          <div className="p-4 space-y-1">
            <p className="text-xs text-slate-500">Projected Daily Credit</p>
            <p className="font-mono text-xl font-bold text-[#A37B22] tabular-nums">
              {dailyRangeLabel}
            </p>
            <p className="text-[11px] text-slate-500 font-mono tabular-nums">
              Scale: {selectedProjection.planMultiplier.toFixed(2)}× base unit
            </p>
          </div>
        </div>

        {/* Daily Distribution Schedule Toggle */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowDailyBreakdown((prev) => !prev)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0B1A30] hover:text-[#A37B22] transition-colors cursor-pointer"
          >
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              {showDailyBreakdown
                ? `Hide ${selectedPlan.durationDays}-Day Distribution Preview`
                : `Inspect ${selectedPlan.durationDays}-Day Distribution Preview`}
            </span>
          </button>

          {showDailyBreakdown && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
              <p className="text-xs font-semibold text-[#0B1A30]">
                Deterministic Integer Schedule ({selectedPlan.durationDays} Intervals · Sum:{' '}
                <span className="font-mono tabular-nums">
                  {formatCoins(selectedProjection.estimatedTotalCoins)}
                </span>
                )
              </p>
              <div className="flex flex-wrap gap-1.5 font-mono text-[11px] tabular-nums text-slate-700">
                {selectedProjection.dailySchedule.map((coins, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 bg-white border border-slate-200 rounded"
                  >
                    D{idx + 1}: {coins}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* All Structured Plan Cycles Comparison Table */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-700">
            Cycle Comparison for {formatInr(selectedProjection.investmentInr)}
          </h3>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full min-w-[620px] border-collapse text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th scope="col" className="py-2.5 px-4 whitespace-nowrap">
                    Plan Cycle
                  </th>
                  <th scope="col" className="py-2.5 px-4 text-right whitespace-nowrap">
                    Duration
                  </th>
                  <th scope="col" className="py-2.5 px-4 text-right whitespace-nowrap">
                    Daily Rate
                  </th>
                  <th scope="col" className="py-2.5 px-4 text-right whitespace-nowrap">
                    Est. Total Return
                  </th>
                  <th scope="col" className="py-2.5 px-4 text-right whitespace-nowrap">
                    Est. Net Gain
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {allCycleProjections.map(({ plan, projection }) => {
                  const isCurrent = plan.planId === selectedPlan.planId;
                  const rowDaily =
                    projection.minDailyCoins === projection.maxDailyCoins
                      ? `${new Intl.NumberFormat('en-IN').format(projection.minDailyCoins)}`
                      : `${new Intl.NumberFormat('en-IN').format(
                          projection.minDailyCoins
                        )}–${new Intl.NumberFormat('en-IN').format(
                          projection.maxDailyCoins
                        )}`;

                  return (
                    <tr
                      key={plan.planId}
                      onClick={() => setSelectedPlanId(plan.planId)}
                      className={`cursor-pointer transition-colors ${
                        isCurrent ? 'bg-[#F8F1DE]/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-2.5 px-4 font-semibold text-[#0B1A30] whitespace-nowrap">
                        {plan.productName}{' '}
                        <span className="text-slate-500 font-normal">({plan.category})</span>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-slate-700 tabular-nums whitespace-nowrap">
                        {plan.durationDays} Days
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-slate-700 tabular-nums whitespace-nowrap">
                        {rowDaily} / day
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-semibold text-[#0B1A30] tabular-nums whitespace-nowrap">
                        {formatCoins(projection.estimatedTotalCoins)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-bold text-emerald-700 tabular-nums whitespace-nowrap">
                        +{formatCoins(projection.netCoinGain)} ({projection.netGainPercent.toFixed(1)}%)
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Disclosure Footer */}
        <p className="text-[11px] text-slate-500 leading-relaxed flex items-start gap-2 pt-1">
          <Info className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Projections are illustrative estimates calculated from configured plan cycle ratios
            (₹100 = 100 Virtual Coins) with integer remainder distribution. No guaranteed financial
            returns are promised; actual credits and withdrawable eligibility follow active platform
            terms and compliance status.
          </span>
        </p>
      </div>
    </section>
  );
}
