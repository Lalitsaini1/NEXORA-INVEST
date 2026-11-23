import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDeterministicLockId,
  buildPendingInvestmentRequestDoc,
  detectTamperedServerFields,
  resolveAuthoritativePlanSpec,
  sanitizeIdentifier,
  validatePlanAmountsMatch,
} from '../src/investmentRequestValidation';

test('resolveAuthoritativePlanSpec resolves active Firestore plans, rejects corrupt financial terms, and falls back to catalog', () => {
  const builtIn = resolveAuthoritativePlanSpec('PLAN_LAPTOP_100', null);
  assert.equal(builtIn.ok, true);
  if (builtIn.ok) {
    assert.equal(builtIn.plan.planPriceInr, 100);
    assert.equal(builtIn.plan.coinCost, 100);
    assert.equal(builtIn.plan.durationDays, 7);
    assert.equal(builtIn.plan.totalRewardEntitlement, 188);
  }

  const corruptZeroCost = resolveAuthoritativePlanSpec('PLAN_CORRUPT', {
    planId: 'PLAN_CORRUPT',
    productName: 'Broken Plan',
    planPriceInr: 500,
    coinDeductionAmount: 0,
    durationDays: 10,
    totalCoinReward: 700,
    isActive: true,
  });
  assert.equal(corruptZeroCost.ok, false);
  if (!corruptZeroCost.ok) {
    assert.equal(corruptZeroCost.code, 'failed-precondition');
  }

  const paused = resolveAuthoritativePlanSpec('PLAN_CUSTOM_1', {
    planId: 'PLAN_CUSTOM_1',
    productName: 'Custom Plan',
    planPriceInr: 2500,
    coinDeductionAmount: 2500,
    durationDays: 10,
    totalCoinReward: 3000,
    isActive: false,
  });
  assert.equal(paused.ok, false);
  if (!paused.ok) {
    assert.equal(paused.code, 'failed-precondition');
  }

  const missing = resolveAuthoritativePlanSpec('NON_EXISTENT_PLAN', null);
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.code, 'not-found');
  }
});

test('detectTamperedServerFields blocks any client attempt to inject server-controlled financial or status fields', () => {
  assert.deepEqual(
    detectTamperedServerFields({
      planId: 'PLAN_LAPTOP_100',
      acceptedTerms: true,
      idempotencyKey: 'idem_safe_001',
      expectedPlanPriceInr: 100,
      expectedCoinCost: 100,
    }),
    { ok: true }
  );

  for (const tamperedPayload of [
    { planId: 'PLAN_LAPTOP_100', status: 'ACTIVATED' },
    { planId: 'PLAN_LAPTOP_100', paymentStatus: 'VERIFIED' },
    { planId: 'PLAN_LAPTOP_100', coinCost: 1 },
    { planId: 'PLAN_LAPTOP_100', planPriceInr: 1 },
    { planId: 'PLAN_LAPTOP_100', totalRewardEntitlement: 999999 },
    { planId: 'PLAN_LAPTOP_100', availableCoins: 50000 },
    { planId: 'PLAN_LAPTOP_100', uid: 'other_user_uid' },
    { planId: 'PLAN_LAPTOP_100', activatedUserPlanId: 'uplan_fake' },
  ]) {
    const check = detectTamperedServerFields(tamperedPayload);
    assert.equal(check.ok, false);
  }
});

test('validatePlanAmountsMatch rejects tampered expected prices or coin costs', () => {
  const res = resolveAuthoritativePlanSpec('PLAN_MACHINERY_500', null);
  assert.equal(res.ok, true);
  if (!res.ok) return;

  assert.deepEqual(
    validatePlanAmountsMatch({
      plan: res.plan,
      expectedPlanPriceInr: 500,
      expectedCoinCost: 500,
    }),
    { ok: true }
  );

  const tamperedPrice = validatePlanAmountsMatch({
    plan: res.plan,
    expectedPlanPriceInr: 1,
    expectedCoinCost: 500,
  });
  assert.equal(tamperedPrice.ok, false);

  const tamperedCoins = validatePlanAmountsMatch({
    plan: res.plan,
    expectedPlanPriceInr: 500,
    expectedCoinCost: 1,
  });
  assert.equal(tamperedCoins.ok, false);
});

test('buildPendingInvestmentRequestDoc strictly locks status and buildDeterministicLockId avoids long-key collisions', () => {
  const res = resolveAuthoritativePlanSpec('PLAN_SERVER_1000', null);
  assert.equal(res.ok, true);
  if (!res.ok) return;

  const doc = buildPendingInvestmentRequestDoc({
    requestId: 'invreq_test_1',
    uid: 'SVpakaILY7UVHnQIyMFcXDTfkL93',
    userId: 'NX100042',
    plan: res.plan,
    idempotencyKey: 'idem_1234',
  });

  assert.equal(doc.uid, 'SVpakaILY7UVHnQIyMFcXDTfkL93');
  assert.equal(doc.status, 'PENDING_VERIFICATION');
  assert.equal(doc.paymentStatus, 'PENDING');
  assert.equal(doc.acceptedTerms, true);
  assert.equal(doc.coinCost, 1000);
  assert.equal(doc.planPriceInr, 1000);
  assert.equal(sanitizeIdentifier('valid_Key-123'), 'valid_Key-123');
  assert.equal(sanitizeIdentifier('bad/path'), '');

  const prefix = 'k_'.padEnd(110, 'a');
  const lockA = buildDeterministicLockId('inv', 'SVpakaILY7UVHnQIyMFcXDTfkL93', `${prefix}1`);
  const lockB = buildDeterministicLockId('inv', 'SVpakaILY7UVHnQIyMFcXDTfkL93', `${prefix}2`);
  assert.notEqual(lockA, lockB);
  assert.match(lockA, /^inv_[a-f0-9]{48}$/);
});
