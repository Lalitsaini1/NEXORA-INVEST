import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildInvestmentHistoryEntries,
  computeInvestmentHistorySummary,
  filterInvestmentHistoryEntries,
  investmentHistoryToCsv,
} from '../investmentHistory';
import {
  CoinTransaction,
  DepositRequest,
  UserPlan,
  WithdrawalRequest,
} from '../../types/domain';

test('buildInvestmentHistoryEntries merges userPlans, coinTransactions, depositRequests, and withdrawalRequests without duplicating linked records', () => {
  const plans: UserPlan[] = [
    {
      userPlanId: 'uplan_1',
      uid: 'uid_1',
      userId: 'NX100001',
      planId: 'plan_server',
      productName: 'Cloud Server Compute Plan',
      imageUrl: '',
      coinCost: 500,
      durationDays: 10,
      totalRewardEntitlement: 650,
      collectedReward: 195,
      remainingReward: 455,
      daysCompleted: 3,
      remainingDays: 7,
      startDate: '2026-11-20T00:00:00.000Z',
      endDate: '2026-11-30T00:00:00.000Z',
      nextRewardEligibilityTime: null,
      status: 'ACTIVE',
      createdAt: '2026-11-20T08:00:00.000Z',
    },
  ];

  const transactions: CoinTransaction[] = [
    {
      transactionId: 'tx_plan_1',
      uid: 'uid_1',
      userId: 'NX100001',
      type: 'PLAN_INVESTMENT',
      assetType: 'COINS',
      amount: -500,
      previousBalance: 1000,
      newBalance: 500,
      referenceId: 'uplan_1',
      idempotencyKey: 'uplan_1',
      status: 'COMPLETED',
      description: 'Enrolled in Cloud Server Compute Plan',
      createdAt: '2026-11-20T08:00:00.000Z',
    },
    {
      transactionId: 'tx_dep_1',
      uid: 'uid_1',
      userId: 'NX100001',
      type: 'COIN_PURCHASE',
      assetType: 'COINS',
      amount: 1000,
      previousBalance: 0,
      newBalance: 1000,
      referenceId: 'dep_1',
      idempotencyKey: 'dep_1',
      status: 'COMPLETED',
      description: 'Approved UPI Deposit ₹1,000',
      createdAt: '2026-11-19T09:00:00.000Z',
    },
    {
      transactionId: 'tx_rew_1',
      uid: 'uid_1',
      userId: 'NX100001',
      type: 'DAILY_REWARD',
      assetType: 'COINS',
      amount: 65,
      previousBalance: 500,
      newBalance: 565,
      referenceId: 'rew_1',
      idempotencyKey: 'rew_1',
      status: 'COMPLETED',
      description: 'Daily Reward Day 1',
      createdAt: '2026-11-21T09:00:00.000Z',
    },
    {
      transactionId: 'wtx_wd_1',
      uid: 'uid_1',
      userId: 'NX100001',
      type: 'WITHDRAWAL_REQUEST',
      assetType: 'INR',
      amount: -200,
      previousBalance: 500,
      newBalance: 300,
      referenceId: 'wd_1',
      idempotencyKey: 'wd_1',
      status: 'PENDING',
      description: 'INR Withdrawal ₹200',
      createdAt: '2026-11-22T10:00:00.000Z',
    },
  ];

  const deposits: DepositRequest[] = [
    {
      depositId: 'dep_1',
      uid: 'uid_1',
      userId: 'NX100001',
      amountInr: 1000,
      coinsRequested: 1000,
      assignedUpiAccountId: 'upi_1',
      assignedUpiId: 'nexora@upi',
      assignedUpiDisplayName: 'NEXORA',
      assignedQrImageUrl: '',
      utrNumber: 'UTR12345678',
      status: 'APPROVED',
      createdAt: '2026-11-19T09:00:00.000Z',
    },
    {
      depositId: 'dep_2',
      uid: 'uid_1',
      userId: 'NX100001',
      amountInr: 250,
      coinsRequested: 250,
      assignedUpiAccountId: 'upi_1',
      assignedUpiId: 'nexora@upi',
      assignedUpiDisplayName: 'NEXORA',
      assignedQrImageUrl: '',
      utrNumber: 'UTR99998888',
      status: 'PENDING',
      createdAt: '2026-11-23T01:00:00.000Z',
    },
  ];

  const withdrawals: WithdrawalRequest[] = [
    {
      withdrawalId: 'wd_1',
      uid: 'uid_1',
      userId: 'NX100001',
      amountInr: 200,
      payoutLabel: 'Primary UPI',
      payoutDestinationMasked: 'UPI · u***@okaxis',
      status: 'PENDING',
      createdAt: '2026-11-22T10:00:00.000Z',
      updatedAt: '2026-11-22T10:00:00.000Z',
    },
  ];

  const entries = buildInvestmentHistoryEntries({
    plans,
    transactions,
    deposits,
    withdrawals,
  });

  // Expected unique entries: dep_2 (2026-11-23), wd_1 (2026-11-22), tx_rew_1 (2026-11-21), uplan_1 (2026-11-20), tx_dep_1 (2026-11-19)
  assert.equal(entries.length, 5);
  assert.equal(entries[0].id, 'dep_dep_2');
  assert.equal(entries[0].statusLabel, 'Pending');
  assert.equal(entries[1].id, 'wd_wd_1');
  assert.equal(entries[1].amountDisplay, '-₹200');
  assert.equal(entries[2].id, 'tx_tx_rew_1');
  assert.equal(entries[3].id, 'plan_uplan_1');
  assert.equal(entries[3].statusLabel, 'Active');
  assert.equal(entries[4].id, 'tx_tx_dep_1');
  assert.equal(entries[4].statusLabel, 'Completed');

  const summary = computeInvestmentHistorySummary(entries);
  assert.equal(summary.totalEntries, 5);
  assert.equal(summary.totalPlanInvestedCoins, 500);
  assert.equal(summary.totalDepositedInr, 1000);
  assert.equal(summary.totalRewardsCoins, 65);
  assert.equal(summary.activePlansCount, 1);

  const planOnly = filterInvestmentHistoryEntries(entries, 'PLAN', 'ACTIVE', 'server');
  assert.equal(planOnly.length, 1);
  assert.equal(planOnly[0].referenceId, 'uplan_1');

  const csv = investmentHistoryToCsv(entries);
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 6);
  assert.match(lines[0], /"Entry ID","Date \(UTC ISO\)","Category","Title","Details","Reference ID","Amount","Secondary Amount","Status"/);
  assert.match(lines[1], /"dep_dep_2"/);
  assert.match(lines[1], /"Pending"/);
  // Leading '+' and '-' in Amount are escaped to prevent spreadsheet formula injection
  assert.match(lines[1], /"'\+₹250"/);
  assert.match(lines[2], /"'-₹200"/);
});

test('buildInvestmentHistoryEntries surfaces pending/failed investmentRequests and deduplicates activated requests already in userPlans', () => {
  const entries = buildInvestmentHistoryEntries({
    plans: [
      {
        userPlanId: 'uplan_active_1',
        uid: 'uid_1',
        userId: 'NX100001',
        planId: 'PLAN_LAPTOP_100',
        productName: 'Laptop Plan',
        imageUrl: '',
        coinCost: 100,
        durationDays: 7,
        totalRewardEntitlement: 188,
        collectedReward: 0,
        remainingReward: 188,
        daysCompleted: 0,
        remainingDays: 7,
        startDate: '2026-11-23T02:00:00.000Z',
        endDate: '2026-11-30T02:00:00.000Z',
        nextRewardEligibilityTime: '2026-11-24T02:00:00.000Z',
        status: 'ACTIVE',
        createdAt: '2026-11-23T02:00:00.000Z',
      },
    ],
    investmentRequests: [
      {
        requestId: 'invreq_done',
        uid: 'uid_1',
        userId: 'NX100001',
        planId: 'PLAN_LAPTOP_100',
        productName: 'Laptop Plan',
        planPriceInr: 100,
        coinCost: 100,
        durationDays: 7,
        totalRewardEntitlement: 188,
        acceptedTerms: true,
        idempotencyKey: 'k1',
        status: 'ACTIVATED',
        paymentStatus: 'VERIFIED',
        activatedUserPlanId: 'uplan_active_1',
        createdAt: '2026-11-23T02:00:00.000Z',
        updatedAt: '2026-11-23T02:00:01.000Z',
      },
      {
        requestId: 'invreq_pending',
        uid: 'uid_1',
        userId: 'NX100001',
        planId: 'PLAN_MACHINERY_500',
        productName: 'Machinery Plan',
        planPriceInr: 500,
        coinCost: 500,
        durationDays: 14,
        totalRewardEntitlement: 650,
        acceptedTerms: true,
        idempotencyKey: 'k2',
        status: 'PENDING_VERIFICATION',
        paymentStatus: 'PENDING',
        createdAt: '2026-11-23T03:00:00.000Z',
        updatedAt: '2026-11-23T03:00:00.000Z',
      },
    ],
  });

  assert.equal(entries.length, 2);
  assert.equal(entries[0].id, 'invreq_invreq_pending');
  assert.equal(entries[0].statusLabel, 'Pending Verification');
  assert.equal(entries[0].statusBucket, 'PENDING');
  assert.equal(entries[1].id, 'plan_uplan_active_1');
});
