import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Coins,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  subscribeUserDailyRewards,
  subscribeUserPlans,
  subscribeUserTransactions,
} from '../../services/transactionService';
import { CoinTransaction, DailyRewardRecord, UserPlan } from '../../types/domain';
import {
  DailyRewardChartBucket,
  aggregateDailyRewardEarnings,
  computePlanProgressItems,
  formatCoins,
} from '../../utils/formatters';

interface DailyRewardBreakdownProps {
  uid: string;
  walletEarnedCoins: number;
}

const WINDOW_OPTIONS: { value: 7 | 14 | 30; label: string }[] = [
  { value: 7, label: '7D' },
  { value: 14, label: '14D' },
  { value: 30, label: '30D' },
];

function DailyRewardTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: DailyRewardChartBucket }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const bucket = payload[0].payload;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-md px-3.5 py-2.5 text-xs space-y-1">
      <p className="font-semibold text-[#0B1A30]">{bucket.fullLabel}</p>
      <p className="font-mono tabular-nums text-[#0B1A30]">
        Credited: <strong>{formatCoins(bucket.coins)}</strong>
      </p>
      <p className="font-mono tabular-nums text-slate-500">
        {bucket.creditCount} {bucket.creditCount === 1 ? 'credit' : 'credits'}
      </p>
    </div>
  );
}

export function DailyRewardBreakdown({
  uid,
  walletEarnedCoins,
}: DailyRewardBreakdownProps) {
  const [windowDays, setWindowDays] = useState<7 | 14 | 30>(7);
  const [rewards, setRewards] = useState<DailyRewardRecord[]>([]);
  const [plans, setPlans] = useState<UserPlan[]>([]);
  const [rewardTransactions, setRewardTransactions] = useState<CoinTransaction[]>([]);
  const [loadingRewards, setLoadingRewards] = useState(true);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [retryCounter, setRetryCounter] = useState(0);

  useEffect(() => {
    if (!uid) return;
    setLoadingRewards(true);
    setLoadingPlans(true);
    setLoadError(null);

    const unsubRewards = subscribeUserDailyRewards(
      uid,
      (items) => {
        setRewards(items);
        setLoadingRewards(false);
      },
      (msg) => {
        setLoadError(msg);
        setLoadingRewards(false);
      }
    );

    const unsubPlans = subscribeUserPlans(
      uid,
      (items) => {
        setPlans(items);
        setLoadingPlans(false);
      },
      (msg) => {
        setLoadError(msg);
        setLoadingPlans(false);
      }
    );

    const unsubTx = subscribeUserTransactions(
      uid,
      (items) => {
        setRewardTransactions(
          items.filter((tx) => tx.type === 'DAILY_REWARD' && tx.status === 'COMPLETED')
        );
      },
      () => {
        // Primary reward feed error handling covered by rewards/plans subscriptions
      }
    );

    return () => {
      unsubRewards();
      unsubPlans();
      unsubTx();
    };
  }, [uid, retryCounter]);

  // Prefer canonical dailyRewards records; fall back to DAILY_REWARD ledger entries if needed
  const normalizedEntries = useMemo(() => {
    if (rewards.length > 0) {
      return rewards.map((r) => ({
        coins: r.coinsCredited,
        timestamp: r.creditedAt || r.scheduledFor,
      }));
    }
    return rewardTransactions.map((tx) => ({
      coins: tx.amount,
      timestamp: tx.createdAt,
    }));
  }, [rewards, rewardTransactions]);

  const aggregation = useMemo(
    () => aggregateDailyRewardEarnings(normalizedEntries, windowDays),
    [normalizedEntries, windowDays]
  );

  const planProgressList = useMemo(
    () => computePlanProgressItems(plans),
    [plans]
  );

  const selectedBucket = useMemo(
    () =>
      aggregation.buckets.find((b) => b.dateKey === selectedDayKey) ||
      aggregation.buckets[aggregation.buckets.length - 1] ||
      null,
    [aggregation.buckets, selectedDayKey]
  );

  const loading = loadingRewards || loadingPlans;

  return (
    <section
      aria-labelledby="daily-reward-breakdown-heading"
      className="bg-white border border-slate-200 rounded-xl overflow-hidden"
    >
      {/* Header & Window Controls */}
      <div className="p-5 sm:p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <h2
            id="daily-reward-breakdown-heading"
            className="font-display text-lg font-bold text-[#0B1A30] flex items-center gap-2"
          >
            <BarChart3 className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
            <span>Daily Reward Earnings</span>
          </h2>
          <p className="text-xs text-slate-500">
            Cumulative Earned:{' '}
            <span className="font-mono font-semibold text-[#0B1A30] tabular-nums">
              {formatCoins(walletEarnedCoins)}
            </span>
            <span aria-hidden="true"> · </span>
            <span className="font-mono tabular-nums">
              {aggregation.activeDaysCount} active{' '}
              {aggregation.activeDaysCount === 1 ? 'day' : 'days'} in {windowDays}d
            </span>
          </p>
        </div>

        <div
          role="tablist"
          aria-label="Daily reward chart timeframe"
          className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start sm:self-auto"
        >
          {WINDOW_OPTIONS.map((opt) => {
            const active = windowDays === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setWindowDays(opt.value);
                  setSelectedDayKey(null);
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-white text-[#0B1A30] shadow-xs'
                    : 'text-slate-600 hover:text-[#0B1A30]'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Loading Skeleton */}
      {loading && (
        <div className="p-5 sm:p-6 space-y-5 animate-pulse" aria-busy="true">
          <div className="grid grid-cols-3 gap-4">
            <div className="h-14 bg-slate-100 rounded-lg" />
            <div className="h-14 bg-slate-100 rounded-lg" />
            <div className="h-14 bg-slate-100 rounded-lg" />
          </div>
          <div className="h-40 bg-slate-100 rounded-lg" />
        </div>
      )}

      {/* Error State */}
      {!loading && loadError && (
        <div
          role="alert"
          className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-red-50/70"
        >
          <div className="flex items-start gap-2.5 text-sm text-red-800">
            <AlertCircle className="h-4 w-4 text-red-700 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{loadError}</span>
          </div>
          <button
            type="button"
            onClick={() => setRetryCounter((c) => c + 1)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0B1A30] bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Populated & Empty Content */}
      {!loading && !loadError && (
        <div className="p-5 sm:p-6 space-y-6">
          {/* 3-Column Metric Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border border-slate-200 rounded-lg bg-slate-50/70">
            <div className="p-4 space-y-1">
              <p className="text-xs text-slate-500">{windowDays}-Day Reward Total</p>
              <p className="font-mono text-xl font-bold text-[#0B1A30] tabular-nums">
                {formatCoins(aggregation.totalCreditedInWindow)}
              </p>
            </div>
            <div className="p-4 space-y-1">
              <p className="text-xs text-slate-500">Average on Active Days</p>
              <p className="font-mono text-xl font-bold text-[#A37B22] tabular-nums">
                {formatCoins(aggregation.avgPerActiveDay)}
              </p>
            </div>
            <div className="p-4 space-y-1">
              <p className="text-xs text-slate-500">Peak Single-Day Credit</p>
              <p className="font-mono text-xl font-bold text-emerald-700 tabular-nums">
                {formatCoins(aggregation.maxDailyCoins)}
              </p>
            </div>
          </div>

          {/* Daily Recharts Vertical Bar Chart */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-700">
                Daily Credit Distribution (Last {windowDays} Days)
              </span>
              {selectedBucket && (
                <span className="font-mono tabular-nums text-slate-600">
                  {selectedBucket.fullLabel}:{' '}
                  <strong className="text-[#0B1A30]">
                    {formatCoins(selectedBucket.coins)}
                  </strong>{' '}
                  ({selectedBucket.creditCount}{' '}
                  {selectedBucket.creditCount === 1 ? 'credit' : 'credits'})
                </span>
              )}
            </div>

            {aggregation.totalCreditedInWindow === 0 ? (
              <div className="p-6 text-center bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                <Coins className="h-5 w-5 text-[#A37B22] mx-auto" aria-hidden="true" />
                <p className="text-sm font-semibold text-[#0B1A30]">
                  No daily rewards credited in the last {windowDays} days
                </p>
                <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                  Daily 24-hour reward credits from active product plans will populate this bar
                  chart automatically once distributed.
                </p>
              </div>
            ) : (
              <div className="p-4 bg-slate-50/70 border border-slate-200 rounded-lg">
                <div
                  className="w-full h-[210px]"
                  role="region"
                  aria-label={`Bar chart of daily coin reward credits over the last ${windowDays} days`}
                >
                  <ResponsiveContainer width="100%" height={210}>
                    <BarChart
                      data={aggregation.buckets}
                      margin={{ top: 10, right: 12, left: 0, bottom: 2 }}
                      onClick={(state) => {
                        const label = state?.activeLabel;
                        if (typeof label === 'string') {
                          const match = aggregation.buckets.find((b) => b.shortLabel === label);
                          if (match) setSelectedDayKey(match.dateKey);
                        }
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                      <XAxis
                        dataKey="shortLabel"
                        tick={{ fontSize: 11, fill: '#64748B' }}
                        tickLine={false}
                        axisLine={{ stroke: '#CBD5E1' }}
                        minTickGap={16}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#64748B' }}
                        tickLine={false}
                        axisLine={false}
                        width={44}
                        allowDecimals={false}
                      />
                      <Tooltip content={<DailyRewardTooltip />} />
                      <Bar dataKey="coins" radius={[4, 4, 0, 0]} maxBarSize={28}>
                        {aggregation.buckets.map((bucket) => {
                          const isSelected = selectedBucket?.dateKey === bucket.dateKey;
                          return (
                            <Cell
                              key={bucket.dateKey}
                              fill={
                                bucket.coins === 0
                                  ? '#CBD5E1'
                                  : isSelected
                                  ? '#C59B3B'
                                  : '#0B1A30'
                              }
                            />
                          );
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>

          {/* Plan Entitlement Progress Bars */}
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
                <span>Plan Reward Progress</span>
              </span>
              <span className="font-mono text-slate-500 tabular-nums">
                {planProgressList.length}{' '}
                {planProgressList.length === 1 ? 'plan cycle' : 'plan cycles'}
              </span>
            </div>

            {planProgressList.length === 0 ? (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#0B1A30]">
                    No active product plan cycles
                  </span>
                  <span className="font-mono tabular-nums text-slate-500">0% collected</span>
                </div>
                <div
                  role="progressbar"
                  aria-label="Overall plan reward collection progress"
                  aria-valuenow={0}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-2.5 w-full bg-slate-200 rounded-full overflow-hidden"
                >
                  <div className="h-full w-0 bg-[#C59B3B] rounded-full" />
                </div>
                <p className="text-[11px] text-slate-500">
                  Enroll in a structured product plan to track daily collected vs. remaining coin
                  entitlement here.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {planProgressList.map((plan) => (
                  <div
                    key={plan.userPlanId}
                    className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[#0B1A30]">
                          {plan.productName}
                        </span>
                        <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                          · Day {plan.daysCompleted}/{plan.durationDays}
                        </span>
                        {plan.status === 'COMPLETED' && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                            <span>Completed</span>
                          </span>
                        )}
                      </div>
                      <span className="text-xs font-mono font-semibold text-[#0B1A30] tabular-nums">
                        {formatCoins(plan.collectedReward)} /{' '}
                        {formatCoins(plan.totalRewardEntitlement)} ({plan.progressPct}%)
                      </span>
                    </div>

                    <div
                      role="progressbar"
                      aria-label={`${plan.productName} reward collection progress`}
                      aria-valuenow={plan.progressPct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className="h-2.5 w-full bg-slate-200 rounded-full overflow-hidden"
                    >
                      <div
                        style={{ width: `${plan.progressPct}%` }}
                        className={`h-full rounded-full transition-all ${
                          plan.status === 'COMPLETED' ? 'bg-emerald-600' : 'bg-[#C59B3B]'
                        }`}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono tabular-nums">
                      <span>Remaining: {formatCoins(plan.remainingReward)}</span>
                      <span>Status: {plan.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
