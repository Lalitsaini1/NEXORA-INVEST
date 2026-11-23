import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCoinTxIdForDeposit,
  buildDepositCreditLockId,
  buildDepositIdempotencyKey,
  buildGatewayPaymentLockId,
  buildPaymentTxId,
  buildUtrCreditLockId,
  placeholderWebhookService,
} from '../paymentIdempotency.ts';

test('deterministic payment transaction and credit lock IDs prevent ambiguous keys', () => {
  const depId = 'dep_1700000000_abc123';
  assert.equal(buildPaymentTxId(depId), 'paytx_dep_1700000000_abc123');
  assert.equal(buildDepositIdempotencyKey(depId), 'dep_dep_1700000000_abc123');
  assert.equal(buildDepositCreditLockId(depId), 'lock_dep_dep_1700000000_abc123');
  assert.equal(buildCoinTxIdForDeposit(depId), 'tx_dep_dep_1700000000_abc123');
  assert.equal(buildUtrCreditLockId(' 4123 4567 89ab '), 'lock_utr_4123456789AB');
  assert.equal(
    buildGatewayPaymentLockId('RAZORPAY', 'pay_Nx12345'),
    'lock_gw_razorpay_pay_Nx12345'
  );
});

test('PlaceholderWebhookVerificationService validates payloads, enforces hold/verify modes, and keeps live gateway inactive', async () => {
  const basePayload = {
    gatewayEventId: 'evt_test_001',
    provider: 'PLACEHOLDER_WEBHOOK' as const,
    depositId: 'dep_1001',
    uid: 'user_uid_1',
    userId: 'NX100001',
    amountInr: 1000,
    utrReference: '412345678901',
    gatewayOrderId: 'order_1001',
    gatewayPaymentId: 'pay_1001',
  };

  const holdResult = await placeholderWebhookService.verifyWebhookPayload(basePayload);
  assert.equal(holdResult.ok, true);
  assert.equal(holdResult.isLiveGatewayActive, false);
  assert.equal(holdResult.verificationStatus, 'PLACEHOLDER_HOLD');
  assert.match(holdResult.computedDigestPreview, /^sha256:[a-f0-9]+$/);

  const verifyResult = await placeholderWebhookService.verifyWebhookPayload({
    ...basePayload,
    simulatedOutcome: 'VERIFY',
  });
  assert.equal(verifyResult.ok, true);
  assert.equal(verifyResult.verificationStatus, 'VERIFIED_READY_FOR_CREDIT');
  assert.equal(verifyResult.nextPaymentTxStatus, 'WEBHOOK_VERIFIED');
  assert.equal(verifyResult.computedDigestPreview, holdResult.computedDigestPreview);

  const invalidSig = await placeholderWebhookService.verifyWebhookPayload({
    ...basePayload,
    simulatedOutcome: 'REJECT_SIGNATURE',
  });
  assert.equal(invalidSig.ok, false);
  assert.equal(invalidSig.verificationStatus, 'SIGNATURE_INVALID');
  assert.equal(invalidSig.nextPaymentTxStatus, 'FAILED');

  const badAmount = await placeholderWebhookService.verifyWebhookPayload({
    ...basePayload,
    amountInr: 50,
  });
  assert.equal(badAmount.ok, false);
  assert.equal(badAmount.verificationStatus, 'FAILED');
});
