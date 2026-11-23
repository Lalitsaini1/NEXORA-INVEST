import assert from 'node:assert/strict';
import test from 'node:test';
import { CoinTransaction, DailyRewardRecord, TransactionStatus } from '../../types/domain';
import {
  detectCompletedTransactionToasts,
  detectNewDailyRewardToasts,
} from '../realtimeNotifications';

function makeReward(overrides: Partial<DailyRewardRecord> = {}): DailyRewardRecord {
  return {
    rewardId: 'rwd_1',
    userPlanId: 'up_1',
    uid: 'user_1',
    userId: 'NX100001',
    rewardDayNumber: 1,
    coinsCredited: 27,
    scheduledFor: '2026-11-22T06:00:00.000Z',
    creditedAt: '2026-11-22T06:05:00.000Z',
    ...overrides,
  };
}

function makeTx(overrides: Partial<CoinTransaction> = {}): CoinTransaction {
  return {
    transactionId: 'tx_1',
    uid: 'user_1',
    userId: 'NX100001',
    type: 'COIN_PURCHASE',
    amount: 500,
    previousBalance: 0,
    newBalance: 500,
    referenceId: 'UTR12345',
    idempotencyKey: 'idem_1',
    status: 'PENDING',
    description: 'UPI coin purchase #UTR12345',
    createdAt: '2026-11-22T08:00:00.000Z',
    ...overrides,
  };
}

test('detectNewDailyRewardToasts ignores initial snapshot and alerts only newly distributed rewards', () => {
  const seen = new Set<string>();

  const initial = detectNewDailyRewardToasts(
    [makeReward({ rewardId: 'rwd_existing', coinsCredited: 27 })],
    seen,
    true,
    1000
  );
  assert.equal(initial.length, 0);
  assert.equal(seen.has('rwd_existing'), true);

  const live = detectNewDailyRewardToasts(
    [
      makeReward({ rewardId: 'rwd_existing', coinsCredited: 27 }),
      makeReward({ rewardId: 'rwd_new', rewardDayNumber: 4, coinsCredited: 46 }),
    ],
    seen,
    false,
    2000
  );
  assert.equal(live.length, 1);
  assert.equal(live[0].tone, 'reward');
  assert.equal(live[0].title, 'Daily Coin Reward Distributed');
  assert.equal(live[0].amountLabel, '+46 Coins');
  assert.match(live[0].message, /Day 4/);
  assert.equal(live[0].dedupeKey, 'ref:rwd_new');

  // Repeated snapshot with same IDs produces zero duplicates
  const repeated = detectNewDailyRewardToasts(
    [
      makeReward({ rewardId: 'rwd_existing', coinsCredited: 27 }),
      makeReward({ rewardId: 'rwd_new', rewardDayNumber: 4, coinsCredited: 46 }),
    ],
    seen,
    false,
    3000
  );
  assert.equal(repeated.length, 0);
});

test('detectCompletedTransactionToasts fires when transaction transitions to COMPLETED or arrives completed after initial load', () => {
  const statuses = new Map<string, TransactionStatus>();

  // Initial load: one PENDING and one already COMPLETED -> zero toasts
  const initial = detectCompletedTransactionToasts(
    [
      makeTx({ transactionId: 'tx_pending', status: 'PENDING' }),
      makeTx({ transactionId: 'tx_old_done', status: 'COMPLETED' }),
    ],
    statuses,
    true,
    1000
  );
  assert.equal(initial.length, 0);

  // Subsequent update: tx_pending -> COMPLETED, plus new tx_reward arrives COMPLETED
  const live = detectCompletedTransactionToasts(
    [
      makeTx({ transactionId: 'tx_pending', status: 'COMPLETED', amount: 1000, previousBalance: 0, newBalance: 1000 }),
      makeTx({ transactionId: 'tx_old_done', status: 'COMPLETED' }),
      makeTx({
        transactionId: 'tx_reward',
        type: 'DAILY_REWARD',
        status: 'COMPLETED',
        amount: 27,
        previousBalance: 1000,
        newBalance: 1027,
        referenceId: 'rwd_new',
        description: 'Day 4 reward distribution',
      }),
    ],
    statuses,
    false,
    2000
  );

  assert.equal(live.length, 2);
  assert.equal(live[0].title, 'Coin Deposit Completed');
  assert.equal(live[0].amountLabel, '+1,000 Coins');
  assert.equal(live[0].tone, 'success');

  assert.equal(live[1].title, 'Daily Coin Reward Distributed');
  assert.equal(live[1].amountLabel, '+27 Coins');
  assert.equal(live[1].dedupeKey, 'ref:rwd_new');
});
