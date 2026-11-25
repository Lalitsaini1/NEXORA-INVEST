import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPendingInvestmentRequestDoc,
  detectTamperedServerFields,
  evaluateServerComplianceGate,
  resolveAuthoritativePlanSpec,
  validatePlanAmountsMatch,
} from '../../../functions/src/investmentRequestValidation';

describe('server-side investment plan & security validation', () => {
  it('fails closed on real-money compliance gate until legal, payment provider, and admin enablement are all true', () => {
    assert.equal(evaluateServerComplianceGate(null).ok, false);
    assert.equal(
      evaluateServerComplianceGate({
        legalComplianceVerified: true,
        paymentProviderComplianceVerified: false,
        realMoneyInvestmentsEnabled: true,
      }).ok,
      false
    );
    assert.equal(
      evaluateServerComplianceGate({
        legalComplianceVerified: true,
        paymentProviderComplianceVerified: true,
        realMoneyInvestmentsEnabled: false,
      }).ok,
      false
    );
    assert.equal(
      evaluateServerComplianceGate({
        legalComplianceVerified: true,
        paymentProviderComplianceVerified: true,
        realMoneyInvestmentsEnabled: true,
      }).ok,
      true
    );
  });

  it('rejects any client attempt to override server-authoritative returns, payouts, balances, or statuses', () => {
    const tamperedFields = [
      'status',
      'paymentStatus',
      'totalRewardEntitlement',
      'expectedReturnPercent',
      'dailyEarningsInr',
      'availableCoins',
      'withdrawableBalanceInr',
      'activatedUserPlanId',
      'verifiedByUid',
    ];

    for (const field of tamperedFields) {
      const check = detectTamperedServerFields({
        planId: 'PLAN_LAPTOP_100',
        acceptedTerms: true,
        [field]: 999999,
      });
      assert.equal(check.ok, false, `Expected ${field} override to be rejected`);
      if (!check.ok) {
        assert.equal(check.field, field);
      }
    }

    assert.equal(
      detectTamperedServerFields({
        planId: 'PLAN_LAPTOP_100',
        investmentAmountInr: 100,
        acceptedTerms: true,
        idempotencyKey: 'idem_12345',
      }).ok,
      true
    );
  });

  it('computes authoritative proportional payout on the server for variable INR range plans and rejects out-of-range inputs', () => {
    const publishedRangePlan = {
      planId: 'PLAN_GROWTH_RANGE',
      productName: 'Enterprise Growth Plan',
      planPriceInr: 1000,
      coinDeductionAmount: 1000,
      minCoins: 1000,
      maxCoins: 10000,
      durationDays: 20,
      expectedReturnPercent: 25,
      totalCoinReward: 1250,
      isActive: true,
    };

    const validMid = resolveAuthoritativePlanSpec('PLAN_GROWTH_RANGE', publishedRangePlan, 4000);
    assert.equal(validMid.ok, true);
    if (validMid.ok) {
      assert.equal(validMid.plan.planPriceInr, 4000);
      assert.equal(validMid.plan.coinCost, 4000);
      assert.equal(validMid.plan.totalRewardEntitlement, 5000);
      assert.equal(validMid.plan.durationDays, 20);
      assert.equal(validMid.plan.expectedReturnPercent, 25);
    }

    const belowMin = resolveAuthoritativePlanSpec('PLAN_GROWTH_RANGE', publishedRangePlan, 999);
    assert.equal(belowMin.ok, false);
    if (!belowMin.ok) assert.equal(belowMin.code, 'invalid-argument');

    const aboveMax = resolveAuthoritativePlanSpec('PLAN_GROWTH_RANGE', publishedRangePlan, 10001);
    assert.equal(aboveMax.ok, false);
    if (!aboveMax.ok) assert.equal(aboveMax.code, 'invalid-argument');

    const nonInteger = resolveAuthoritativePlanSpec('PLAN_GROWTH_RANGE', publishedRangePlan, 1500.5);
    assert.equal(nonInteger.ok, false);
    if (!nonInteger.ok) assert.equal(nonInteger.code, 'invalid-argument');

    const paused = resolveAuthoritativePlanSpec(
      'PLAN_GROWTH_RANGE',
      { ...publishedRangePlan, isActive: false },
      2000
    );
    assert.equal(paused.ok, false);
    if (!paused.ok) assert.equal(paused.code, 'failed-precondition');
  });

  it('validates expected amount parity and always initializes requests in PENDING_VERIFICATION / PENDING', () => {
    const resolved = resolveAuthoritativePlanSpec('PLAN_LAPTOP_100', null, 100);
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;

    assert.equal(
      validatePlanAmountsMatch({
        plan: resolved.plan,
        expectedPlanPriceInr: 100,
        expectedCoinCost: 100,
      }).ok,
      true
    );

    assert.equal(
      validatePlanAmountsMatch({
        plan: resolved.plan,
        expectedPlanPriceInr: 50,
      }).ok,
      false
    );

    const doc = buildPendingInvestmentRequestDoc({
      requestId: 'invreq_test_001',
      uid: 'uid_member_1',
      userId: 'NX100009',
      plan: resolved.plan,
      idempotencyKey: 'idem_abc_001',
    });

    assert.equal(doc.status, 'PENDING_VERIFICATION');
    assert.equal(doc.paymentStatus, 'PENDING');
    assert.equal(doc.planPriceInr, 100);
    assert.equal(doc.totalRewardEntitlement, 188);
  });
});
