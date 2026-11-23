import { COIN_CONVERSION_RATE } from '../config/constants';

export function formatInr(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatCoins(coins: number): string {
  return `${new Intl.NumberFormat('en-IN').format(coins)} Coins`;
}

export function convertInrToCoins(inr: number): number {
  return Math.floor(inr * COIN_CONVERSION_RATE.coinsPerInr);
}

/**
 * Deterministic integer remainder distribution across N days.
 * Ensures sum(dailySchedule) === totalRewardCoins with zero rounding drift.
 */
export function calculateDailyDistribution(
  totalRewardCoins: number,
  durationDays: number
): number[] {
  if (durationDays <= 0 || totalRewardCoins < 0) return [];
  const totalInt = Math.floor(totalRewardCoins);
  const baseDaily = Math.floor(totalInt / durationDays);
  const remainder = totalInt % durationDays;

  const schedule: number[] = [];
  for (let day = 0; day < durationDays; day++) {
    // Distribute +1 coin across the final `remainder` days or initial days deterministically
    const extra = day < remainder ? 1 : 0;
    schedule.push(baseDaily + extra);
  }
  return schedule;
}

export function formatSignedCoins(amount: number): string {
  const absFormatted = new Intl.NumberFormat('en-IN').format(Math.abs(amount));
  if (amount > 0) return `+${absFormatted} Coins`;
  if (amount < 0) return `-${absFormatted} Coins`;
  return `0 Coins`;
}

export function formatDateTimeInr(isoString: string): string {
  if (!isoString) return 'Pending timestamp';
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) return 'Invalid date';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

export type TransactionFilterCategory =
  | 'ALL'
  | 'DEPOSITS'
  | 'REWARDS'
  | 'WITHDRAWALS'
  | 'PLANS';

export function matchesTransactionCategory(
  type: string,
  category: TransactionFilterCategory
): boolean {
  switch (category) {
    case 'ALL':
      return true;
    case 'DEPOSITS':
      return type === 'COIN_PURCHASE' || type === 'ADMIN_ADJUSTMENT';
    case 'REWARDS':
      return type === 'DAILY_REWARD';
    case 'WITHDRAWALS':
      return type === 'WITHDRAWAL_REQUEST' || type === 'WITHDRAWAL_REFUND';
    case 'PLANS':
      return type === 'PLAN_INVESTMENT';
    default:
      return true;
  }
}

export function filterAndSortTransactions<
  T extends {
    type: string;
    description: string;
    referenceId: string;
    transactionId: string;
    createdAt: string;
  },
>(transactions: T[], category: TransactionFilterCategory, searchQuery: string): T[] {
  const q = searchQuery.trim().toLowerCase();
  return [...transactions]
    .filter((tx) => matchesTransactionCategory(tx.type, category))
    .filter((tx) => {
      if (!q) return true;
      return (
        tx.description.toLowerCase().includes(q) ||
        tx.referenceId.toLowerCase().includes(q) ||
        tx.transactionId.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const timeA = Date.parse(a.createdAt) || 0;
      const timeB = Date.parse(b.createdAt) || 0;
      return timeB - timeA;
    });
}

export interface ProfitProjectionResult {
  investmentInr: number;
  investedCoins: number;
  estimatedTotalCoins: number;
  netCoinGain: number;
  netGainPercent: number;
  durationDays: number;
  dailySchedule: number[];
  minDailyCoins: number;
  maxDailyCoins: number;
  planMultiplier: number;
}

export function calculateProfitProjection(
  investmentInr: number,
  plan: {
    coinDeductionAmount: number;
    durationDays: number;
    totalCoinReward: number;
  }
): ProfitProjectionResult {
  const safeInr =
    Number.isFinite(investmentInr) && investmentInr > 0 ? Math.floor(investmentInr) : 0;
  const investedCoins = convertInrToCoins(safeInr);
  const baseCost = plan.coinDeductionAmount > 0 ? plan.coinDeductionAmount : 1;
  const durationDays = plan.durationDays > 0 ? Math.floor(plan.durationDays) : 1;
  const planMultiplier = investedCoins / baseCost;

  const estimatedTotalCoins =
    investedCoins > 0
      ? Math.round(investedCoins * (plan.totalCoinReward / baseCost))
      : 0;
  const netCoinGain = Math.max(0, estimatedTotalCoins - investedCoins);
  const netGainPercent =
    investedCoins > 0 ? (netCoinGain / investedCoins) * 100 : 0;
  const dailySchedule =
    estimatedTotalCoins > 0
      ? calculateDailyDistribution(estimatedTotalCoins, durationDays)
      : Array.from({ length: durationDays }, () => 0);

  const minDailyCoins = dailySchedule.length ? Math.min(...dailySchedule) : 0;
  const maxDailyCoins = dailySchedule.length ? Math.max(...dailySchedule) : 0;

  return {
    investmentInr: safeInr,
    investedCoins,
    estimatedTotalCoins,
    netCoinGain,
    netGainPercent,
    durationDays,
    dailySchedule,
    minDailyCoins,
    maxDailyCoins,
    planMultiplier,
  };
}

export interface DailyRewardChartBucket {
  dateKey: string;
  shortLabel: string;
  fullLabel: string;
  coins: number;
  creditCount: number;
}

export interface DailyRewardAggregation {
  buckets: DailyRewardChartBucket[];
  totalCreditedInWindow: number;
  maxDailyCoins: number;
  activeDaysCount: number;
  avgPerActiveDay: number;
}

function toUtcDateKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function aggregateDailyRewardEarnings(
  entries: { coins: number; timestamp: string }[],
  windowDays: 7 | 14 | 30,
  referenceDate: Date = new Date()
): DailyRewardAggregation {
  const dayBuckets = new Map<string, { coins: number; count: number }>();

  const anchor = new Date(
    Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate()
    )
  );

  const orderedKeys: { dateKey: string; date: Date }[] = [];
  for (let offset = windowDays - 1; offset >= 0; offset--) {
    const day = new Date(anchor);
    day.setUTCDate(anchor.getUTCDate() - offset);
    const key = toUtcDateKey(day);
    orderedKeys.push({ dateKey: key, date: day });
    dayBuckets.set(key, { coins: 0, count: 0 });
  }

  for (const entry of entries) {
    if (!entry.timestamp || entry.coins <= 0) continue;
    const parsed = new Date(entry.timestamp);
    if (Number.isNaN(parsed.getTime())) continue;
    const key = toUtcDateKey(parsed);
    const existing = dayBuckets.get(key);
    if (existing) {
      existing.coins += Math.floor(entry.coins);
      existing.count += 1;
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

  const buckets: DailyRewardChartBucket[] = orderedKeys.map(({ dateKey, date }) => {
    const data = dayBuckets.get(dateKey) || { coins: 0, count: 0 };
    return {
      dateKey,
      shortLabel: shortFmt.format(date),
      fullLabel: fullFmt.format(date),
      coins: data.coins,
      creditCount: data.count,
    };
  });

  const totalCreditedInWindow = buckets.reduce((acc, b) => acc + b.coins, 0);
  const maxDailyCoins = buckets.reduce((max, b) => Math.max(max, b.coins), 0);
  const activeDaysCount = buckets.filter((b) => b.coins > 0).length;
  const avgPerActiveDay =
    activeDaysCount > 0 ? Math.round(totalCreditedInWindow / activeDaysCount) : 0;

  return {
    buckets,
    totalCreditedInWindow,
    maxDailyCoins,
    activeDaysCount,
    avgPerActiveDay,
  };
}

export interface PlanProgressItem {
  userPlanId: string;
  productName: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  collectedReward: number;
  totalRewardEntitlement: number;
  remainingReward: number;
  daysCompleted: number;
  durationDays: number;
  progressPct: number;
}

export function computePlanProgressItems(
  plans: {
    userPlanId: string;
    productName: string;
    status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
    collectedReward: number;
    totalRewardEntitlement: number;
    remainingReward: number;
    daysCompleted: number;
    durationDays: number;
  }[]
): PlanProgressItem[] {
  return plans.map((p) => {
    const entitlement = Math.max(0, p.totalRewardEntitlement);
    const collected = Math.max(0, p.collectedReward);
    const progressPct =
      entitlement > 0 ? Math.min(100, Math.round((collected / entitlement) * 100)) : 0;
    return {
      ...p,
      progressPct,
    };
  });
}

export interface CoinBalancePoint {
  dateKey: string;
  shortLabel: string;
  fullLabel: string;
  balance: number;
  netDelta: number;
  txCount: number;
}

export interface CoinBalanceGrowthSeries {
  points: CoinBalancePoint[];
  startingBalance: number;
  currentBalance: number;
  netGrowthCoins: number;
  netGrowthPercent: number | null;
  peakBalance: number;
  completedTransactionsInWindow: number;
}

export function getSignedTransactionDelta(tx: {
  type: string;
  status: string;
  amount: number;
  previousBalance?: number;
  newBalance?: number;
}): number {
  if (tx.status !== 'COMPLETED') return 0;

  if (
    typeof tx.newBalance === 'number' &&
    typeof tx.previousBalance === 'number' &&
    Number.isFinite(tx.newBalance) &&
    Number.isFinite(tx.previousBalance) &&
    (tx.newBalance !== 0 || tx.previousBalance !== 0)
  ) {
    return Math.round(tx.newBalance - tx.previousBalance);
  }

  const amt = Number.isFinite(tx.amount) ? Math.round(tx.amount) : 0;
  switch (tx.type) {
    case 'PLAN_INVESTMENT':
    case 'WITHDRAWAL_REQUEST':
      return -Math.abs(amt);
    case 'COIN_PURCHASE':
    case 'DAILY_REWARD':
    case 'WITHDRAWAL_REFUND':
      return Math.abs(amt);
    case 'ADMIN_ADJUSTMENT':
      return amt;
    default:
      return amt;
  }
}

export function buildCoinBalanceGrowthSeries(
  currentBalance: number,
  transactions: {
    type: string;
    status: string;
    amount: number;
    previousBalance?: number;
    newBalance?: number;
    createdAt: string;
  }[],
  windowDays = 30,
  referenceDate: Date = new Date()
): CoinBalanceGrowthSeries {
  const safeCurrent =
    Number.isFinite(currentBalance) && currentBalance > 0
      ? Math.floor(currentBalance)
      : 0;

  const anchor = new Date(
    Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate()
    )
  );

  const orderedDays: { dateKey: string; date: Date }[] = [];
  const dayNetDelta = new Map<string, { netDelta: number; txCount: number }>();

  for (let offset = windowDays - 1; offset >= 0; offset--) {
    const day = new Date(anchor);
    day.setUTCDate(anchor.getUTCDate() - offset);
    const key = toUtcDateKey(day);
    orderedDays.push({ dateKey: key, date: day });
    dayNetDelta.set(key, { netDelta: 0, txCount: 0 });
  }

  let completedTransactionsInWindow = 0;

  for (const tx of transactions) {
    if (tx.status !== 'COMPLETED' || !tx.createdAt) continue;
    const parsed = new Date(tx.createdAt);
    if (Number.isNaN(parsed.getTime())) continue;

    const key = toUtcDateKey(parsed);
    const bucket = dayNetDelta.get(key);
    if (bucket) {
      bucket.netDelta += getSignedTransactionDelta(tx);
      bucket.txCount += 1;
      completedTransactionsInWindow += 1;
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

  const points: CoinBalancePoint[] = new Array(orderedDays.length);
  let runningBalance = safeCurrent;

  for (let i = orderedDays.length - 1; i >= 0; i--) {
    const { dateKey, date } = orderedDays[i];
    const stats = dayNetDelta.get(dateKey) || { netDelta: 0, txCount: 0 };

    points[i] = {
      dateKey,
      shortLabel: shortFmt.format(date),
      fullLabel: fullFmt.format(date),
      balance: runningBalance,
      netDelta: stats.netDelta,
      txCount: stats.txCount,
    };

    runningBalance = Math.max(0, runningBalance - stats.netDelta);
  }

  const startingBalance = points.length > 0 ? points[0].balance : safeCurrent;
  const netGrowthCoins = safeCurrent - startingBalance;
  const netGrowthPercent =
    startingBalance > 0
      ? Math.round((netGrowthCoins / startingBalance) * 1000) / 10
      : null;
  const peakBalance = points.reduce(
    (max, p) => Math.max(max, p.balance),
    safeCurrent
  );

  return {
    points,
    startingBalance,
    currentBalance: safeCurrent,
    netGrowthCoins,
    netGrowthPercent,
    peakBalance,
    completedTransactionsInWindow,
  };
}

export function escapeCsvCell(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return '""';
  let str = String(raw);
  // Mitigate spreadsheet formula injection for string cells while allowing plain negative integers
  if (typeof raw === 'string' && /^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function transactionsToCsv(
  transactions: {
    transactionId: string;
    createdAt: string;
    type: string;
    description: string;
    referenceId: string;
    status: string;
    amount: number;
    previousBalance: number;
    newBalance: number;
  }[]
): string {
  const headers = [
    'Transaction ID',
    'Timestamp (UTC ISO)',
    'Type',
    'Description',
    'Reference ID',
    'Status',
    'Signed Amount (Coins)',
    'Previous Balance (Coins)',
    'Balance After (Coins)',
  ];

  const rows = transactions.map((tx) => {
    const absAmount = Math.abs(tx.amount);
    const isDebit =
      tx.amount < 0 ||
      tx.type === 'WITHDRAWAL_REQUEST' ||
      tx.type === 'PLAN_INVESTMENT';
    const signedAmount = isDebit ? -absAmount : absAmount;

    return [
      escapeCsvCell(tx.transactionId),
      escapeCsvCell(tx.createdAt),
      escapeCsvCell(tx.type),
      escapeCsvCell(tx.description),
      escapeCsvCell(tx.referenceId),
      escapeCsvCell(tx.status),
      escapeCsvCell(signedAmount),
      escapeCsvCell(tx.previousBalance),
      escapeCsvCell(tx.newBalance),
    ].join(',');
  });

  return [headers.map((h) => escapeCsvCell(h)).join(','), ...rows].join('\r\n');
}

export interface DepositWithdrawalTrendPoint {
  dateKey: string;
  shortLabel: string;
  fullLabel: string;
  deposits: number;
  withdrawals: number;
}

export interface DepositWithdrawalTrendSummary {
  points: DepositWithdrawalTrendPoint[];
  totalDeposits30d: number;
  totalWithdrawals30d: number;
  netFlow30d: number;
}

export function aggregateDepositWithdrawalTrends30d(
  transactions: {
    type: string;
    status: string;
    amount: number;
    referenceId?: string;
    idempotencyKey?: string;
    createdAt: string;
  }[],
  depositRequests: {
    depositId: string;
    amountInr: number;
    status: string;
    createdAt: string;
  }[] = [],
  withdrawalRequests: {
    withdrawalId: string;
    amountInr: number;
    status: string;
    createdAt: string;
  }[] = [],
  windowDays = 30,
  referenceDate: Date = new Date()
): DepositWithdrawalTrendSummary {
  const anchor = new Date(
    Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate()
    )
  );

  const orderedDays: { dateKey: string; date: Date }[] = [];
  const buckets = new Map<string, { deposits: number; withdrawals: number }>();

  for (let offset = windowDays - 1; offset >= 0; offset--) {
    const day = new Date(anchor);
    day.setUTCDate(anchor.getUTCDate() - offset);
    const key = toUtcDateKey(day);
    orderedDays.push({ dateKey: key, date: day });
    buckets.set(key, { deposits: 0, withdrawals: 0 });
  }

  const accountedDepositIds = new Set<string>();
  const accountedWithdrawalIds = new Set<string>();

  for (const tx of transactions) {
    if (tx.status === 'REJECTED' || tx.status === 'FAILED' || !tx.createdAt) continue;
    const parsed = new Date(tx.createdAt);
    if (Number.isNaN(parsed.getTime())) continue;
    const key = toUtcDateKey(parsed);
    const bucket = buckets.get(key);

    if (tx.type === 'COIN_PURCHASE') {
      if (tx.idempotencyKey) accountedDepositIds.add(tx.idempotencyKey);
      if (bucket) bucket.deposits += Math.abs(Math.round(tx.amount));
    } else if (tx.type === 'WITHDRAWAL_REQUEST') {
      if (tx.referenceId) accountedWithdrawalIds.add(tx.referenceId);
      if (bucket) bucket.withdrawals += Math.abs(Math.round(tx.amount));
    }
  }

  for (const dep of depositRequests) {
    if (dep.status === 'REJECTED' || accountedDepositIds.has(dep.depositId) || !dep.createdAt) {
      continue;
    }
    const parsed = new Date(dep.createdAt);
    if (Number.isNaN(parsed.getTime())) continue;
    const bucket = buckets.get(toUtcDateKey(parsed));
    if (bucket) bucket.deposits += Math.abs(Math.round(dep.amountInr));
  }

  for (const wd of withdrawalRequests) {
    if (wd.status === 'REJECTED' || accountedWithdrawalIds.has(wd.withdrawalId) || !wd.createdAt) {
      continue;
    }
    const parsed = new Date(wd.createdAt);
    if (Number.isNaN(parsed.getTime())) continue;
    const bucket = buckets.get(toUtcDateKey(parsed));
    if (bucket) bucket.withdrawals += Math.abs(Math.round(wd.amountInr));
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

  const points: DepositWithdrawalTrendPoint[] = orderedDays.map(({ dateKey, date }) => {
    const data = buckets.get(dateKey) || { deposits: 0, withdrawals: 0 };
    return {
      dateKey,
      shortLabel: shortFmt.format(date),
      fullLabel: fullFmt.format(date),
      deposits: data.deposits,
      withdrawals: data.withdrawals,
    };
  });

  const totalDeposits30d = points.reduce((sum, p) => sum + p.deposits, 0);
  const totalWithdrawals30d = points.reduce((sum, p) => sum + p.withdrawals, 0);

  return {
    points,
    totalDeposits30d,
    totalWithdrawals30d,
    netFlow30d: totalDeposits30d - totalWithdrawals30d,
  };
}





