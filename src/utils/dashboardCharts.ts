import {
  CoinTransaction,
  DepositRequest,
  UserPlan,
  WithdrawalRequest,
} from '../types/domain';
import {
  buildCoinBalanceGrowthSeries,
  getSignedTransactionDelta,
} from './formatters';

export type ChartWindowDays = 7 | 14 | 30;

export interface InvestmentGrowthChartPoint {
  dateKey: string;
  shortLabel: string;
  fullLabel: string;
  liquidCoins: number;
  activePlanCapital: number;
  totalPortfolioCoins: number;
  rewardsEarnedDay: number;
  cumulativeRewards: number;
}

export interface InvestmentGrowthVisualSummary {
  points: InvestmentGrowthChartPoint[];
  currentAvailableCoins: number;
  activePlanCapital: number;
  currentPortfolioCoins: number;
  netPortfolioGrowthCoins: number;
  netPortfolioGrowthPct: number | null;
  totalExpectedEntitlement: number;
  remainingProjectedRewards: number;
  totalRewardsInWindow: number;
  activePlanCount: number;
  completedPlanCount: number;
  hasData: boolean;
}

export interface TransactionCashflowPoint {
  dateKey: string;
  shortLabel: string;
  fullLabel: string;
  inflowsCoins: number;
  planAllocatedCoins: number;
  withdrawalsInr: number;
  netFlowCoins: number;
  txCount: number;
}

export interface TransactionCategoryBreakdownItem {
  categoryKey: string;
  label: string;
  volumeCoins: number;
  count: number;
  sharePct: number;
  color: string;
}

export interface TransactionVisualSummary {
  dailyCashflow: TransactionCashflowPoint[];
  categoryBreakdown: TransactionCategoryBreakdownItem[];
  totalInflowsWindow: number;
  totalPlanAllocatedWindow: number;
  totalWithdrawalsWindow: number;
  totalVolumeWindow: number;
  totalTransactionsWindow: number;
  pendingRequestsCount: number;
  hasTransactions: boolean;
}

function toUtcDateKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseUtcDateKey(iso: string): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return toUtcDateKey(parsed);
}

/**
 * Combines live CoinWallet liquid balance, UserPlan active capital, and ledger
 * transactions into a cohesive daily Investment Portfolio & Growth time series.
 */
export function buildInvestmentGrowthVisualSeries(params: {
  currentAvailableCoins: number;
  plans: Pick<
    UserPlan,
    | 'userPlanId'
    | 'coinCost'
    | 'totalRewardEntitlement'
    | 'collectedReward'
    | 'remainingReward'
    | 'startDate'
    | 'endDate'
    | 'status'
    | 'createdAt'
  >[];
  transactions: Pick<
    CoinTransaction,
    'type' | 'status' | 'amount' | 'previousBalance' | 'newBalance' | 'createdAt'
  >[];
  windowDays?: ChartWindowDays;
  referenceDate?: Date;
}): InvestmentGrowthVisualSummary {
  const windowDays = params.windowDays ?? 30;
  const referenceDate = params.referenceDate ?? new Date();
  const liquidSeries = buildCoinBalanceGrowthSeries(
    params.currentAvailableCoins,
    params.transactions,
    windowDays,
    referenceDate
  );

  const anchorKey = toUtcDateKey(
    new Date(
      Date.UTC(
        referenceDate.getUTCFullYear(),
        referenceDate.getUTCMonth(),
        referenceDate.getUTCDate()
      )
    )
  );

  // Map daily reward earnings across window
  const dailyRewardsByKey = new Map<string, number>();
  for (const tx of params.transactions) {
    if (tx.type !== 'DAILY_REWARD' || tx.status !== 'COMPLETED') continue;
    const key = parseUtcDateKey(tx.createdAt);
    if (!key) continue;
    const delta = Math.abs(getSignedTransactionDelta(tx));
    dailyRewardsByKey.set(key, (dailyRewardsByKey.get(key) || 0) + delta);
  }

  let runningCumulativeRewards = 0;
  const points: InvestmentGrowthChartPoint[] = liquidSeries.points.map((pt) => {
    const rewardsEarnedDay = dailyRewardsByKey.get(pt.dateKey) || 0;
    runningCumulativeRewards += rewardsEarnedDay;

    let activePlanCapitalOnDay = 0;
    for (const plan of params.plans) {
      if (plan.status === 'CANCELLED') continue;
      const startKey = parseUtcDateKey(plan.startDate || plan.createdAt);
      const endKey = parseUtcDateKey(plan.endDate);
      if (!startKey || startKey > pt.dateKey) continue;

      if (pt.dateKey === anchorKey) {
        if (plan.status === 'ACTIVE') {
          activePlanCapitalOnDay += Math.max(0, Math.round(plan.coinCost));
        }
      } else {
        const stillOngoingOnDay =
          !endKey || endKey >= pt.dateKey || (plan.status === 'ACTIVE' && pt.dateKey <= anchorKey);
        if (stillOngoingOnDay && (plan.status === 'ACTIVE' || (endKey !== null && endKey >= pt.dateKey))) {
          activePlanCapitalOnDay += Math.max(0, Math.round(plan.coinCost));
        }
      }
    }

    const totalPortfolioCoins = pt.balance + activePlanCapitalOnDay;
    return {
      dateKey: pt.dateKey,
      shortLabel: pt.shortLabel,
      fullLabel: pt.fullLabel,
      liquidCoins: pt.balance,
      activePlanCapital: activePlanCapitalOnDay,
      totalPortfolioCoins,
      rewardsEarnedDay,
      cumulativeRewards: runningCumulativeRewards,
    };
  });

  const activePlans = params.plans.filter((p) => p.status === 'ACTIVE');
  const completedPlans = params.plans.filter((p) => p.status === 'COMPLETED');
  const currentAvailableCoins = Math.max(0, Math.floor(params.currentAvailableCoins || 0));
  const activePlanCapital = activePlans.reduce(
    (sum, p) => sum + Math.max(0, Math.round(p.coinCost)),
    0
  );
  const currentPortfolioCoins = currentAvailableCoins + activePlanCapital;
  const startingPortfolioCoins =
    points.length > 0 ? points[0].totalPortfolioCoins : currentPortfolioCoins;
  const netPortfolioGrowthCoins = currentPortfolioCoins - startingPortfolioCoins;
  const netPortfolioGrowthPct =
    startingPortfolioCoins > 0
      ? Math.round((netPortfolioGrowthCoins / startingPortfolioCoins) * 1000) / 10
      : null;

  const totalExpectedEntitlement = activePlans.reduce(
    (sum, p) => sum + Math.max(0, Math.round(p.totalRewardEntitlement)),
    0
  );
  const remainingProjectedRewards = activePlans.reduce(
    (sum, p) => sum + Math.max(0, Math.round(p.remainingReward)),
    0
  );

  return {
    points,
    currentAvailableCoins,
    activePlanCapital,
    currentPortfolioCoins,
    netPortfolioGrowthCoins,
    netPortfolioGrowthPct,
    totalExpectedEntitlement,
    remainingProjectedRewards,
    totalRewardsInWindow: runningCumulativeRewards,
    activePlanCount: activePlans.length,
    completedPlanCount: completedPlans.length,
    hasData:
      params.plans.length > 0 ||
      params.transactions.length > 0 ||
      currentAvailableCoins > 0,
  };
}

/**
 * Aggregates live CoinTransaction, DepositRequest, and WithdrawalRequest
 * activity into daily cashflow bars and category volume distributions.
 */
export function buildTransactionActivityVisualSeries(params: {
  transactions: Pick<
    CoinTransaction,
    | 'transactionId'
    | 'type'
    | 'status'
    | 'amount'
    | 'previousBalance'
    | 'newBalance'
    | 'referenceId'
    | 'idempotencyKey'
    | 'createdAt'
  >[];
  deposits?: Pick<DepositRequest, 'depositId' | 'status'>[];
  withdrawals?: Pick<WithdrawalRequest, 'withdrawalId' | 'status'>[];
  windowDays?: ChartWindowDays;
  referenceDate?: Date;
}): TransactionVisualSummary {
  const windowDays = params.windowDays ?? 30;
  const referenceDate = params.referenceDate ?? new Date();

  const anchor = new Date(
    Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate()
    )
  );

  const orderedDays: { dateKey: string; date: Date }[] = [];
  const dayBuckets = new Map<
    string,
    {
      inflowsCoins: number;
      planAllocatedCoins: number;
      withdrawalsInr: number;
      txCount: number;
    }
  >();

  for (let offset = windowDays - 1; offset >= 0; offset--) {
    const day = new Date(anchor);
    day.setUTCDate(anchor.getUTCDate() - offset);
    const key = toUtcDateKey(day);
    orderedDays.push({ dateKey: key, date: day });
    dayBuckets.set(key, {
      inflowsCoins: 0,
      planAllocatedCoins: 0,
      withdrawalsInr: 0,
      txCount: 0,
    });
  }

  const categoryTotals: Record<
    'DEPOSITS' | 'REWARDS' | 'PLANS' | 'WITHDRAWALS' | 'ADJUSTMENTS',
    { label: string; volumeCoins: number; count: number; color: string }
  > = {
    DEPOSITS: { label: 'UPI Coin Deposits', volumeCoins: 0, count: 0, color: '#0B1A30' },
    REWARDS: { label: 'Daily Plan Rewards', volumeCoins: 0, count: 0, color: '#16A34A' },
    PLANS: { label: 'Plan Allocations', volumeCoins: 0, count: 0, color: '#C59B3B' },
    WITHDRAWALS: { label: 'INR Withdrawals', volumeCoins: 0, count: 0, color: '#D97706' },
    ADJUSTMENTS: { label: 'Refunds & Adjustments', volumeCoins: 0, count: 0, color: '#475569' },
  };

  let totalTransactionsWindow = 0;

  for (const tx of params.transactions) {
    if (tx.status === 'REJECTED' || tx.status === 'FAILED') continue;
    const key = parseUtcDateKey(tx.createdAt);
    if (!key) continue;
    const bucket = dayBuckets.get(key);
    if (!bucket) continue;

    // Withdrawal requests start PENDING at debit time; other credits/debits count once COMPLETED
    const isWithdrawalEntry = tx.type === 'WITHDRAWAL_REQUEST';
    if (!isWithdrawalEntry && tx.status !== 'COMPLETED') continue;

    const absAmt = Math.abs(Math.round(tx.amount || 0));
    if (absAmt <= 0) continue;

    bucket.txCount += 1;
    totalTransactionsWindow += 1;

    switch (tx.type) {
      case 'COIN_PURCHASE': {
        bucket.inflowsCoins += absAmt;
        categoryTotals.DEPOSITS.volumeCoins += absAmt;
        categoryTotals.DEPOSITS.count += 1;
        break;
      }
      case 'DAILY_REWARD': {
        bucket.inflowsCoins += absAmt;
        categoryTotals.REWARDS.volumeCoins += absAmt;
        categoryTotals.REWARDS.count += 1;
        break;
      }
      case 'PLAN_INVESTMENT': {
        bucket.planAllocatedCoins += absAmt;
        categoryTotals.PLANS.volumeCoins += absAmt;
        categoryTotals.PLANS.count += 1;
        break;
      }
      case 'WITHDRAWAL_REQUEST': {
        bucket.withdrawalsInr += absAmt;
        categoryTotals.WITHDRAWALS.volumeCoins += absAmt;
        categoryTotals.WITHDRAWALS.count += 1;
        break;
      }
      case 'WITHDRAWAL_REFUND': {
        bucket.inflowsCoins += absAmt;
        categoryTotals.ADJUSTMENTS.volumeCoins += absAmt;
        categoryTotals.ADJUSTMENTS.count += 1;
        break;
      }
      case 'ADMIN_ADJUSTMENT': {
        if (tx.amount >= 0) {
          bucket.inflowsCoins += absAmt;
        }
        categoryTotals.ADJUSTMENTS.volumeCoins += absAmt;
        categoryTotals.ADJUSTMENTS.count += 1;
        break;
      }
    }
  }

  const shortFmt = new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
  const fullFmt = new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const dailyCashflow: TransactionCashflowPoint[] = orderedDays.map(({ dateKey, date }) => {
    const b = dayBuckets.get(dateKey) || {
      inflowsCoins: 0,
      planAllocatedCoins: 0,
      withdrawalsInr: 0,
      txCount: 0,
    };
    return {
      dateKey,
      shortLabel: shortFmt.format(date),
      fullLabel: fullFmt.format(date),
      inflowsCoins: b.inflowsCoins,
      planAllocatedCoins: b.planAllocatedCoins,
      withdrawalsInr: b.withdrawalsInr,
      netFlowCoins: b.inflowsCoins - b.planAllocatedCoins - b.withdrawalsInr,
      txCount: b.txCount,
    };
  });

  const totalInflowsWindow = dailyCashflow.reduce((s, d) => s + d.inflowsCoins, 0);
  const totalPlanAllocatedWindow = dailyCashflow.reduce((s, d) => s + d.planAllocatedCoins, 0);
  const totalWithdrawalsWindow = dailyCashflow.reduce((s, d) => s + d.withdrawalsInr, 0);

  const rawCategories = Object.entries(categoryTotals)
    .map(([categoryKey, item]) => ({
      categoryKey,
      ...item,
    }))
    .filter((item) => item.volumeCoins > 0)
    .sort((a, b) => b.volumeCoins - a.volumeCoins);

  const totalVolumeWindow = rawCategories.reduce((s, c) => s + c.volumeCoins, 0);
  const categoryBreakdown: TransactionCategoryBreakdownItem[] = rawCategories.map((c) => ({
    ...c,
    sharePct:
      totalVolumeWindow > 0 ? Math.round((c.volumeCoins / totalVolumeWindow) * 1000) / 10 : 0,
  }));

  const pendingDeposits = (params.deposits || []).filter(
    (d) => d.status === 'PENDING' || d.status === 'UNDER_REVIEW'
  ).length;
  const pendingWithdrawals = (params.withdrawals || []).filter(
    (w) => w.status === 'PENDING' || w.status === 'PROCESSING' || w.status === 'UNDER_REVIEW'
  ).length;

  return {
    dailyCashflow,
    categoryBreakdown,
    totalInflowsWindow,
    totalPlanAllocatedWindow,
    totalWithdrawalsWindow,
    totalVolumeWindow,
    totalTransactionsWindow,
    pendingRequestsCount: pendingDeposits + pendingWithdrawals,
    hasTransactions: totalTransactionsWindow > 0,
  };
}
