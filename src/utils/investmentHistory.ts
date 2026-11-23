import {
  CoinTransaction,
  DepositRequest,
  UserPlan,
  WithdrawalRequest,
} from '../types/domain';
import { escapeCsvCell, formatCoins, formatInr } from './formatters';

export type InvestmentEntryCategory =
  | 'PLAN'
  | 'DEPOSIT'
  | 'REWARD'
  | 'WITHDRAWAL'
  | 'ADJUSTMENT';

export type InvestmentHistoryCategoryFilter =
  | 'ALL'
  | InvestmentEntryCategory;

export type InvestmentStatusBucket =
  | 'COMPLETED'
  | 'ACTIVE'
  | 'PENDING'
  | 'REJECTED';

export type InvestmentHistoryStatusFilter =
  | 'ALL'
  | InvestmentStatusBucket;

export interface InvestmentHistoryEntry {
  id: string;
  category: InvestmentEntryCategory;
  title: string;
  subtitle: string;
  referenceId: string;
  dateIso: string;
  amountDisplay: string;
  secondaryAmountDisplay?: string;
  isCredit: boolean;
  numericCoinValue: number;
  numericInrValue: number;
  rawStatus: string;
  statusLabel: string;
  statusBucket: InvestmentStatusBucket;
}

export interface InvestmentHistorySummary {
  totalEntries: number;
  totalPlanInvestedCoins: number;
  totalDepositedInr: number;
  totalRewardsCoins: number;
  activePlansCount: number;
}

function mapStatusMetadata(rawStatus: string): {
  statusLabel: string;
  statusBucket: InvestmentStatusBucket;
} {
  const upper = rawStatus.trim().toUpperCase();
  switch (upper) {
    case 'ACTIVE':
      return { statusLabel: 'Active', statusBucket: 'ACTIVE' };
    case 'COMPLETED':
      return { statusLabel: 'Completed', statusBucket: 'COMPLETED' };
    case 'APPROVED':
      return { statusLabel: 'Approved', statusBucket: 'COMPLETED' };
    case 'PAID':
      return { statusLabel: 'Paid', statusBucket: 'COMPLETED' };
    case 'PENDING':
      return { statusLabel: 'Pending', statusBucket: 'PENDING' };
    case 'PROCESSING':
      return { statusLabel: 'Processing', statusBucket: 'PENDING' };
    case 'UNDER_REVIEW':
      return { statusLabel: 'Under Review', statusBucket: 'PENDING' };
    case 'REJECTED':
      return { statusLabel: 'Rejected', statusBucket: 'REJECTED' };
    case 'FAILED':
      return { statusLabel: 'Failed', statusBucket: 'REJECTED' };
    case 'CANCELLED':
      return { statusLabel: 'Cancelled', statusBucket: 'REJECTED' };
    default:
      return { statusLabel: upper || 'Pending', statusBucket: 'PENDING' };
  }
}

export function buildInvestmentHistoryEntries(params: {
  plans?: UserPlan[];
  transactions?: CoinTransaction[];
  deposits?: DepositRequest[];
  withdrawals?: WithdrawalRequest[];
}): InvestmentHistoryEntry[] {
  const plans = params.plans ?? [];
  const transactions = params.transactions ?? [];
  const deposits = params.deposits ?? [];
  const withdrawals = params.withdrawals ?? [];

  const entries: InvestmentHistoryEntry[] = [];

  const planIdsFromPlans = new Set<string>();
  const depositIdsFromTx = new Set<string>();
  const withdrawalIdsFromRequests = new Set<string>();

  // 1. Structured Plan Enrollments (userPlans)
  for (const plan of plans) {
    planIdsFromPlans.add(plan.userPlanId);
    const { statusLabel, statusBucket } = mapStatusMetadata(plan.status);
    const cost = Math.max(0, Math.round(plan.coinCost));
    entries.push({
      id: `plan_${plan.userPlanId}`,
      category: 'PLAN',
      title: plan.productName || 'Structured Plan Investment',
      subtitle: `Day ${plan.daysCompleted}/${plan.durationDays} · Earned ${formatCoins(
        plan.collectedReward
      )} of ${formatCoins(plan.totalRewardEntitlement)}`,
      referenceId: plan.userPlanId,
      dateIso: plan.createdAt || plan.startDate,
      amountDisplay: formatCoins(cost),
      secondaryAmountDisplay: `${formatInr(cost)} equiv.`,
      isCredit: false,
      numericCoinValue: cost,
      numericInrValue: cost,
      rawStatus: plan.status,
      statusLabel,
      statusBucket,
    });
  }

  // 2. Withdrawals (withdrawalRequests)
  for (const wd of withdrawals) {
    withdrawalIdsFromRequests.add(wd.withdrawalId);
    const { statusLabel, statusBucket } = mapStatusMetadata(wd.status);
    const amountInr = Math.max(0, Math.round(wd.amountInr));
    entries.push({
      id: `wd_${wd.withdrawalId}`,
      category: 'WITHDRAWAL',
      title: 'INR Withdrawal Request',
      subtitle:
        wd.payoutDestinationMasked ||
        wd.payoutLabel ||
        wd.remarks ||
        'Payout settlement request',
      referenceId: wd.withdrawalId,
      dateIso: wd.createdAt || wd.updatedAt,
      amountDisplay: `-${formatInr(amountInr)}`,
      secondaryAmountDisplay: wd.payoutLabel || undefined,
      isCredit: false,
      numericCoinValue: 0,
      numericInrValue: amountInr,
      rawStatus: wd.status,
      statusLabel,
      statusBucket,
    });
  }

  // 3. Coin Transactions (coinTransactions)
  for (const tx of transactions) {
    // Avoid duplicating a plan already represented by userPlans
    if (tx.type === 'PLAN_INVESTMENT' && tx.referenceId && planIdsFromPlans.has(tx.referenceId)) {
      continue;
    }

    // Avoid duplicating a withdrawal already represented by withdrawalRequests
    if (
      tx.type === 'WITHDRAWAL_REQUEST' &&
      tx.referenceId &&
      withdrawalIdsFromRequests.has(tx.referenceId)
    ) {
      continue;
    }

    if (tx.type === 'COIN_PURCHASE') {
      if (tx.referenceId) depositIdsFromTx.add(tx.referenceId);
      if (tx.idempotencyKey) depositIdsFromTx.add(tx.idempotencyKey);
    }

    const { statusLabel, statusBucket } = mapStatusMetadata(tx.status);
    const absAmount = Math.abs(Math.round(tx.amount));
    const isInrAsset = tx.assetType === 'INR';
    const isDebit =
      tx.amount < 0 ||
      tx.type === 'PLAN_INVESTMENT' ||
      tx.type === 'WITHDRAWAL_REQUEST';
    const isCredit = !isDebit;

    let category: InvestmentEntryCategory = 'ADJUSTMENT';
    let title = 'Account Adjustment';
    if (tx.type === 'PLAN_INVESTMENT') {
      category = 'PLAN';
      title = 'Plan Allocation';
    } else if (tx.type === 'COIN_PURCHASE') {
      category = 'DEPOSIT';
      title = 'Coin Deposit Purchase';
    } else if (tx.type === 'DAILY_REWARD') {
      category = 'REWARD';
      title = 'Daily Plan Reward';
    } else if (tx.type === 'WITHDRAWAL_REQUEST') {
      category = 'WITHDRAWAL';
      title = 'Withdrawal Request';
    } else if (tx.type === 'WITHDRAWAL_REFUND') {
      category = 'WITHDRAWAL';
      title = 'Withdrawal Refund';
    }

    const formattedMagnitude = isInrAsset
      ? formatInr(absAmount)
      : formatCoins(absAmount);
    const amountDisplay = `${isCredit ? '+' : '-'}${formattedMagnitude}`;

    entries.push({
      id: `tx_${tx.transactionId}`,
      category,
      title,
      subtitle: tx.description || title,
      referenceId: tx.referenceId || tx.transactionId,
      dateIso: tx.createdAt,
      amountDisplay,
      secondaryAmountDisplay:
        !isInrAsset && category === 'DEPOSIT' ? formatInr(absAmount) : undefined,
      isCredit,
      numericCoinValue: isInrAsset ? 0 : absAmount,
      numericInrValue: isInrAsset || category === 'DEPOSIT' ? absAmount : 0,
      rawStatus: tx.status,
      statusLabel,
      statusBucket,
    });
  }

  // 4. Deposit Requests not already represented by a COIN_PURCHASE ledger transaction
  for (const dep of deposits) {
    if (depositIdsFromTx.has(dep.depositId)) {
      continue;
    }
    const { statusLabel, statusBucket } = mapStatusMetadata(dep.status);
    const amountInr = Math.max(0, Math.round(dep.amountInr));
    const coinsRequested = Math.max(0, Math.round(dep.coinsRequested));
    const pkgLabel = dep.packageName ? `${dep.packageName} · ` : '';
    const utrLabel = dep.utrNumber ? `UTR: ${dep.utrNumber}` : 'UPI Deposit Order';

    entries.push({
      id: `dep_${dep.depositId}`,
      category: 'DEPOSIT',
      title: dep.packageName ? `UPI Deposit (${dep.packageName})` : 'UPI Coin Deposit',
      subtitle: `${pkgLabel}${utrLabel}`,
      referenceId: dep.utrNumber || dep.depositId,
      dateIso: dep.createdAt,
      amountDisplay: `+${formatInr(amountInr)}`,
      secondaryAmountDisplay: formatCoins(coinsRequested),
      isCredit: true,
      numericCoinValue: coinsRequested,
      numericInrValue: amountInr,
      rawStatus: dep.status,
      statusLabel,
      statusBucket,
    });
  }

  return entries.sort((a, b) => (Date.parse(b.dateIso) || 0) - (Date.parse(a.dateIso) || 0));
}

export function filterInvestmentHistoryEntries(
  entries: InvestmentHistoryEntry[],
  category: InvestmentHistoryCategoryFilter,
  status: InvestmentHistoryStatusFilter,
  searchQuery: string
): InvestmentHistoryEntry[] {
  const q = searchQuery.trim().toLowerCase();
  return entries.filter((entry) => {
    if (category !== 'ALL' && entry.category !== category) return false;
    if (status !== 'ALL' && entry.statusBucket !== status) return false;
    if (!q) return true;
    return (
      entry.title.toLowerCase().includes(q) ||
      entry.subtitle.toLowerCase().includes(q) ||
      entry.referenceId.toLowerCase().includes(q) ||
      entry.statusLabel.toLowerCase().includes(q)
    );
  });
}

export function computeInvestmentHistorySummary(
  entries: InvestmentHistoryEntry[]
): InvestmentHistorySummary {
  let totalPlanInvestedCoins = 0;
  let totalDepositedInr = 0;
  let totalRewardsCoins = 0;
  let activePlansCount = 0;

  for (const entry of entries) {
    if (entry.category === 'PLAN' && entry.statusBucket !== 'REJECTED') {
      totalPlanInvestedCoins += entry.numericCoinValue;
      if (entry.statusBucket === 'ACTIVE') {
        activePlansCount += 1;
      }
    } else if (entry.category === 'DEPOSIT' && entry.statusBucket === 'COMPLETED') {
      totalDepositedInr += entry.numericInrValue;
    } else if (entry.category === 'REWARD' && entry.statusBucket === 'COMPLETED') {
      totalRewardsCoins += entry.numericCoinValue;
    }
  }

  return {
    totalEntries: entries.length,
    totalPlanInvestedCoins,
    totalDepositedInr,
    totalRewardsCoins,
    activePlansCount,
  };
}

export function investmentHistoryToCsv(entries: InvestmentHistoryEntry[]): string {
  const headers = [
    'Entry ID',
    'Date (UTC ISO)',
    'Category',
    'Title',
    'Details',
    'Reference ID',
    'Amount',
    'Secondary Amount',
    'Status',
  ];

  const rows = entries.map((entry) =>
    [
      escapeCsvCell(entry.id),
      escapeCsvCell(entry.dateIso),
      escapeCsvCell(entry.category),
      escapeCsvCell(entry.title),
      escapeCsvCell(entry.subtitle),
      escapeCsvCell(entry.referenceId),
      escapeCsvCell(entry.amountDisplay),
      escapeCsvCell(entry.secondaryAmountDisplay || ''),
      escapeCsvCell(entry.statusLabel),
    ].join(',')
  );

  return [headers.map((h) => escapeCsvCell(h)).join(','), ...rows].join('\r\n');
}
