import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateDailyRewardEarnings,
  calculateDailyDistribution,
  calculateProfitProjection,
  computePlanProgressItems,
  convertInrToCoins,
  filterAndSortTransactions,
  formatDateTimeInr,
  formatSignedCoins,
} from '../formatters.ts';
import {
  normalizeIndianMobile,
  validateEmail,
  validateIndianMobile,
  validateOtpCode,
  validatePassword,
} from '../validators.ts';

test('convertInrToCoins enforces fixed initial rate ₹100 = 100 Virtual Coins', () => {
  assert.equal(convertInrToCoins(100), 100);
  assert.equal(convertInrToCoins(500), 500);
  assert.equal(convertInrToCoins(1000), 1000);
  assert.equal(convertInrToCoins(5000), 5000);
});

test('calculateDailyDistribution distributes 188 coins over 7 days with zero rounding drift', () => {
  const schedule = calculateDailyDistribution(188, 7);
  assert.equal(schedule.length, 7);
  const sum = schedule.reduce((acc, val) => acc + val, 0);
  assert.equal(sum, 188);
  assert.deepEqual(schedule, [27, 27, 27, 27, 27, 27, 26]);
});

test('validators validate email, Indian mobile, password, and OTP', () => {
  assert.equal(validateEmail('member@nexora.in'), null);
  assert.notEqual(validateEmail('invalid-email'), null);

  assert.equal(validateIndianMobile('9876543210'), null);
  assert.equal(normalizeIndianMobile('9876543210'), '+919876543210');
  assert.notEqual(validateIndianMobile('12345'), null);

  assert.equal(validatePassword('Nexora2026'), null);
  assert.notEqual(validatePassword('weak'), null);

  assert.equal(validateOtpCode('123456'), null);
  assert.notEqual(validateOtpCode('1234'), null);
});

test('formatSignedCoins and formatDateTimeInr format deltas and timestamps cleanly', () => {
  assert.equal(formatSignedCoins(1500), '+1,500 Coins');
  assert.equal(formatSignedCoins(-500), '-500 Coins');
  assert.equal(formatSignedCoins(0), '0 Coins');

  assert.equal(formatDateTimeInr(''), 'Pending timestamp');
  assert.equal(formatDateTimeInr('not-a-date'), 'Invalid date');
  assert.match(formatDateTimeInr('2026-11-22T10:30:00.000Z'), /2026/);
});

test('filterAndSortTransactions filters deposits, rewards, withdrawals, search text and sorts newest first', () => {
  const sample = [
    {
      transactionId: 'tx_old',
      type: 'COIN_PURCHASE',
      description: 'UPI Deposit Verified',
      referenceId: 'UTR10001',
      createdAt: '2026-11-20T09:00:00.000Z',
    },
    {
      transactionId: 'tx_mid',
      type: 'WITHDRAWAL_REQUEST',
      description: 'Bank payout request',
      referenceId: 'WD20002',
      createdAt: '2026-11-21T14:00:00.000Z',
    },
    {
      transactionId: 'tx_new',
      type: 'DAILY_REWARD',
      description: 'Daily plan distribution Day 2',
      referenceId: 'RWD30003',
      createdAt: '2026-11-22T08:00:00.000Z',
    },
  ];

  const allSorted = filterAndSortTransactions(sample, 'ALL', '');
  assert.deepEqual(
    allSorted.map((t) => t.transactionId),
    ['tx_new', 'tx_mid', 'tx_old']
  );

  assert.deepEqual(
    filterAndSortTransactions(sample, 'DEPOSITS', '').map((t) => t.transactionId),
    ['tx_old']
  );
  assert.deepEqual(
    filterAndSortTransactions(sample, 'REWARDS', '').map((t) => t.transactionId),
    ['tx_new']
  );
  assert.deepEqual(
    filterAndSortTransactions(sample, 'WITHDRAWALS', '').map((t) => t.transactionId),
    ['tx_mid']
  );
  assert.deepEqual(
    filterAndSortTransactions(sample, 'ALL', 'wd20002').map((t) => t.transactionId),
    ['tx_mid']
  );
});

test('calculateProfitProjection computes exact scaled returns and integer daily schedules', () => {
  const laptopPlan = {
    coinDeductionAmount: 100,
    durationDays: 7,
    totalCoinReward: 188,
  };
  const base = calculateProfitProjection(100, laptopPlan);
  assert.equal(base.investedCoins, 100);
  assert.equal(base.estimatedTotalCoins, 188);
  assert.equal(base.netCoinGain, 88);
  assert.equal(base.netGainPercent, 88);
  assert.equal(
    base.dailySchedule.reduce((a, b) => a + b, 0),
    188
  );

  const scaled = calculateProfitProjection(1000, {
    coinDeductionAmount: 1000,
    durationDays: 21,
    totalCoinReward: 1320,
  });
  assert.equal(scaled.investedCoins, 1000);
  assert.equal(scaled.estimatedTotalCoins, 1320);
  assert.equal(scaled.netCoinGain, 320);
  assert.equal(scaled.dailySchedule.length, 21);
  assert.equal(
    scaled.dailySchedule.reduce((a, b) => a + b, 0),
    1320
  );

  const zero = calculateProfitProjection(0, laptopPlan);
  assert.equal(zero.estimatedTotalCoins, 0);
  assert.equal(zero.netCoinGain, 0);
});

test('aggregateDailyRewardEarnings buckets daily credits by UTC day and computes totals/averages', () => {
  const ref = new Date('2026-11-22T12:00:00.000Z');
  const agg = aggregateDailyRewardEarnings(
    [
      { coins: 27, timestamp: '2026-11-22T06:00:00.000Z' },
      { coins: 46, timestamp: '2026-11-22T09:00:00.000Z' },
      { coins: 27, timestamp: '2026-11-20T06:00:00.000Z' },
      { coins: 99, timestamp: '2026-10-01T06:00:00.000Z' }, // outside 7D window
    ],
    7,
    ref
  );

  assert.equal(agg.buckets.length, 7);
  assert.equal(agg.totalCreditedInWindow, 100);
  assert.equal(agg.maxDailyCoins, 73);
  assert.equal(agg.activeDaysCount, 2);
  assert.equal(agg.avgPerActiveDay, 50);
  assert.equal(agg.buckets[6].dateKey, '2026-11-22');
  assert.equal(agg.buckets[6].coins, 73);
  assert.equal(agg.buckets[6].creditCount, 2);
});

test('computePlanProgressItems computes bounded completion percentages', () => {
  const items = computePlanProgressItems([
    {
      userPlanId: 'up_1',
      productName: 'Laptop Plan',
      status: 'ACTIVE',
      collectedReward: 94,
      totalRewardEntitlement: 188,
      remainingReward: 94,
      daysCompleted: 3,
      durationDays: 7,
    },
    {
      userPlanId: 'up_2',
      productName: 'Machinery Plan',
      status: 'COMPLETED',
      collectedReward: 650,
      totalRewardEntitlement: 650,
      remainingReward: 0,
      daysCompleted: 14,
      durationDays: 14,
    },
  ]);

  assert.equal(items[0].progressPct, 50);
  assert.equal(items[1].progressPct, 100);
});

import {
  buildCoinBalanceGrowthSeries,
  getSignedTransactionDelta,
} from '../formatters.ts';

test('getSignedTransactionDelta resolves completed credit/debit deltas accurately', () => {
  assert.equal(
    getSignedTransactionDelta({
      type: 'COIN_PURCHASE',
      status: 'COMPLETED',
      amount: 500,
      previousBalance: 100,
      newBalance: 600,
    }),
    500
  );
  assert.equal(
    getSignedTransactionDelta({
      type: 'PLAN_INVESTMENT',
      status: 'COMPLETED',
      amount: 300,
      previousBalance: 600,
      newBalance: 300,
    }),
    -300
  );
  assert.equal(
    getSignedTransactionDelta({
      type: 'COIN_PURCHASE',
      status: 'PENDING',
      amount: 1000,
    }),
    0
  );
});

test('buildCoinBalanceGrowthSeries reconstructs 30-day coin balance curve from current balance and transactions', () => {
  const ref = new Date('2026-11-22T12:00:00.000Z');
  const series = buildCoinBalanceGrowthSeries(
    650,
    [
      {
        type: 'COIN_PURCHASE',
        status: 'COMPLETED',
        amount: 500,
        previousBalance: 0,
        newBalance: 500,
        createdAt: '2026-11-18T10:00:00.000Z',
      },
      {
        type: 'PLAN_INVESTMENT',
        status: 'COMPLETED',
        amount: 100,
        previousBalance: 500,
        newBalance: 400,
        createdAt: '2026-11-19T10:00:00.000Z',
      },
      {
        type: 'DAILY_REWARD',
        status: 'COMPLETED',
        amount: 250,
        previousBalance: 400,
        newBalance: 650,
        createdAt: '2026-11-22T08:00:00.000Z',
      },
    ],
    30,
    ref
  );

  assert.equal(series.points.length, 30);
  assert.equal(series.startingBalance, 0);
  assert.equal(series.currentBalance, 650);
  assert.equal(series.netGrowthCoins, 650);
  assert.equal(series.peakBalance, 650);
  assert.equal(series.completedTransactionsInWindow, 3);

  const dayNov18 = series.points.find((p) => p.dateKey === '2026-11-18');
  const dayNov19 = series.points.find((p) => p.dateKey === '2026-11-19');
  const dayNov22 = series.points.find((p) => p.dateKey === '2026-11-22');
  assert.equal(dayNov18?.balance, 500);
  assert.equal(dayNov19?.balance, 400);
  assert.equal(dayNov22?.balance, 650);

  const emptySeries = buildCoinBalanceGrowthSeries(0, [], 30, ref);
  assert.equal(emptySeries.points.length, 30);
  assert.equal(emptySeries.peakBalance, 0);
  assert.equal(emptySeries.points.every((p) => p.balance === 0), true);
});

import {
  aggregateDepositWithdrawalTrends30d,
  escapeCsvCell,
  transactionsToCsv,
} from '../formatters.ts';

test('escapeCsvCell neutralizes spreadsheet formula injection on strings while preserving negative numbers', () => {
  assert.equal(escapeCsvCell('Normal text'), '"Normal text"');
  assert.equal(escapeCsvCell('Quote "test"'), '"Quote ""test"""');
  assert.equal(escapeCsvCell('=CMD("calc")'), '"\'=CMD(""calc"")"');
  assert.equal(escapeCsvCell('+1+1'), '"\'+1+1"');
  assert.equal(escapeCsvCell('-2+3'), '"\'-2+3"');
  assert.equal(escapeCsvCell('@SUM(A1:A2)'), '"\'@SUM(A1:A2)"');
  assert.equal(escapeCsvCell(-250), '"-250"');
});

test('transactionsToCsv formats header row and signed transaction amounts in RFC-4180 CSV', () => {
  const csv = transactionsToCsv([
    {
      transactionId: 'tx_1',
      createdAt: '2026-11-22T09:00:00.000Z',
      type: 'COIN_PURCHASE',
      description: 'UPI Deposit "Verified"',
      referenceId: 'UTR999',
      status: 'COMPLETED',
      amount: 500,
      previousBalance: 0,
      newBalance: 500,
    },
    {
      transactionId: 'tx_2',
      createdAt: '2026-11-22T10:00:00.000Z',
      type: 'WITHDRAWAL_REQUEST',
      description: 'Payout requested',
      referenceId: 'WD101',
      status: 'PENDING',
      amount: 200,
      previousBalance: 500,
      newBalance: 300,
    },
  ]);

  const lines = csv.split('\r\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^"Transaction ID","Timestamp \(UTC ISO\)"/);
  assert.match(lines[1], /"tx_1".*"UPI Deposit ""Verified""".*"500"/);
  assert.match(lines[2], /"tx_2".*"-200"/);
});

test('aggregateDepositWithdrawalTrends30d computes 30-day deposit vs withdrawal totals without double counting', () => {
  const ref = new Date('2026-11-22T12:00:00.000Z');
  const trend = aggregateDepositWithdrawalTrends30d(
    [
      {
        type: 'COIN_PURCHASE',
        status: 'COMPLETED',
        amount: 1000,
        idempotencyKey: 'dep_1',
        createdAt: '2026-11-22T09:00:00.000Z',
      },
      {
        type: 'WITHDRAWAL_REQUEST',
        status: 'COMPLETED',
        amount: 300,
        referenceId: 'wd_1',
        createdAt: '2026-11-21T09:00:00.000Z',
      },
    ],
    [
      // dep_1 already settled in coinTransactions -> must not double count
      {
        depositId: 'dep_1',
        amountInr: 1000,
        status: 'APPROVED',
        createdAt: '2026-11-22T09:00:00.000Z',
      },
      // dep_2 still pending in queue -> included once
      {
        depositId: 'dep_2',
        amountInr: 500,
        status: 'PENDING',
        createdAt: '2026-11-20T09:00:00.000Z',
      },
    ],
    [
      // wd_1 already settled -> must not double count
      {
        withdrawalId: 'wd_1',
        amountInr: 300,
        status: 'PAID',
        createdAt: '2026-11-21T09:00:00.000Z',
      },
      // wd_rejected -> excluded
      {
        withdrawalId: 'wd_rejected',
        amountInr: 999,
        status: 'REJECTED',
        createdAt: '2026-11-21T09:00:00.000Z',
      },
    ],
    30,
    ref
  );

  assert.equal(trend.points.length, 30);
  assert.equal(trend.totalDeposits30d, 1500);
  assert.equal(trend.totalWithdrawals30d, 300);
  assert.equal(trend.netFlow30d, 1200);
});



