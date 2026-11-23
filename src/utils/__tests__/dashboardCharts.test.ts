import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInvestmentGrowthVisualSeries,
  buildTransactionActivityVisualSeries,
} from '../dashboardCharts';

describe('dashboardCharts analytics aggregations', () => {
  const refDate = new Date('2026-11-23T10:00:00.000Z');

  it('tracks combined liquid wallet balance, active plan capital, and cumulative rewards across the window', () => {
    const result = buildInvestmentGrowthVisualSeries({
      currentAvailableCoins: 454,
      plans: [
        {
          userPlanId: 'up_laptop',
          coinCost: 100,
          totalRewardEntitlement: 188,
          collectedReward: 54,
          remainingReward: 134,
          startDate: '2026-11-21T08:00:00.000Z',
          endDate: '2026-11-28T08:00:00.000Z',
          status: 'ACTIVE',
          createdAt: '2026-11-21T08:00:00.000Z',
        },
      ],
      transactions: [
        {
          type: 'COIN_PURCHASE',
          status: 'COMPLETED',
          amount: 500,
          previousBalance: 0,
          newBalance: 500,
          createdAt: '2026-11-20T09:00:00.000Z',
        },
        {
          type: 'PLAN_INVESTMENT',
          status: 'COMPLETED',
          amount: -100,
          previousBalance: 500,
          newBalance: 400,
          createdAt: '2026-11-21T08:00:00.000Z',
        },
        {
          type: 'DAILY_REWARD',
          status: 'COMPLETED',
          amount: 27,
          previousBalance: 400,
          newBalance: 427,
          createdAt: '2026-11-22T08:00:00.000Z',
        },
        {
          type: 'DAILY_REWARD',
          status: 'COMPLETED',
          amount: 27,
          previousBalance: 427,
          newBalance: 454,
          createdAt: '2026-11-23T08:00:00.000Z',
        },
      ],
      windowDays: 7,
      referenceDate: refDate,
    });

    assert.equal(result.points.length, 7);
    assert.equal(result.currentAvailableCoins, 454);
    assert.equal(result.activePlanCapital, 100);
    assert.equal(result.currentPortfolioCoins, 554);
    assert.equal(result.totalExpectedEntitlement, 188);
    assert.equal(result.remainingProjectedRewards, 134);
    assert.equal(result.totalRewardsInWindow, 54);
    assert.equal(result.netPortfolioGrowthCoins, 554);
    assert.equal(result.hasData, true);

    const nov21 = result.points.find((p) => p.dateKey === '2026-11-21');
    const nov23 = result.points.find((p) => p.dateKey === '2026-11-23');
    assert.equal(nov21?.liquidCoins, 400);
    assert.equal(nov21?.activePlanCapital, 100);
    assert.equal(nov21?.totalPortfolioCoins, 500);
    assert.equal(nov23?.cumulativeRewards, 54);
    assert.equal(nov23?.totalPortfolioCoins, 554);
  });

  it('aggregates daily inflows, plan allocations, withdrawals, and category distributions cleanly', () => {
    const summary = buildTransactionActivityVisualSeries({
      transactions: [
        {
          transactionId: 'tx_1',
          type: 'COIN_PURCHASE',
          status: 'COMPLETED',
          amount: 1000,
          previousBalance: 0,
          newBalance: 1000,
          referenceId: 'dep_1',
          idempotencyKey: 'dep_1',
          createdAt: '2026-11-21T09:00:00.000Z',
        },
        {
          transactionId: 'tx_2',
          type: 'PLAN_INVESTMENT',
          status: 'COMPLETED',
          amount: -500,
          previousBalance: 1000,
          newBalance: 500,
          referenceId: 'uplan_1',
          idempotencyKey: 'uplan_1',
          createdAt: '2026-11-22T10:00:00.000Z',
        },
        {
          transactionId: 'tx_3',
          type: 'DAILY_REWARD',
          status: 'COMPLETED',
          amount: 46,
          previousBalance: 500,
          newBalance: 546,
          referenceId: 'rwd_1',
          idempotencyKey: 'rwd_1',
          createdAt: '2026-11-23T08:00:00.000Z',
        },
        {
          transactionId: 'tx_4',
          type: 'WITHDRAWAL_REQUEST',
          status: 'PENDING',
          amount: -200,
          previousBalance: 300,
          newBalance: 100,
          referenceId: 'wd_1',
          idempotencyKey: 'wd_1',
          createdAt: '2026-11-23T09:00:00.000Z',
        },
        {
          transactionId: 'tx_rejected',
          type: 'COIN_PURCHASE',
          status: 'REJECTED',
          amount: 9999,
          previousBalance: 0,
          newBalance: 0,
          referenceId: 'dep_bad',
          idempotencyKey: 'dep_bad',
          createdAt: '2026-11-23T09:00:00.000Z',
        },
      ],
      deposits: [{ depositId: 'dep_pending', status: 'PENDING' }],
      withdrawals: [{ withdrawalId: 'wd_1', status: 'PENDING' }],
      windowDays: 7,
      referenceDate: refDate,
    });

    assert.equal(summary.dailyCashflow.length, 7);
    assert.equal(summary.totalInflowsWindow, 1046);
    assert.equal(summary.totalPlanAllocatedWindow, 500);
    assert.equal(summary.totalWithdrawalsWindow, 200);
    assert.equal(summary.totalVolumeWindow, 1746);
    assert.equal(summary.totalTransactionsWindow, 4);
    assert.equal(summary.pendingRequestsCount, 2);
    assert.equal(summary.categoryBreakdown[0].categoryKey, 'DEPOSITS');
    assert.equal(summary.categoryBreakdown[0].volumeCoins, 1000);
  });

  it('handles empty accounts gracefully without NaN or negative values', () => {
    const emptyGrowth = buildInvestmentGrowthVisualSeries({
      currentAvailableCoins: 0,
      plans: [],
      transactions: [],
      windowDays: 14,
      referenceDate: refDate,
    });
    assert.equal(emptyGrowth.points.length, 14);
    assert.equal(emptyGrowth.hasData, false);
    assert.equal(emptyGrowth.netPortfolioGrowthPct, null);

    const emptyTx = buildTransactionActivityVisualSeries({
      transactions: [],
      windowDays: 14,
      referenceDate: refDate,
    });
    assert.equal(emptyTx.hasTransactions, false);
    assert.equal(emptyTx.categoryBreakdown.length, 0);
  });
});
