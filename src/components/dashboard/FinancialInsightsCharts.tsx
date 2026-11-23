import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowDownUp,
  BarChart3,
  Coins,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ROUTES } from '../../config/constants';
import { subscribeUserDeposits } from '../../services/depositService';
import {
  subscribeUserPlans,
  subscribeUserTransactions,
} from '../../services/transactionService';
import { subscribeUserWithdrawals } from '../../services/walletService';
import {
  CoinTransaction,
  DepositRequest,
  UserPlan,
  WithdrawalRequest,
} from '../../types/domain';
import {
  buildInvestmentGrowthVisualSeries,
  buildTransactionActivityVisualSeries,
  ChartWindowDays,
  InvestmentGrowthChartPoint,
  TransactionCashflowPoint,
  TransactionCategoryBreakdownItem,
} from '../../utils/dashboardCharts';
import { formatCoins, formatInr, formatSignedCoins } from '../../utils/formatters';

interface FinancialInsightsChartsProps {
  uid: string;
  availableCoins: number;
  highContrast?: boolean;
}

type ChartFocusMode = 'OVERVIEW' | 'GROWTH' | 'TRANSACTIONS';

const WINDOW_OPTIONS: { value: ChartWindowDays; label: string }[] = [
  { value: 7, label: '7D' },
  { value: 14, label: '14D' },
  { value: 30, label: '30D' },
];

const VIEW_MODES: { value: ChartFocusMode; label: string }[] = [
  { value: 'OVERVIEW', label: 'Overview' },
  { value: 'GROWTH', label: 'Investment Growth' },
  { value: 'TRANSACTIONS', label: 'Transactions' },
];

function GrowthTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: InvestmentGrowthChartPoint }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0].payload;

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-md px-3.5 py-2.5 text-xs space-y-1.5 min-w-[205px]">
      <p className="font-semibold text-[#0B1A30] border-b border-slate-100 pb-1">
        {pt.fullLabel}
      </p>
      <div className="flex items-center justify-between gap-4">
        <span className="text-slate-600">Total Portfolio</span>
        <span className="font-mono font-bold text-[#0B1A30] tabular-nums">
          {formatCoins(pt.totalPortfolioCoins)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-slate-600">
          <span className="h-2 w-2 rounded-xs bg-[#0B1A30] inline-block" aria-hidden="true" />
          <span>Liquid Wallet</span>
        </span>
        <span className="font-mono text-slate-800 tabular-nums">
          {formatCoins(pt.liquidCoins)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-slate-600">
          <span className="h-2 w-2 rounded-xs bg-[#C59B3B] inline-block" aria-hidden="true" />
          <span>Active Plan Capital</span>
        </span>
        <span className="font-mono text-[#A37B22] tabular-nums">
          {formatCoins(pt.activePlanCapital)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4 pt-1 border-t border-slate-100">
        <span className="flex items-center gap-1.5 text-slate-600">
          <span className="h-2 w-2 rounded-xs bg-[#16A34A] inline-block" aria-hidden="true" />
          <span>Cumulative Rewards</span>
        </span>
        <span className="font-mono font-semibold text-emerald-700 tabular-nums">
          +{formatCoins(pt.cumulativeRewards)}
        </span>
      </div>
    </div>
  );
}

function CashflowTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: TransactionCashflowPoint }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0].payload;

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-md px-3.5 py-2.5 text-xs space-y-1.5 min-w-[205px]">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-1">
        <span className="font-semibold text-[#0B1A30]">{pt.fullLabel}</span>
        <span className="font-mono text-[11px] text-slate-500 tabular-nums">
          {pt.txCount} {pt.txCount === 1 ? 'tx' : 'txs'}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-slate-600">
          <span className="h-2 w-2 rounded-xs bg-[#16A34A] inline-block" aria-hidden="true" />
          <span>Inflows</span>
        </span>
        <span className="font-mono font-semibold text-emerald-700 tabular-nums">
          +{formatCoins(pt.inflowsCoins)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-slate-600">
          <span className="h-2 w-2 rounded-xs bg-[#C59B3B] inline-block" aria-hidden="true" />
          <span>Plan Allocations</span>
        </span>
        <span className="font-mono font-semibold text-[#A37B22] tabular-nums">
          {formatCoins(pt.planAllocatedCoins)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-slate-600">
          <span className="h-2 w-2 rounded-xs bg-[#D97706] inline-block" aria-hidden="true" />
          <span>Withdrawals</span>
        </span>
        <span className="font-mono font-semibold text-amber-700 tabular-nums">
          {formatInr(pt.withdrawalsInr)}
        </span>
      </div>
    </div>
  );
}

function CategoryTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: TransactionCategoryBreakdownItem }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0].payload;

  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-md px-3.5 py-2.5 text-xs space-y-1">
      <p className="font-semibold text-[#0B1A30]">{item.label}</p>
      <p className="font-mono tabular-nums text-slate-700">
        Volume: <strong>{formatCoins(item.volumeCoins)}</strong> ({item.sharePct}%)
      </p>
      <p className="font-mono tabular-nums text-slate-500">
        {item.count} {item.count === 1 ? 'transaction' : 'transactions'}
      </p>
    </div>
  );
}

export function FinancialInsightsCharts({
  uid,
  availableCoins,
  highContrast = false,
}: FinancialInsightsChartsProps) {
  const [windowDays, setWindowDays] = useState<ChartWindowDays>(14);
  const [focusMode, setFocusMode] = useState<ChartFocusMode>('OVERVIEW');

  const [plans, setPlans] = useState<UserPlan[]>([]);
  const [transactions, setTransactions] = useState<CoinTransaction[]>([]);
  const [deposits, setDeposits] = useState<DepositRequest[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);

  const [plansLoaded, setPlansLoaded] = useState(false);
  const [txLoaded, setTxLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCounter, setRetryCounter] = useState(0);

  useEffect(() => {
    if (!uid) return;
    setPlansLoaded(false);
    setTxLoaded(false);
    setLoadError(null);

    const unsubPlans = subscribeUserPlans(
      uid,
      (items) => {
        setPlans(items);
        setPlansLoaded(true);
      },
      (msg) => {
        setLoadError((prev) => prev || msg);
        setPlansLoaded(true);
      }
    );

    const unsubTx = subscribeUserTransactions(
      uid,
      (items) => {
        setTransactions(items);
        setTxLoaded(true);
      },
      (msg) => {
        setLoadError((prev) => prev || msg);
        setTxLoaded(true);
      }
    );

    const unsubDeposits = subscribeUserDeposits(
      uid,
      (items) => setDeposits(items),
      () => {
        // Non-blocking enrichment stream
      }
    );

    const unsubWithdrawals = subscribeUserWithdrawals(
      uid,
      (items) => setWithdrawals(items),
      () => {
        // Non-blocking enrichment stream
      }
    );

    return () => {
      unsubPlans();
      unsubTx();
      unsubDeposits();
      unsubWithdrawals();
    };
  }, [uid, retryCounter]);

  const loading = !(plansLoaded && txLoaded);

  const growthSummary = useMemo(
    () =>
      buildInvestmentGrowthVisualSeries({
        currentAvailableCoins: availableCoins,
        plans,
        transactions,
        windowDays,
      }),
    [availableCoins, plans, transactions, windowDays]
  );

  const txSummary = useMemo(
    () =>
      buildTransactionActivityVisualSeries({
        transactions,
        deposits,
        withdrawals,
        windowDays,
      }),
    [transactions, deposits, withdrawals, windowDays]
  );

  const growthColor =
    growthSummary.netPortfolioGrowthCoins > 0
      ? 'text-emerald-700'
      : growthSummary.netPortfolioGrowthCoins < 0
      ? 'text-red-700'
      : 'text-[#0B1A30]';

  const showGrowthChart = focusMode === 'OVERVIEW' || focusMode === 'GROWTH';
  const showTransactionChart = focusMode === 'OVERVIEW' || focusMode === 'TRANSACTIONS';

  return (
    <section
      id="financial-analytics"
      aria-labelledby="financial-analytics-heading"
      className={`bg-white rounded-xl overflow-hidden ${
        highContrast ? 'border-2 border-slate-900' : 'border border-slate-200'
      }`}
    >
      {/* Top Toolbar: Title + View Switcher + Timeframe Selector */}
      <div className="p-5 sm:p-6 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2
            id="financial-analytics-heading"
            className="font-display text-lg font-bold text-[#0B1A30] flex items-center gap-2"
          >
            <TrendingUp className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
            <span>Investment Growth &amp; Transaction Analytics</span>
          </h2>
          <p className="text-xs text-slate-500">
            Visual breakdown of portfolio growth, active plan capital, and transaction flows
            <span aria-hidden="true"> · </span>
            <span className="font-mono tabular-nums">
              Last {windowDays} days (UTC)
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Focus Mode Tabs */}
          <div
            role="tablist"
            aria-label="Select analytics chart view"
            className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
          >
            {VIEW_MODES.map((mode) => {
              const active = focusMode === mode.value;
              return (
                <button
                  key={mode.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFocusMode(mode.value)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-white text-[#0B1A30] shadow-xs'
                      : 'text-slate-600 hover:text-[#0B1A30]'
                  }`}
                >
                  {mode.label}
                </button>
              );
            })}
          </div>

          {/* Timeframe Selector Tabs */}
          <div
            role="tablist"
            aria-label="Analytics timeframe window"
            className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
          >
            {WINDOW_OPTIONS.map((opt) => {
              const active = windowDays === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setWindowDays(opt.value)}
                  className={`px-2.5 py-1.5 text-xs font-mono font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'bg-[#0B1A30] text-white'
                      : 'text-slate-600 hover:text-[#0B1A30]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Loading Skeleton */}
      {loading && (
        <div className="p-5 sm:p-6 space-y-5 animate-pulse" aria-busy="true">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="h-16 bg-slate-100 rounded-lg" />
            <div className="h-16 bg-slate-100 rounded-lg" />
            <div className="h-16 bg-slate-100 rounded-lg" />
            <div className="h-16 bg-slate-100 rounded-lg" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-[280px] bg-slate-100 rounded-lg" />
            <div className="h-[280px] bg-slate-100 rounded-lg" />
          </div>
        </div>
      )}

      {/* Error State */}
      {!loading && loadError && !growthSummary.hasData && !txSummary.hasTransactions && (
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

      {/* Populated & Empty Analytics Content */}
      {!loading && !(loadError && !growthSummary.hasData && !txSummary.hasTransactions) && (
        <div className="p-5 sm:p-6 space-y-6">
          {/* 4-Column Consolidated Financial Snapshot */}
          <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 border border-slate-200 rounded-lg bg-slate-50/70">
            <div className="p-4 space-y-1">
              <p className="text-[11px] font-medium text-slate-500">
                Total Portfolio Value
              </p>
              <p className="font-mono text-lg sm:text-xl font-bold text-[#0B1A30] tabular-nums">
                {formatCoins(growthSummary.currentPortfolioCoins)}
              </p>
              <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                {formatInr(growthSummary.currentPortfolioCoins)} equiv.
              </p>
            </div>

            <div className="p-4 space-y-1">
              <p className="text-[11px] font-medium text-slate-500">
                {windowDays}-Day Portfolio Growth
              </p>
              <p className={`font-mono text-lg sm:text-xl font-bold tabular-nums ${growthColor}`}>
                {formatSignedCoins(growthSummary.netPortfolioGrowthCoins)}
              </p>
              <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                {growthSummary.netPortfolioGrowthPct !== null
                  ? `${growthSummary.netPortfolioGrowthPct > 0 ? '+' : ''}${growthSummary.netPortfolioGrowthPct}% over ${windowDays}d`
                  : `${growthSummary.activePlanCount} active ${
                      growthSummary.activePlanCount === 1 ? 'plan' : 'plans'
                    }`}
              </p>
            </div>

            <div className="p-4 space-y-1">
              <p className="text-[11px] font-medium text-slate-500">
                Active Plan Capital
              </p>
              <p className="font-mono text-lg sm:text-xl font-bold text-[#A37B22] tabular-nums">
                {formatCoins(growthSummary.activePlanCapital)}
              </p>
              <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                Target reward: {formatCoins(growthSummary.totalExpectedEntitlement)}
              </p>
            </div>

            <div className="p-4 space-y-1">
              <p className="text-[11px] font-medium text-slate-500">
                {windowDays}-Day Transaction Volume
              </p>
              <p className="font-mono text-lg sm:text-xl font-bold text-[#0B1A30] tabular-nums">
                {formatCoins(txSummary.totalVolumeWindow)}
              </p>
              <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                {txSummary.totalTransactionsWindow}{' '}
                {txSummary.totalTransactionsWindow === 1 ? 'entry' : 'entries'}
                {txSummary.pendingRequestsCount > 0
                  ? ` · ${txSummary.pendingRequestsCount} pending`
                  : ''}
              </p>
            </div>
          </div>

          {/* Primary Recharts Grid */}
          <div
            className={`grid gap-6 ${
              focusMode === 'OVERVIEW' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'
            }`}
          >
            {/* Panel 1: Investment Portfolio Growth ComposedChart */}
            {showGrowthChart && (
              <div className="p-4 sm:p-5 bg-slate-50/70 border border-slate-200 rounded-lg space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <h3 className="font-display text-sm font-bold text-[#0B1A30]">
                      Investment &amp; Portfolio Trajectory
                    </h3>
                    <p className="text-xs text-slate-500">
                      Liquid wallet balance, committed plan capital, and cumulative rewards
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 rounded-xs bg-[#0B1A30] inline-block"
                        aria-hidden="true"
                      />
                      <span>Liquid</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 rounded-xs bg-[#C59B3B] inline-block"
                        aria-hidden="true"
                      />
                      <span>Plan Capital</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 rounded-xs bg-[#16A34A] inline-block"
                        aria-hidden="true"
                      />
                      <span>Rewards</span>
                    </span>
                  </div>
                </div>

                {!growthSummary.hasData ? (
                  <div className="h-[260px] flex flex-col items-center justify-center text-center px-4 bg-white border border-slate-200 rounded-lg space-y-3">
                    <Coins className="h-6 w-6 text-[#A37B22]" aria-hidden="true" />
                    <div className="space-y-1 max-w-xs">
                      <p className="text-sm font-semibold text-[#0B1A30]">
                        Start building your investment trajectory
                      </p>
                      <p className="text-xs text-slate-500">
                        Add verified coins via UPI or activate a product plan to visualize daily
                        capital growth and earned rewards.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <a
                        href="#add-coins-gateway"
                        className="px-3.5 py-2 text-xs font-bold text-[#0B1A30] bg-[#C59B3B] hover:bg-[#D8B45A] rounded-lg transition-colors"
                      >
                        Add Coins
                      </a>
                      <Link
                        to={ROUTES.HOME}
                        className="px-3.5 py-2 text-xs font-semibold text-[#0B1A30] border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors"
                      >
                        View Plans
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div
                    className="w-full h-[260px]"
                    role="region"
                    aria-label="Investment portfolio growth chart"
                  >
                    <ResponsiveContainer width="100%" height={260}>
                      <ComposedChart
                        data={growthSummary.points}
                        margin={{ top: 10, right: 12, left: 0, bottom: 2 }}
                      >
                        <defs>
                          <linearGradient id="nexoraLiquidFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#0B1A30" stopOpacity={0.22} />
                            <stop offset="95%" stopColor="#0B1A30" stopOpacity={0.02} />
                          </linearGradient>
                          <linearGradient id="nexoraCapitalFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#C59B3B" stopOpacity={0.35} />
                            <stop offset="95%" stopColor="#C59B3B" stopOpacity={0.05} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                        <XAxis
                          dataKey="shortLabel"
                          tick={{ fontSize: 11, fill: '#64748B' }}
                          tickLine={false}
                          axisLine={{ stroke: '#CBD5E1' }}
                          minTickGap={22}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: '#64748B' }}
                          tickLine={false}
                          axisLine={false}
                          width={48}
                          allowDecimals={false}
                          domain={[
                            0,
                            (dataMax: number) => (dataMax > 0 ? Math.ceil(dataMax * 1.15) : 100),
                          ]}
                          tickFormatter={(val: number) =>
                            new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(val)
                          }
                        />
                        <Tooltip content={<GrowthTooltip />} />
                        <Area
                          type="monotone"
                          dataKey="liquidCoins"
                          stackId="portfolio"
                          name="Liquid Coins"
                          stroke="#0B1A30"
                          strokeWidth={2}
                          fill="url(#nexoraLiquidFill)"
                        />
                        <Area
                          type="monotone"
                          dataKey="activePlanCapital"
                          stackId="portfolio"
                          name="Active Plan Capital"
                          stroke="#C59B3B"
                          strokeWidth={2}
                          fill="url(#nexoraCapitalFill)"
                        />
                        <Line
                          type="monotone"
                          dataKey="cumulativeRewards"
                          name="Cumulative Rewards"
                          stroke="#16A34A"
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4, fill: '#16A34A', stroke: '#FFFFFF', strokeWidth: 1.5 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}

            {/* Panel 2: Transaction Cashflow Grouped BarChart */}
            {showTransactionChart && (
              <div className="p-4 sm:p-5 bg-slate-50/70 border border-slate-200 rounded-lg space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <h3 className="font-display text-sm font-bold text-[#0B1A30] flex items-center gap-1.5">
                      <ArrowDownUp className="h-3.5 w-3.5 text-[#A37B22]" aria-hidden="true" />
                      <span>Daily Transaction Cashflow</span>
                    </h3>
                    <p className="text-xs text-slate-500">
                      Deposits &amp; rewards vs. plan allocations and withdrawals
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 rounded-xs bg-[#16A34A] inline-block"
                        aria-hidden="true"
                      />
                      <span>Inflows</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 rounded-xs bg-[#C59B3B] inline-block"
                        aria-hidden="true"
                      />
                      <span>Plans</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 rounded-xs bg-[#D97706] inline-block"
                        aria-hidden="true"
                      />
                      <span>Withdrawals</span>
                    </span>
                  </div>
                </div>

                {!txSummary.hasTransactions ? (
                  <div className="h-[260px] flex flex-col items-center justify-center text-center px-4 bg-white border border-slate-200 rounded-lg space-y-3">
                    <BarChart3 className="h-6 w-6 text-[#A37B22]" aria-hidden="true" />
                    <div className="space-y-1 max-w-xs">
                      <p className="text-sm font-semibold text-[#0B1A30]">
                        No transactions in the last {windowDays} days
                      </p>
                      <p className="text-xs text-slate-500">
                        Verified coin deposits, plan allocations, daily rewards, and withdrawals
                        appear here day by day as recorded in Firestore.
                      </p>
                    </div>
                    <a
                      href="#investment-history"
                      className="px-3.5 py-2 text-xs font-semibold text-[#0B1A30] border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors"
                    >
                      Inspect Full History
                    </a>
                  </div>
                ) : (
                  <div
                    className="w-full h-[260px]"
                    role="region"
                    aria-label="Daily transaction cashflow bar chart"
                  >
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart
                        data={txSummary.dailyCashflow}
                        margin={{ top: 10, right: 12, left: 0, bottom: 2 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                        <XAxis
                          dataKey="shortLabel"
                          tick={{ fontSize: 11, fill: '#64748B' }}
                          tickLine={false}
                          axisLine={{ stroke: '#CBD5E1' }}
                          minTickGap={22}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: '#64748B' }}
                          tickLine={false}
                          axisLine={false}
                          width={48}
                          allowDecimals={false}
                          tickFormatter={(val: number) =>
                            new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(val)
                          }
                        />
                        <Tooltip content={<CashflowTooltip />} />
                        <Bar
                          dataKey="inflowsCoins"
                          name="Inflows"
                          fill="#16A34A"
                          radius={[3, 3, 0, 0]}
                          maxBarSize={18}
                        />
                        <Bar
                          dataKey="planAllocatedCoins"
                          name="Plan Allocations"
                          fill="#C59B3B"
                          radius={[3, 3, 0, 0]}
                          maxBarSize={18}
                        />
                        <Bar
                          dataKey="withdrawalsInr"
                          name="Withdrawals"
                          fill="#D97706"
                          radius={[3, 3, 0, 0]}
                          maxBarSize={18}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Transaction Category Volume Distribution (Recharts Horizontal BarChart) */}
          {txSummary.categoryBreakdown.length > 0 && (
            <div className="p-4 sm:p-5 bg-slate-50/70 border border-slate-200 rounded-lg space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <h3 className="font-display text-sm font-bold text-[#0B1A30]">
                    Transaction Volume by Category ({windowDays}D)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Share of ledger movement across deposits, rewards, plans, and withdrawals
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums text-slate-600">
                  <span>
                    Inflows:{' '}
                    <strong className="text-emerald-700">
                      +{formatCoins(txSummary.totalInflowsWindow)}
                    </strong>
                  </span>
                  <span>
                    Invested:{' '}
                    <strong className="text-[#A37B22]">
                      {formatCoins(txSummary.totalPlanAllocatedWindow)}
                    </strong>
                  </span>
                  <span>
                    Withdrawn:{' '}
                    <strong className="text-[#0B1A30]">
                      {formatInr(txSummary.totalWithdrawalsWindow)}
                    </strong>
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
                <div
                  className="lg:col-span-7 w-full"
                  style={{ height: Math.max(150, txSummary.categoryBreakdown.length * 42) }}
                  role="region"
                  aria-label="Transaction volume by category bar chart"
                >
                  <ResponsiveContainer
                    width="100%"
                    height={Math.max(150, txSummary.categoryBreakdown.length * 42)}
                  >
                    <BarChart
                      layout="vertical"
                      data={txSummary.categoryBreakdown}
                      margin={{ top: 4, right: 20, left: 4, bottom: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 11, fill: '#64748B' }}
                        tickLine={false}
                        axisLine={{ stroke: '#CBD5E1' }}
                        tickFormatter={(val: number) =>
                          new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(val)
                        }
                      />
                      <YAxis
                        type="category"
                        dataKey="label"
                        width={142}
                        tick={{ fontSize: 11, fill: '#0B1A30', fontWeight: 600 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip content={<CategoryTooltip />} />
                      <Bar dataKey="volumeCoins" radius={[0, 4, 4, 0]} barSize={20}>
                        {txSummary.categoryBreakdown.map((entry) => (
                          <Cell key={entry.categoryKey} fill={entry.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="lg:col-span-5 divide-y divide-slate-200 border border-slate-200 rounded-lg bg-white">
                  {txSummary.categoryBreakdown.map((cat) => (
                    <div
                      key={cat.categoryKey}
                      className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2.5 w-2.5 rounded-xs shrink-0"
                          style={{ backgroundColor: cat.color }}
                          aria-hidden="true"
                        />
                        <span className="font-medium text-[#0B1A30] truncate">{cat.label}</span>
                        <span className="text-[11px] text-slate-400 font-mono tabular-nums shrink-0">
                          ({cat.count})
                        </span>
                      </div>
                      <div className="text-right font-mono tabular-nums shrink-0">
                        <span className="font-semibold text-[#0B1A30]">
                          {formatCoins(cat.volumeCoins)}
                        </span>
                        <span className="text-slate-400 ml-1.5">{cat.sharePct}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
