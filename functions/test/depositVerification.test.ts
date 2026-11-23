import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCanonicalDepositTxIds,
  buildExternalSettlementLockId,
  DepositVerificationError,
  validateDepositApprovalRequirements,
} from '../src/depositVerification';

const baseDeposit = {
  depositId: 'dep_1700001_abc',
  uid: 'uid_member_1',
  userId: 'NX100042',
  amountInr: 1000,
  coinsRequested: 1050,
  packageId: 'cpkg_pro_1000',
  bonusCoins: 50,
  utrNumber: '432198765432',
  screenshotUrl: 'https://example.com/receipt.png',
  status: 'PENDING',
};

test('rejects deposit approval when only screenshot or user UTR exists without bank/gateway verification', () => {
  assert.throws(
    () =>
      validateDepositApprovalRequirements({
        deposit: baseDeposit,
        settlementProof: null,
        existingGatewayVerification: null,
      }),
    (err: unknown) =>
      err instanceof DepositVerificationError &&
      err.code === 'failed-precondition' &&
      /Payment gateway confirmation or authorized bank settlement/i.test(err.message)
  );
});

test('rejects deposit approval when verified bank/gateway amount does not match requested deposit amount', () => {
  assert.throws(
    () =>
      validateDepositApprovalRequirements({
        deposit: baseDeposit,
        settlementProof: {
          verificationChannel: 'BANK_STATEMENT',
          externalTransactionId: 'HDFC9988776655',
          settlementReference: 'HDFC-STMT-2026-11-23',
          reconciledAmountInr: 900,
        },
      }),
    (err: unknown) =>
      err instanceof DepositVerificationError &&
      err.code === 'failed-precondition' &&
      /does not match requested deposit amount/i.test(err.message)
  );
});

test('approves deposit with authorized bank settlement proof, preserving package bonus and canonical paytx/tx_dep IDs', () => {
  const plan = validateDepositApprovalRequirements({
    deposit: baseDeposit,
    settlementProof: {
      verificationChannel: 'BANK_STATEMENT',
      externalTransactionId: 'NPCI_432198765432',
      settlementReference: 'ICICI-CR-20261123-882',
      reconciledAmountInr: 1000,
    },
  });

  const expectedIds = buildCanonicalDepositTxIds(baseDeposit.depositId);
  assert.equal(plan.paymentTxId, expectedIds.paymentTxId);
  assert.equal(plan.coinTxId, expectedIds.coinTxId);
  assert.equal(plan.creditLockId, expectedIds.creditLockId);
  assert.equal(plan.utrLockId, 'lock_utr_432198765432');
  assert.equal(
    plan.externalLockId,
    buildExternalSettlementLockId('BANK_STATEMENT', 'NPCI_432198765432')
  );
  assert.equal(plan.baseCoins, 1000);
  assert.equal(plan.bonusCoins, 50);
  assert.equal(plan.totalCoins, 1050);
  assert.equal(plan.verificationMethod, 'ADMIN_SETTLEMENT');
});

test('approves deposit via signature-verified gateway confirmation without requiring manual bank proof', () => {
  const plan = validateDepositApprovalRequirements({
    deposit: baseDeposit,
    existingGatewayVerification: {
      webhookVerificationStatus: 'SIGNATURE_VERIFIED',
      gatewayPaymentId: 'pay_Rzp987654321',
      gatewayOrderId: 'order_dep_1700001_abc',
      amountInr: 1000,
    },
  });

  assert.equal(plan.verificationChannel, 'GATEWAY_WEBHOOK');
  assert.equal(plan.verificationMethod, 'WEBHOOK_VERIFIED');
  assert.equal(plan.webhookVerificationStatus, 'SIGNATURE_VERIFIED');
  assert.equal(plan.externalTransactionId, 'pay_Rzp987654321');
});

test('rejects missing member UID or already-finalized deposits before any Firestore doc() call', () => {
  assert.throws(
    () =>
      validateDepositApprovalRequirements({
        deposit: { ...baseDeposit, uid: '' },
        settlementProof: {
          verificationChannel: 'GATEWAY_SETTLEMENT',
          externalTransactionId: 'pay_123456',
          settlementReference: 'SETTLE-001',
          reconciledAmountInr: 1000,
        },
      }),
    (err: unknown) => err instanceof DepositVerificationError && err.code === 'failed-precondition'
  );

  assert.throws(
    () =>
      validateDepositApprovalRequirements({
        deposit: { ...baseDeposit, status: 'APPROVED' },
        settlementProof: {
          verificationChannel: 'GATEWAY_SETTLEMENT',
          externalTransactionId: 'pay_123456',
          settlementReference: 'SETTLE-001',
          reconciledAmountInr: 1000,
        },
      }),
    (err: unknown) => err instanceof DepositVerificationError && /already finalized/i.test(err.message)
  );
});
