import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatAdminActionError,
  inspectCloudFunctionError,
  isCloudFunctionUnreachableError,
} from '../cloudFunctionErrorFormatter.ts';
import {
  DepositSettlementProofInput,
  DepositVerificationError,
  validateDepositApprovalRequirements,
} from '../depositVerification.ts';

interface SandboxDepositDoc {
  depositId: string;
  uid: string;
  userId: string;
  amountInr: number;
  coinsRequested: number;
  packageId?: string;
  bonusCoins?: number;
  utrNumber?: string;
  screenshotUrl?: string;
  status: 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
  rejectionReason?: string;
  verificationChannel?: string;
  externalTransactionId?: string;
  settlementReference?: string;
  reconciledAmountInr?: number;
  verifiedAt?: string;
  verifiedByAdminUid?: string;
  createdAt: string;
}

interface SandboxWalletDoc {
  uid: string;
  userId: string;
  availableCoins: number;
  purchasedCoins: number;
  earnedCoins: number;
  updatedAt: string;
}

interface SandboxPaymentTxDoc {
  paymentTxId: string;
  depositId: string;
  uid: string;
  userId: string;
  amountInr: number;
  coinsToCredit: number;
  packageId?: string;
  bonusCoins?: number;
  gatewayPaymentId?: string;
  gatewayOrderId?: string;
  creditLockId: string;
  utrLockId?: string;
  verificationMethod: string;
  webhookVerificationStatus: string;
  status: string;
  coinTransactionId?: string;
  failureReason?: string;
}

class SandboxDepositLedger {
  deposits = new Map<string, SandboxDepositDoc>();
  wallets = new Map<string, SandboxWalletDoc>();
  coinTransactions = new Map<string, Record<string, unknown>>();
  paymentTransactions = new Map<string, SandboxPaymentTxDoc>();
  paymentCreditLocks = new Map<string, Record<string, unknown>>();
  adminActivityLogs: Record<string, unknown>[] = [];

  seedUserWallet(uid: string, userId: string, initialCoins: number) {
    this.wallets.set(uid, {
      uid,
      userId,
      availableCoins: initialCoins,
      purchasedCoins: initialCoins,
      earnedCoins: 0,
      updatedAt: new Date().toISOString(),
    });
  }

  submitDeposit(input: {
    depositId: string;
    uid: string;
    userId: string;
    amountInr: number;
    packageId?: string;
    bonusCoins?: number;
    utrNumber?: string;
    screenshotUrl?: string;
  }) {
    const bonus = input.packageId ? input.bonusCoins || 0 : 0;
    const totalCoins = input.amountInr + bonus;
    const now = new Date().toISOString();

    this.deposits.set(input.depositId, {
      depositId: input.depositId,
      uid: input.uid,
      userId: input.userId,
      amountInr: input.amountInr,
      coinsRequested: totalCoins,
      packageId: input.packageId,
      bonusCoins: bonus,
      utrNumber: input.utrNumber,
      screenshotUrl: input.screenshotUrl,
      status: 'PENDING',
      createdAt: now,
    });

    this.paymentTransactions.set(`paytx_${input.depositId}`, {
      paymentTxId: `paytx_${input.depositId}`,
      depositId: input.depositId,
      uid: input.uid,
      userId: input.userId,
      amountInr: input.amountInr,
      coinsToCredit: totalCoins,
      packageId: input.packageId,
      bonusCoins: bonus,
      creditLockId: `lock_dep_${input.depositId}`,
      utrLockId: input.utrNumber ? `lock_utr_${input.utrNumber}` : undefined,
      verificationMethod: 'ADMIN_SETTLEMENT',
      webhookVerificationStatus: 'NOT_RECEIVED',
      status: 'PENDING_VERIFICATION',
    });
  }

  listPendingQueue(): SandboxDepositDoc[] {
    return Array.from(this.deposits.values()).filter(
      (d) => d.status === 'PENDING' || d.status === 'UNDER_REVIEW'
    );
  }

  reviewDeposit(params: {
    callerRole: 'USER' | 'ADMIN' | 'SUPER_ADMIN';
    actorUid: string;
    depositId: string;
    decision: 'APPROVED' | 'REJECTED';
    rejectionReason?: string;
    settlementProof?: Partial<DepositSettlementProofInput> | null;
  }) {
    if (params.callerRole !== 'ADMIN' && params.callerRole !== 'SUPER_ADMIN') {
      throw new Error('Permission denied: only verified administrator accounts can perform this action.');
    }

    const dep = this.deposits.get(params.depositId);
    if (!dep) {
      throw new Error('Deposit request not found.');
    }
    if (dep.status === 'APPROVED' || dep.status === 'REJECTED') {
      throw new Error(`Deposit already finalized (${dep.status}).`);
    }

    const now = new Date().toISOString();

    if (params.decision === 'REJECTED') {
      const reason = (params.rejectionReason || '').trim();
      if (reason.length < 3) {
        throw new Error('Rejection reason must be at least 3 characters long.');
      }
      dep.status = 'REJECTED';
      dep.rejectionReason = reason;
      dep.verifiedByAdminUid = params.actorUid;
      dep.verifiedAt = now;
      const payTx = this.paymentTransactions.get(`paytx_${dep.depositId}`);
      if (payTx && payTx.status !== 'CREDITED') {
        payTx.status = 'REJECTED';
        payTx.failureReason = reason;
      }
      this.adminActivityLogs.push({
        actionType: 'DEPOSIT_REVIEWED',
        actorUid: params.actorUid,
        targetId: dep.depositId,
        summary: `REJECTED deposit ${dep.depositId}`,
      });
      return;
    }

    const payTx = this.paymentTransactions.get(`paytx_${dep.depositId}`);
    const plan = validateDepositApprovalRequirements({
      deposit: dep,
      settlementProof: params.settlementProof,
      existingGatewayVerification: payTx
        ? {
            webhookVerificationStatus: payTx.webhookVerificationStatus,
            gatewayPaymentId: payTx.gatewayPaymentId,
            gatewayOrderId: payTx.gatewayOrderId,
            amountInr: payTx.amountInr,
            status: payTx.status,
          }
        : null,
    });

    if (
      this.paymentCreditLocks.has(plan.creditLockId) ||
      (plan.utrLockId && this.paymentCreditLocks.has(plan.utrLockId)) ||
      this.paymentCreditLocks.has(plan.externalLockId) ||
      this.coinTransactions.has(plan.coinTxId) ||
      payTx?.status === 'CREDITED'
    ) {
      throw new DepositVerificationError(
        'already-exists',
        'Duplicate coin credit blocked: an immutable credit lock already exists for this deposit, UTR, or bank/gateway transaction reference.'
      );
    }

    const wallet = this.wallets.get(plan.targetUid);
    if (!wallet) {
      throw new Error('Member coin wallet does not exist yet.');
    }

    const prev = wallet.availableCoins;
    const next = prev + plan.totalCoins;
    wallet.availableCoins = next;
    wallet.purchasedCoins += plan.baseCoins;
    wallet.earnedCoins += plan.bonusCoins;
    wallet.updatedAt = now;

    dep.status = 'APPROVED';
    dep.rejectionReason = '';
    dep.verificationChannel = plan.verificationChannel;
    dep.externalTransactionId = plan.externalTransactionId;
    dep.settlementReference = plan.settlementReference;
    dep.reconciledAmountInr = plan.reconciledAmountInr;
    dep.verifiedByAdminUid = params.actorUid;
    dep.verifiedAt = now;

    this.coinTransactions.set(plan.coinTxId, {
      transactionId: plan.coinTxId,
      uid: plan.targetUid,
      userId: plan.targetUserId,
      type: 'COIN_PURCHASE',
      amount: plan.totalCoins,
      previousBalance: prev,
      newBalance: next,
      referenceId: plan.externalTransactionId,
      idempotencyKey: plan.idempotencyKey,
      status: 'COMPLETED',
      createdAt: now,
    });

    this.paymentCreditLocks.set(plan.creditLockId, {
      lockId: plan.creditLockId,
      lockScope: 'DEPOSIT_ORDER',
      depositId: plan.depositId,
      coinTransactionId: plan.coinTxId,
    });
    this.paymentCreditLocks.set(plan.externalLockId, {
      lockId: plan.externalLockId,
      lockScope: 'GATEWAY_PAYMENT',
      depositId: plan.depositId,
      coinTransactionId: plan.coinTxId,
    });
    if (plan.utrLockId) {
      this.paymentCreditLocks.set(plan.utrLockId, {
        lockId: plan.utrLockId,
        lockScope: 'UTR_REFERENCE',
        depositId: plan.depositId,
        coinTransactionId: plan.coinTxId,
      });
    }

    if (payTx) {
      payTx.gatewayPaymentId = plan.externalTransactionId;
      payTx.gatewayOrderId = plan.settlementReference;
      payTx.verificationMethod = plan.verificationMethod;
      payTx.webhookVerificationStatus = plan.webhookVerificationStatus;
      payTx.status = 'CREDITED';
      payTx.coinTransactionId = plan.coinTxId;
    }

    this.adminActivityLogs.push({
      actionType: 'DEPOSIT_REVIEWED',
      actorUid: params.actorUid,
      targetId: plan.depositId,
      summary: `APPROVED deposit ${plan.depositId} (${plan.totalCoins} Coins)`,
    });
  }
}

test('cloudFunctionErrorFormatter detects CORS status-0 internal [0] errors cleanly without leaking debug text to UI', () => {
  const statusZeroErr = Object.assign(new Error('internal [0]'), {
    code: 'functions/internal',
  });
  const statusZeroAlt = Object.assign(new Error('internal 0'), {
    code: 'functions/internal',
  });
  const real500Err = Object.assign(new Error('Transaction aborted due to lock contention'), {
    code: 'functions/internal',
  });
  const firestoreJsonErr = new Error(
    JSON.stringify({
      error: 'Missing or insufficient permissions.',
      operationType: 'write',
      path: 'depositRequests/dep_123',
      authInfo: { userId: 'uid_admin' },
    })
  );

  assert.equal(isCloudFunctionUnreachableError(statusZeroErr), true);
  assert.equal(isCloudFunctionUnreachableError(statusZeroAlt), true);
  assert.equal(inspectCloudFunctionError(statusZeroErr).isInternalTransportZero, true);
  assert.equal(isCloudFunctionUnreachableError(real500Err), false);

  const uiMsgZero = formatAdminActionError(statusZeroErr, 'Fallback');
  assert.equal(/internal\s*\[?0\]?/i.test(uiMsgZero), false);

  const uiMsg500 = formatAdminActionError(real500Err, 'Fallback');
  assert.equal(/server processing error/i.test(uiMsg500), true);

  const uiMsgPerm = formatAdminActionError(firestoreJsonErr, 'Fallback');
  assert.equal(uiMsgPerm.includes('"operationType"'), false);
  assert.match(uiMsgPerm, /Permission denied/i);
});

test('complete 9-step sandbox deposit approval workflow: verification, atomic credit, ledger, and duplicate blocking', () => {
  const sandbox = new SandboxDepositLedger();
  sandbox.seedUserWallet('uid_member_1', 'NX100042', 200);

  // Step 1 & 2: User submits deposit request -> appears in Admin Pending Queue
  sandbox.submitDeposit({
    depositId: 'dep_sbx_1',
    uid: 'uid_member_1',
    userId: 'NX100042',
    amountInr: 1000,
    packageId: 'cpkg_pro_1000',
    bonusCoins: 50,
    utrNumber: '432198765432',
    screenshotUrl: 'https://example.com/upi-shot.png',
  });
  assert.equal(sandbox.listPendingQueue().length, 1);

  // Step 3: Non-admin user cannot approve
  assert.throws(
    () =>
      sandbox.reviewDeposit({
        callerRole: 'USER',
        actorUid: 'uid_member_1',
        depositId: 'dep_sbx_1',
        decision: 'APPROVED',
        settlementProof: {
          verificationChannel: 'BANK_STATEMENT',
          externalTransactionId: 'ICICI_CR_99887766',
          settlementReference: 'ICICI-STMT-20261123-1',
          reconciledAmountInr: 1000,
        },
      }),
    /Permission denied/i
  );

  // Step 4: Admin cannot approve based solely on screenshot or user-entered UTR
  assert.throws(
    () =>
      sandbox.reviewDeposit({
        callerRole: 'ADMIN',
        actorUid: 'wZQCw7fXrWQCn5HqdSjS6RQHVyi1',
        depositId: 'dep_sbx_1',
        decision: 'APPROVED',
        settlementProof: null,
      }),
    /Payment gateway confirmation or authorized bank settlement/i
  );
  assert.equal(sandbox.wallets.get('uid_member_1')?.availableCoins, 200);

  // Step 5: Admin cannot approve if verified amount differs from requested INR
  assert.throws(
    () =>
      sandbox.reviewDeposit({
        callerRole: 'ADMIN',
        actorUid: 'wZQCw7fXrWQCn5HqdSjS6RQHVyi1',
        depositId: 'dep_sbx_1',
        decision: 'APPROVED',
        settlementProof: {
          verificationChannel: 'BANK_STATEMENT',
          externalTransactionId: 'ICICI_CR_99887766',
          settlementReference: 'ICICI-STMT-20261123-1',
          reconciledAmountInr: 950,
        },
      }),
    /does not match requested deposit amount/i
  );
  assert.equal(sandbox.wallets.get('uid_member_1')?.availableCoins, 200);

  // Step 6, 7 & 8: Admin approves with verified bank statement & matching amount -> credited once + ledger updated
  sandbox.reviewDeposit({
    callerRole: 'SUPER_ADMIN',
    actorUid: 'wZQCw7fXrWQCn5HqdSjS6RQHVyi1',
    depositId: 'dep_sbx_1',
    decision: 'APPROVED',
    settlementProof: {
      verificationChannel: 'BANK_STATEMENT',
      externalTransactionId: 'ICICI_CR_99887766',
      settlementReference: 'ICICI-STMT-20261123-1',
      reconciledAmountInr: 1000,
    },
  });

  const approvedDep = sandbox.deposits.get('dep_sbx_1')!;
  assert.equal(approvedDep.status, 'APPROVED');
  assert.equal(approvedDep.verifiedByAdminUid, 'wZQCw7fXrWQCn5HqdSjS6RQHVyi1');
  assert.equal(approvedDep.externalTransactionId, 'ICICI_CR_99887766');

  const wallet = sandbox.wallets.get('uid_member_1')!;
  assert.equal(wallet.availableCoins, 1250);
  assert.equal(wallet.purchasedCoins, 1200);
  assert.equal(wallet.earnedCoins, 50);

  const ledgerTx = sandbox.coinTransactions.get('tx_dep_dep_sbx_1')!;
  assert.equal(ledgerTx.amount, 1050);
  assert.equal(ledgerTx.previousBalance, 200);
  assert.equal(ledgerTx.newBalance, 1250);
  assert.equal(sandbox.paymentTransactions.get('paytx_dep_sbx_1')?.status, 'CREDITED');
  assert.equal(sandbox.listPendingQueue().length, 0);

  // Step 9a: Re-approving same deposit is blocked
  assert.throws(
    () =>
      sandbox.reviewDeposit({
        callerRole: 'ADMIN',
        actorUid: 'wZQCw7fXrWQCn5HqdSjS6RQHVyi1',
        depositId: 'dep_sbx_1',
        decision: 'APPROVED',
        settlementProof: {
          verificationChannel: 'BANK_STATEMENT',
          externalTransactionId: 'ICICI_NEW_REF_999',
          settlementReference: 'ICICI-STMT-20261123-2',
          reconciledAmountInr: 1000,
        },
      }),
    /already finalized/i
  );

  // Step 9b: Submitting & approving another deposit with same UTR is blocked by UTR credit lock
  sandbox.submitDeposit({
    depositId: 'dep_sbx_2',
    uid: 'uid_member_1',
    userId: 'NX100042',
    amountInr: 500,
    utrNumber: '432198765432',
  });
  assert.throws(
    () =>
      sandbox.reviewDeposit({
        callerRole: 'ADMIN',
        actorUid: 'wZQCw7fXrWQCn5HqdSjS6RQHVyi1',
        depositId: 'dep_sbx_2',
        decision: 'APPROVED',
        settlementProof: {
          verificationChannel: 'BANK_STATEMENT',
          externalTransactionId: 'ICICI_OTHER_REF_11',
          settlementReference: 'ICICI-STMT-20261123-3',
          reconciledAmountInr: 500,
        },
      }),
    /Duplicate coin credit blocked/i
  );

  // Step 9c: Approving a distinct deposit with an already-used external bank transaction ID is blocked
  sandbox.submitDeposit({
    depositId: 'dep_sbx_3',
    uid: 'uid_member_1',
    userId: 'NX100042',
    amountInr: 500,
    utrNumber: '998877665544',
  });
  assert.throws(
    () =>
      sandbox.reviewDeposit({
        callerRole: 'ADMIN',
        actorUid: 'wZQCw7fXrWQCn5HqdSjS6RQHVyi1',
        depositId: 'dep_sbx_3',
        decision: 'APPROVED',
        settlementProof: {
          verificationChannel: 'BANK_STATEMENT',
          externalTransactionId: 'ICICI_CR_99887766',
          settlementReference: 'ICICI-STMT-20261123-4',
          reconciledAmountInr: 500,
        },
      }),
    /Duplicate coin credit blocked/i
  );

  // Rejecting invalid deposit keeps wallet untouched
  sandbox.reviewDeposit({
    callerRole: 'ADMIN',
    actorUid: 'wZQCw7fXrWQCn5HqdSjS6RQHVyi1',
    depositId: 'dep_sbx_3',
    decision: 'REJECTED',
    rejectionReason: 'Transaction ID already settled on prior deposit',
  });
  assert.equal(sandbox.deposits.get('dep_sbx_3')?.status, 'REJECTED');
  assert.equal(sandbox.wallets.get('uid_member_1')?.availableCoins, 1250);
});
