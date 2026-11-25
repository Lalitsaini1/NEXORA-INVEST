import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  Unsubscribe,
  where,
} from 'firebase/firestore';
import { COIN_CONVERSION_RATE } from '../config/constants';
import { OperationType, db, handleFirestoreError } from '../firebase/client';
import {
  CoinPackageBonusType,
  CoinPackageRecord,
  DepositRequest,
  DepositStatus,
  PaymentGatewayProvider,
  PaymentTransactionRecord,
  PaymentTxStatus,
  PaymentVerificationMethod,
  UpiAccount,
  WebhookVerificationStatus,
} from '../types/domain';
import {
  calculateCoinsForDepositInr,
  DEFAULT_COIN_PACKAGES_CSV,
  MAX_UPI_DEPOSIT_INR,
  MIN_UPI_DEPOSIT_INR,
  normalizeUtrReference,
  validateDepositAmountInr,
  validateUtrReference,
} from '../utils/upiGateway';
import {
  buildDepositCreditLockId,
  buildDepositIdempotencyKey,
  buildPaymentTxId,
  buildUtrCreditLockId,
} from '../utils/paymentIdempotency';
import {
  evaluateInvestmentComplianceGate,
  InvestmentComplianceStatus,
} from '../utils/planInvestment';

export interface GatewayRuntimeConfig {
  upiDepositsEnabled: boolean;
  minDepositInr: number;
  maxDepositInr: number;
  coinPackagesCsv: string;
  coinsPerInr: number;
  syncedAt: string;
  settingsDocExists: boolean;
}

export const DEFAULT_GATEWAY_RUNTIME_CONFIG: GatewayRuntimeConfig = {
  upiDepositsEnabled: true,
  minDepositInr: MIN_UPI_DEPOSIT_INR,
  maxDepositInr: MAX_UPI_DEPOSIT_INR,
  coinPackagesCsv: DEFAULT_COIN_PACKAGES_CSV,
  coinsPerInr: COIN_CONVERSION_RATE.coinsPerInr,
  syncedAt: '',
  settingsDocExists: false,
};

function toIso(raw: unknown): string {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'toDate' in raw &&
    typeof (raw as { toDate: unknown }).toDate === 'function'
  ) {
    return (raw as { toDate: () => Date }).toDate().toISOString();
  }
  return typeof raw === 'string' ? raw : '';
}

function createId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${Date.now()}_${rand}`;
}

export function subscribeGatewayRuntimeConfig(
  onData: (config: GatewayRuntimeConfig) => void,
  onError?: (msg: string) => void
): Unsubscribe {
  const ref = doc(db, 'platformSettings', 'global');
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData({ ...DEFAULT_GATEWAY_RUNTIME_CONFIG, settingsDocExists: false, syncedAt: '' });
        return;
      }
      const data = snap.data();
      const minInr =
        typeof data.minDepositInr === 'number' && data.minDepositInr >= 100
          ? data.minDepositInr
          : MIN_UPI_DEPOSIT_INR;
      const maxInr =
        typeof data.maxDepositInr === 'number' && data.maxDepositInr >= minInr
          ? data.maxDepositInr
          : MAX_UPI_DEPOSIT_INR;
      onData({
        upiDepositsEnabled: data.upiDepositsEnabled !== false,
        minDepositInr: minInr,
        maxDepositInr: maxInr,
        coinPackagesCsv:
          typeof data.coinPackagesCsv === 'string' && data.coinPackagesCsv.trim()
            ? data.coinPackagesCsv
            : DEFAULT_COIN_PACKAGES_CSV,
        coinsPerInr: COIN_CONVERSION_RATE.coinsPerInr,
        syncedAt: toIso(data.updatedAt) || new Date().toISOString(),
        settingsDocExists: true,
      });
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, 'platformSettings/global');
      } catch {
        onError?.('Unable to load platform UPI gateway settings from Firestore.');
      }
      onData({ ...DEFAULT_GATEWAY_RUNTIME_CONFIG, settingsDocExists: false, syncedAt: '' });
    }
  );
}

export function subscribeInvestmentComplianceStatus(
  onData: (status: InvestmentComplianceStatus) => void,
  onError?: (msg: string) => void
): Unsubscribe {
  const ref = doc(db, 'platformSettings', 'global');
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(evaluateInvestmentComplianceGate(null));
        return;
      }
      const data = snap.data();
      onData(
        evaluateInvestmentComplianceGate({
          legalComplianceVerified: Boolean(data.legalComplianceVerified),
          paymentProviderComplianceVerified: Boolean(data.paymentProviderComplianceVerified),
          realMoneyInvestmentsEnabled: Boolean(data.realMoneyInvestmentsEnabled),
          complianceStatusNote: data.complianceStatusNote
            ? String(data.complianceStatusNote)
            : undefined,
        })
      );
    },
    (err) => {
      onError?.('Unable to verify real-money investment compliance status.');
      try {
        handleFirestoreError(err, OperationType.GET, 'platformSettings/global');
      } catch {
        // Fails closed whenever settings cannot be read
      }
      onData(evaluateInvestmentComplianceGate(null));
    }
  );
}

export function subscribeActiveUpiAccounts(
  onData: (accounts: UpiAccount[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const q = query(
    collection(db, 'upiAccounts'),
    where('isActive', '==', true),
    limit(25)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: UpiAccount[] = snap.docs
        .map((docSnap) => {
          const data = docSnap.data();
          return {
            accountId: String(data.accountId || docSnap.id),
            upiId: String(data.upiId || ''),
            displayName: String(data.displayName || ''),
            qrCodeImageUrl: String(data.qrCodeImageUrl || ''),
            isActive: Boolean(data.isActive),
            updatedAt: toIso(data.updatedAt),
          };
        })
        .filter((acc) => acc.isActive && acc.upiId.trim().length >= 3)
        .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
      onData(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'upiAccounts');
      } catch {
        onError('Unable to load authorized UPI payment endpoints.');
      }
    }
  );
}

export function subscribeActiveCoinPackages(
  onData: (packages: CoinPackageRecord[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const q = query(
    collection(db, 'coinPackages'),
    where('isActive', '==', true),
    limit(25)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: CoinPackageRecord[] = snap.docs
        .map((docSnap) => {
          const d = docSnap.data();
          const priceInr = Number(d.priceInr || 100);
          const baseCoins = Number(d.baseCoins || priceInr);
          const bonusCoins = Number(d.bonusCoins || 0);
          return {
            packageId: String(d.packageId || docSnap.id),
            name: String(d.name || 'Coin Pack'),
            priceInr,
            baseCoins,
            bonusType: (d.bonusType as CoinPackageBonusType) || 'NONE',
            bonusValue: Number(d.bonusValue || 0),
            bonusCoins,
            totalCoins: Number(d.totalCoins || baseCoins + bonusCoins),
            badgeTag: d.badgeTag ? String(d.badgeTag) : undefined,
            description: String(d.description || ''),
            sortOrder: Number(d.sortOrder ?? 0),
            isActive: Boolean(d.isActive),
            updatedByUid: String(d.updatedByUid || ''),
            createdAt: toIso(d.createdAt),
            updatedAt: toIso(d.updatedAt),
          };
        })
        .filter((pkg) => pkg.isActive && pkg.priceInr >= MIN_UPI_DEPOSIT_INR)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.priceInr - b.priceInr);
      onData(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'coinPackages');
      } catch {
        onError('Unable to load configured coin packages.');
      }
    }
  );
}

export function subscribeUserDeposits(
  uid: string,
  onData: (items: DepositRequest[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const q = query(
    collection(db, 'depositRequests'),
    where('uid', '==', uid),
    limit(50)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: DepositRequest[] = snap.docs
        .map((docSnap) => {
          const data = docSnap.data();
          return {
            depositId: String(data.depositId || docSnap.id),
            uid: String(data.uid || uid),
            userId: String(data.userId || ''),
            amountInr: Number(data.amountInr || 0),
            coinsRequested: Number(data.coinsRequested || 0),
            packageId: data.packageId ? String(data.packageId) : undefined,
            packageName: data.packageName ? String(data.packageName) : undefined,
            baseCoins: typeof data.baseCoins === 'number' ? data.baseCoins : undefined,
            bonusCoins: typeof data.bonusCoins === 'number' ? data.bonusCoins : undefined,
            assignedUpiAccountId: String(data.assignedUpiAccountId || ''),
            assignedUpiId: String(data.assignedUpiId || ''),
            assignedUpiDisplayName: String(data.assignedUpiDisplayName || ''),
            assignedQrImageUrl: String(data.assignedQrImageUrl || ''),
            utrNumber: data.utrNumber ? String(data.utrNumber) : undefined,
            status: (data.status as DepositStatus) || 'PENDING',
            rejectionReason: data.rejectionReason ? String(data.rejectionReason) : undefined,
            createdAt: toIso(data.createdAt),
            verifiedAt: data.verifiedAt ? toIso(data.verifiedAt) : undefined,
            verifiedByAdminUid: data.verifiedByAdminUid ? String(data.verifiedByAdminUid) : undefined,
          };
        })
        .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
      onData(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'depositRequests');
      } catch {
        onError('Unable to load your UPI deposit status history.');
      }
    }
  );
}

export function subscribeUserPaymentTransactions(
  uid: string,
  onData: (items: PaymentTransactionRecord[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const q = query(
    collection(db, 'paymentTransactions'),
    where('uid', '==', uid),
    limit(50)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: PaymentTransactionRecord[] = snap.docs
        .map((docSnap) => {
          const d = docSnap.data();
          return {
            paymentTxId: String(d.paymentTxId || docSnap.id),
            depositId: String(d.depositId || ''),
            uid: String(d.uid || uid),
            userId: String(d.userId || ''),
            provider: (d.provider as PaymentGatewayProvider) || 'UPI_GATEWAY',
            gatewayOrderId: d.gatewayOrderId ? String(d.gatewayOrderId) : undefined,
            gatewayPaymentId: d.gatewayPaymentId ? String(d.gatewayPaymentId) : undefined,
            utrReference: d.utrReference ? String(d.utrReference) : undefined,
            amountInr: Number(d.amountInr || 0),
            coinsToCredit: Number(d.coinsToCredit || 0),
            packageId: d.packageId ? String(d.packageId) : undefined,
            bonusCoins: typeof d.bonusCoins === 'number' ? d.bonusCoins : undefined,
            currency: 'INR' as const,
            idempotencyKey: String(d.idempotencyKey || ''),
            creditLockId: String(d.creditLockId || ''),
            utrLockId: d.utrLockId ? String(d.utrLockId) : undefined,
            verificationMethod:
              (d.verificationMethod as PaymentVerificationMethod) || 'ADMIN_SETTLEMENT',
            webhookVerificationStatus:
              (d.webhookVerificationStatus as WebhookVerificationStatus) || 'NOT_RECEIVED',
            lastWebhookEventId: d.lastWebhookEventId
              ? String(d.lastWebhookEventId)
              : undefined,
            status: (d.status as PaymentTxStatus) || 'PENDING_VERIFICATION',
            coinTransactionId: d.coinTransactionId ? String(d.coinTransactionId) : undefined,
            failureReason: d.failureReason ? String(d.failureReason) : undefined,
            createdAt: toIso(d.createdAt),
            updatedAt: toIso(d.updatedAt),
            creditedAt: d.creditedAt ? toIso(d.creditedAt) : undefined,
          };
        })
        .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
      onData(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'paymentTransactions');
      } catch {
        onError('Unable to load payment state tracking records.');
      }
    }
  );
}

/**
 * Atomic Firestore transaction trigger that creates a PENDING deposit verification order
 * and appends a synchronized audit log entry after validating live UPI endpoint and user status.
 * Never mutates coinWallets directly from the client.
 */
export async function submitUpiDepositRequest(params: {
  uid: string;
  userId: string;
  amountInr: number;
  upiAccount: UpiAccount;
  utrNumber: string;
  packageId?: string;
  minDepositInr?: number;
  maxDepositInr?: number;
}): Promise<{ depositId: string; paymentTxId: string; coinsRequested: number }> {
  const cleanUid = params.uid.trim();
  const cleanUserId = params.userId.trim();
  if (!cleanUid || !/^NX[0-9]{6,10}$/.test(cleanUserId)) {
    throw new Error('Verified NEXORA User ID is required before submitting a deposit.');
  }

  const amountErr = validateDepositAmountInr(
    params.amountInr,
    params.minDepositInr ?? MIN_UPI_DEPOSIT_INR,
    params.maxDepositInr ?? MAX_UPI_DEPOSIT_INR
  );
  if (amountErr) {
    throw new Error(amountErr);
  }

  const utrErr = validateUtrReference(params.utrNumber);
  if (utrErr) {
    throw new Error(utrErr);
  }

  if (!params.upiAccount.accountId || !params.upiAccount.upiId) {
    throw new Error('Selected UPI payment endpoint is unavailable.');
  }

  const cleanAmountInr = Math.round(params.amountInr);
  const baseCoins = calculateCoinsForDepositInr(cleanAmountInr);
  const cleanPackageId = params.packageId?.trim() || '';
  let finalCoinsRequested = baseCoins;
  let verifiedBonusCoins = 0;
  let verifiedPackageName = '';

  const cleanUtr = normalizeUtrReference(params.utrNumber);
  const depositId = createId('dep');
  const paymentTxId = buildPaymentTxId(depositId);
  const creditLockId = buildDepositCreditLockId(depositId);
  const utrLockId = buildUtrCreditLockId(cleanUtr);
  const idempotencyKey = buildDepositIdempotencyKey(depositId);
  const activityLogId = createId('ulog');

  const userRef = doc(db, 'users', cleanUid);
  const upiRef = doc(db, 'upiAccounts', params.upiAccount.accountId);
  const settingsRef = doc(db, 'platformSettings', 'global');
  const packageRef = cleanPackageId ? doc(db, 'coinPackages', cleanPackageId) : null;
  const depositRef = doc(db, 'depositRequests', depositId);
  const paymentTxRef = doc(db, 'paymentTransactions', paymentTxId);
  const activityRef = doc(db, 'userActivityLogs', activityLogId);

  try {
    await runTransaction(db, async (tx) => {
      const [userSnap, upiSnap, settingsSnap, existingDepSnap, existingPayTxSnap, packageSnap] =
        await Promise.all([
          tx.get(userRef),
          tx.get(upiRef),
          tx.get(settingsRef),
          tx.get(depositRef),
          tx.get(paymentTxRef),
          packageRef ? tx.get(packageRef) : Promise.resolve(null),
        ]);

      if (!userSnap.exists()) {
        throw new Error('Verified member profile not found.');
      }
      if (userSnap.data().status !== 'ACTIVE') {
        throw new Error('Suspended or unverified accounts cannot submit UPI deposits.');
      }

      if (settingsSnap.exists()) {
        const cfg = settingsSnap.data();
        if (cfg.upiDepositsEnabled === false) {
          throw new Error('UPI coin deposits are currently paused by platform administration.');
        }
        const cfgMin =
          typeof cfg.minDepositInr === 'number' ? cfg.minDepositInr : MIN_UPI_DEPOSIT_INR;
        const cfgMax =
          typeof cfg.maxDepositInr === 'number' ? cfg.maxDepositInr : MAX_UPI_DEPOSIT_INR;
        const cfgErr = validateDepositAmountInr(cleanAmountInr, cfgMin, cfgMax);
        if (cfgErr) {
          throw new Error(cfgErr);
        }
      }

      if (!upiSnap.exists() || upiSnap.data().isActive !== true) {
        throw new Error('Selected UPI endpoint is no longer active. Please refresh and retry.');
      }
      const verifiedUpiId = String(upiSnap.data().upiId || '').trim();
      const verifiedDisplayName = String(upiSnap.data().displayName || params.upiAccount.displayName).trim();
      const verifiedQrUrl = String(upiSnap.data().qrCodeImageUrl || '').trim();

      if (cleanPackageId) {
        if (!packageSnap?.exists() || packageSnap.data().isActive !== true) {
          throw new Error('Selected coin package is no longer active. Please refresh and reselect.');
        }
        const pkgData = packageSnap.data();
        if (Number(pkgData.priceInr) !== cleanAmountInr) {
          throw new Error('Selected coin package price changed. Please reselect the package.');
        }
        verifiedBonusCoins = Math.max(0, Math.round(Number(pkgData.bonusCoins || 0)));
        finalCoinsRequested = Number(pkgData.totalCoins || baseCoins + verifiedBonusCoins);
        verifiedPackageName = String(pkgData.name || 'Coin Package').slice(0, 80);
      } else {
        verifiedBonusCoins = 0;
        finalCoinsRequested = baseCoins;
        verifiedPackageName = '';
      }

      if (existingDepSnap.exists() || existingPayTxSnap.exists()) {
        throw new Error('Duplicate deposit identifier detected. Please retry.');
      }

      tx.set(depositRef, {
        depositId,
        uid: cleanUid,
        userId: cleanUserId,
        amountInr: cleanAmountInr,
        coinsRequested: finalCoinsRequested,
        ...(cleanPackageId
          ? {
              packageId: cleanPackageId,
              packageName: verifiedPackageName,
              baseCoins,
              bonusCoins: verifiedBonusCoins,
            }
          : {}),
        assignedUpiAccountId: params.upiAccount.accountId,
        assignedUpiId: verifiedUpiId.slice(0, 120),
        assignedUpiDisplayName: verifiedDisplayName.slice(0, 100),
        assignedQrImageUrl: verifiedQrUrl.slice(0, 50000),
        utrNumber: cleanUtr,
        status: 'PENDING',
        createdAt: serverTimestamp(),
      });

      tx.set(paymentTxRef, {
        paymentTxId,
        depositId,
        uid: cleanUid,
        userId: cleanUserId,
        provider: 'UPI_GATEWAY',
        utrReference: cleanUtr,
        amountInr: cleanAmountInr,
        coinsToCredit: finalCoinsRequested,
        ...(cleanPackageId
          ? {
              packageId: cleanPackageId,
              bonusCoins: verifiedBonusCoins,
            }
          : {}),
        currency: 'INR',
        idempotencyKey,
        creditLockId,
        utrLockId,
        verificationMethod: 'ADMIN_SETTLEMENT',
        webhookVerificationStatus: 'NOT_RECEIVED',
        status: 'PENDING_VERIFICATION',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      tx.set(activityRef, {
        logId: activityLogId,
        uid: cleanUid,
        category: 'PLAN_CHANGE',
        action: 'UPI_DEPOSIT_SUBMITTED',
        details: `Submitted ₹${cleanAmountInr} (${finalCoinsRequested} Coins) UPI deposit ref ${cleanUtr} -> pending verification`.slice(0, 300),
        createdAt: serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('PERMISSION_DENIED')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `depositRequests/${depositId}`);
  }

  return { depositId, paymentTxId, coinsRequested: finalCoinsRequested };
}
