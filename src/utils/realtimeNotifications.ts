import { CoinTransaction, DailyRewardRecord, TransactionStatus } from '../types/domain';
import { formatSignedCoins, getSignedTransactionDelta } from './formatters';

export type ToastTone = 'reward' | 'success' | 'info';

export interface RealtimeToastItem {
  id: string;
  dedupeKey: string;
  tone: ToastTone;
  title: string;
  message: string;
  amountLabel?: string;
  createdAtMs: number;
}

function getTransactionToastTitle(type: CoinTransaction['type']): string {
  switch (type) {
    case 'COIN_PURCHASE':
      return 'Coin Deposit Completed';
    case 'DAILY_REWARD':
      return 'Daily Coin Reward Distributed';
    case 'PLAN_INVESTMENT':
      return 'Product Plan Activated';
    case 'WITHDRAWAL_REQUEST':
      return 'Withdrawal Request Completed';
    case 'WITHDRAWAL_REFUND':
      return 'Withdrawal Refund Credited';
    case 'ADMIN_ADJUSTMENT':
      return 'Wallet Adjustment Completed';
    default:
      return 'Transaction Completed';
  }
}

/**
 * Seeds `seenRewardIds` on the initial Firestore snapshot without emitting toasts,
 * then emits a toast whenever a new `DailyRewardRecord` arrives in real time.
 */
export function detectNewDailyRewardToasts(
  records: DailyRewardRecord[],
  seenRewardIds: Set<string>,
  isInitialSnapshot: boolean,
  nowMs: number = Date.now()
): RealtimeToastItem[] {
  const emitted: RealtimeToastItem[] = [];

  for (const record of records) {
    if (!record.rewardId) continue;
    const alreadySeen = seenRewardIds.has(record.rewardId);
    seenRewardIds.add(record.rewardId);

    if (isInitialSnapshot || alreadySeen || record.coinsCredited <= 0) {
      continue;
    }

    const dayLabel =
      record.rewardDayNumber > 0 ? `Day ${record.rewardDayNumber} ` : '';

    emitted.push({
      id: `reward_${record.rewardId}_${nowMs}`,
      dedupeKey: `ref:${record.rewardId}`,
      tone: 'reward',
      title: 'Daily Coin Reward Distributed',
      message: `${dayLabel}reward credit has been added to your virtual coin wallet.`,
      amountLabel: formatSignedCoins(record.coinsCredited),
      createdAtMs: nowMs,
    });
  }

  return emitted;
}

/**
 * Tracks `knownStatuses` across snapshots. On initial snapshot, records existing
 * statuses silently; on subsequent updates, emits toasts when any transaction
 * newly enters `COMPLETED` status (either newly added or transitioned from PENDING).
 */
export function detectCompletedTransactionToasts(
  transactions: CoinTransaction[],
  knownStatuses: Map<string, TransactionStatus>,
  isInitialSnapshot: boolean,
  nowMs: number = Date.now()
): RealtimeToastItem[] {
  const emitted: RealtimeToastItem[] = [];

  for (const tx of transactions) {
    if (!tx.transactionId) continue;
    const previousStatus = knownStatuses.get(tx.transactionId);
    knownStatuses.set(tx.transactionId, tx.status);

    if (isInitialSnapshot) {
      continue;
    }

    const becameCompleted = tx.status === 'COMPLETED' && previousStatus !== 'COMPLETED';
    if (!becameCompleted) {
      continue;
    }

    const delta = getSignedTransactionDelta(tx);
    const amountLabel = delta !== 0 ? formatSignedCoins(delta) : undefined;
    const dedupeKey =
      tx.type === 'DAILY_REWARD' && tx.referenceId
        ? `ref:${tx.referenceId}`
        : `tx:${tx.transactionId}`;

    emitted.push({
      id: `tx_${tx.transactionId}_${nowMs}`,
      dedupeKey,
      tone: tx.type === 'DAILY_REWARD' ? 'reward' : 'success',
      title: getTransactionToastTitle(tx.type),
      message:
        tx.description?.trim() ||
        'Your virtual coin ledger and wallet balance have been updated.',
      amountLabel,
      createdAtMs: nowMs,
    });
  }

  return emitted;
}
