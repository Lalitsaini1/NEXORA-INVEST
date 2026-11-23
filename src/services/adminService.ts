import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Unsubscribe,
  updateDoc,
} from 'firebase/firestore';
import { SUPER_ADMIN_UID } from '../config/constants';
import { OperationType, db, handleFirestoreError } from '../firebase/client';
import {
  AccountStatus,
  AdminActionType,
  AdminActivityLogEntry,
  AdminLoginAttemptRecord,
  AdminUserRecord,
  CoinPackageBonusType,
  CoinPackageRecord,
  CoinTransaction,
  DepositRequest,
  DepositStatus,
  PayoutMethodType,
  PlatformSettingsRecord,
  ProductPlan,
  TransactionStatus,
  TransactionType,
  UpiAccount,
  UserPayoutMethod,
  UserProfile,
  UserRole,
  WithdrawalRequest,
  WithdrawalStatus,
} from '../types/domain';
import { mapPayoutMethodDoc } from './walletService';
import { calculateDailyDistribution, convertInrToCoins } from '../utils/formatters';
import {
  buildCoinTxIdForDeposit,
  buildDepositCreditLockId,
  buildDepositIdempotencyKey,
  buildPaymentTxId,
  buildUtrCreditLockId,
} from '../utils/paymentIdempotency';
import {
  computePackageBonusMetrics,
  normalizeUtrReference,
} from '../utils/upiGateway';

export interface AdminActorContext {
  uid: string;
  email: string;
  role: 'ADMIN' | 'SUPER_ADMIN';
}

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

export async function recordAdminAction(params: {
  actor: AdminActorContext;
  actionType: AdminActionType;
  targetId: string;
  summary: string;
}): Promise<void> {
  const logId = createId('alog');
  const path = `adminActivityLogs/${logId}`;
  try {
    await setDoc(doc(db, 'adminActivityLogs', logId), {
      logId,
      actorUid: params.actor.uid,
      actorEmail: params.actor.email.slice(0, 160),
      actorRole: params.actor.role,
      actionType: params.actionType,
      targetId: params.targetId.slice(0, 128),
      summary: params.summary.slice(0, 300),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export function subscribeAllUsers(
  onData: (users: UserProfile[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const q = query(collection(db, 'users'), limit(250));
  return onSnapshot(
    q,
    (snap) => {
      const items: UserProfile[] = snap.docs
        .map((docSnap) => {
          const data = docSnap.data();
          return {
            uid: String(data.uid || docSnap.id),
            userId: String(data.userId || ''),
            role: data.role || 'USER',
            fullName: String(data.fullName || 'Member'),
            email: String(data.email || ''),
            mobile: String(data.mobile || ''),
            emailVerified: Boolean(data.emailVerified),
            mobileVerified: Boolean(data.mobileVerified),
            authProvider: data.authProvider || 'password',
            status: data.status || 'ACTIVE',
            avatarUrl: typeof data.avatarUrl === 'string' && data.avatarUrl ? data.avatarUrl : undefined,
            createdAt: toIso(data.createdAt),
            updatedAt: toIso(data.updatedAt),
          } as UserProfile;
        })
        .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
      onData(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'users');
      } catch {
        onError('Unable to list member profiles. Verify Administrator permissions.');
      }
    }
  );
}

export function subscribeAdminDirectory(
  onData: (admins: AdminUserRecord[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const q = query(collection(db, 'adminUsers'), limit(100));
  return onSnapshot(
    q,
    (snap) => {
      const items: AdminUserRecord[] = snap.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          uid: String(data.uid || docSnap.id),
          email: String(data.email || ''),
          displayName: data.displayName ? String(data.displayName) : undefined,
          role: data.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN',
          active: Boolean(data.active),
          createdByUid: data.createdByUid ? String(data.createdByUid) : undefined,
          createdAt: toIso(data.createdAt),
          updatedAt: toIso(data.updatedAt),
        };
      });
      onData(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'adminUsers');
      } catch {
        onError('Unable to load admin directory.');
      }
    }
  );
}

function assertNotSuperAdminTarget(targetUid: string) {
  const normalized = targetUid.trim();
  if (normalized === 'wZQCw7fXrWQCn5HqdSjS6RQHVyi1' || normalized === SUPER_ADMIN_UID) {
    throw new Error(
      'Protected Super Admin account (wZQCw7fXrWQCn5HqdSjS6RQHVyi1) cannot be modified, demoted, suspended, or removed.'
    );
  }
}

export async function promoteUserToAdmin(params: {
  actor: AdminActorContext;
  targetUser: UserProfile;
}): Promise<void> {
  if (params.actor.role !== 'SUPER_ADMIN') {
    throw new Error('Only the Super Admin can promote users to Admin.');
  }
  assertNotSuperAdminTarget(params.targetUser.uid);

  const userRef = doc(db, 'users', params.targetUser.uid);
  const adminRef = doc(db, 'adminUsers', params.targetUser.uid);

  try {
    const adminSnap = await getDoc(adminRef);
    await setDoc(
      adminRef,
      {
        uid: params.targetUser.uid,
        email: params.targetUser.email,
        displayName: params.targetUser.fullName.slice(0, 80),
        role: 'ADMIN',
        active: true,
        createdByUid: params.actor.uid,
        createdAt: adminSnap.exists() ? adminSnap.data().createdAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    await updateDoc(userRef, {
      role: 'ADMIN',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `adminUsers/${params.targetUser.uid}`);
  }

  await recordAdminAction({
    actor: params.actor,
    actionType: 'USER_PROMOTED_TO_ADMIN',
    targetId: params.targetUser.uid,
    summary: `Promoted ${params.targetUser.email || params.targetUser.userId} to Admin`,
  });
}

export async function revokeAdminAccess(params: {
  actor: AdminActorContext;
  targetUid: string;
  targetEmail: string;
}): Promise<void> {
  if (params.actor.role !== 'SUPER_ADMIN') {
    throw new Error('Only the Super Admin can revoke Admin access.');
  }
  assertNotSuperAdminTarget(params.targetUid);

  const adminRef = doc(db, 'adminUsers', params.targetUid);
  const userRef = doc(db, 'users', params.targetUid);

  try {
    const adminSnap = await getDoc(adminRef);
    if (adminSnap.exists()) {
      await deleteDoc(adminRef);
    }

    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      await updateDoc(userRef, {
        role: 'USER',
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `adminUsers/${params.targetUid}`);
  }

  await recordAdminAction({
    actor: params.actor,
    actionType: 'ADMIN_REVOKED',
    targetId: params.targetUid,
    summary: `Revoked Admin access for ${params.targetEmail || params.targetUid}`,
  });
}

export async function authorizeAdminByUid(params: {
  actor: AdminActorContext;
  uid: string;
  email: string;
  displayName?: string;
}): Promise<void> {
  if (params.actor.role !== 'SUPER_ADMIN') {
    throw new Error('Only the Super Admin can add authorized Admin accounts.');
  }
  const cleanUid = params.uid.trim();
  const cleanEmail = params.email.trim().toLowerCase();
  if (!cleanUid || !cleanEmail) {
    throw new Error('Both Firebase UID and verified Email are required.');
  }
  assertNotSuperAdminTarget(cleanUid);

  const adminRef = doc(db, 'adminUsers', cleanUid);
  const userRef = doc(db, 'users', cleanUid);
  try {
    const existingAdmin = await getDoc(adminRef);
    await setDoc(adminRef, {
      uid: cleanUid,
      email: cleanEmail,
      displayName: (params.displayName || cleanEmail.split('@')[0] || 'Admin').slice(0, 80),
      role: 'ADMIN',
      active: true,
      createdByUid: params.actor.uid,
      createdAt: existingAdmin.exists() ? existingAdmin.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      await updateDoc(userRef, {
        role: 'ADMIN',
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `adminUsers/${cleanUid}`);
  }

  await recordAdminAction({
    actor: params.actor,
    actionType: 'ADMIN_CREATED',
    targetId: cleanUid,
    summary: `Authorized Admin account ${cleanEmail} (${cleanUid})`,
  });
}

export async function updateAdminAccount(params: {
  actor: AdminActorContext;
  targetUid: string;
  displayName: string;
  active: boolean;
}): Promise<void> {
  if (params.actor.role !== 'SUPER_ADMIN') {
    throw new Error('Only the Super Admin can edit or suspend Admin accounts.');
  }
  const cleanUid = params.targetUid.trim();
  if (!cleanUid) {
    throw new Error('Target Admin UID is required.');
  }
  assertNotSuperAdminTarget(cleanUid);

  const cleanName = params.displayName.trim().slice(0, 80);
  if (cleanName.length < 2) {
    throw new Error('Admin display name must be at least 2 characters.');
  }

  const adminRef = doc(db, 'adminUsers', cleanUid);
  const userRef = doc(db, 'users', cleanUid);
  let targetEmail = cleanUid;

  try {
    const adminSnap = await getDoc(adminRef);
    if (!adminSnap.exists()) {
      throw new Error('Admin directory record not found.');
    }
    targetEmail = String(adminSnap.data().email || cleanUid);

    await updateDoc(adminRef, {
      displayName: cleanName,
      active: params.active,
      updatedAt: serverTimestamp(),
    });

    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      await updateDoc(userRef, {
        status: params.active ? 'ACTIVE' : 'SUSPENDED',
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    if (err instanceof Error && !err.message.includes('PERMISSION_DENIED')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.UPDATE, `adminUsers/${cleanUid}`);
  }

  await recordAdminAction({
    actor: params.actor,
    actionType: 'USER_STATUS_UPDATED',
    targetId: cleanUid,
    summary: `Updated Admin ${targetEmail} (${cleanName}) · active=${params.active}`,
  });
}

export async function updateUserAccountStatus(params: {
  actor: AdminActorContext;
  targetUser: UserProfile;
  nextStatus: AccountStatus;
}): Promise<void> {
  assertNotSuperAdminTarget(params.targetUser.uid);
  if (params.targetUser.role !== 'USER' && params.actor.role !== 'SUPER_ADMIN') {
    throw new Error('Only Super Admin can change status of Admin accounts.');
  }

  const userRef = doc(db, 'users', params.targetUser.uid);
  try {
    await updateDoc(userRef, {
      status: params.nextStatus,
      updatedAt: serverTimestamp(),
    });

    if (params.targetUser.role === 'ADMIN') {
      const adminRef = doc(db, 'adminUsers', params.targetUser.uid);
      const adminSnap = await getDoc(adminRef);
      if (adminSnap.exists()) {
        await updateDoc(adminRef, {
          active: params.nextStatus === 'ACTIVE',
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${params.targetUser.uid}`);
  }

  await recordAdminAction({
    actor: params.actor,
    actionType: 'USER_STATUS_UPDATED',
    targetId: params.targetUser.uid,
    summary: `Set account ${params.targetUser.email || params.targetUser.userId} status -> ${params.nextStatus}`,
  });
}

export async function adjustUserWalletCoins(params: {
  actor: AdminActorContext;
  targetUser: UserProfile;
  deltaCoins: number;
  reason: string;
}): Promise<void> {
  const delta = Math.round(params.deltaCoins);
  if (!Number.isFinite(delta) || delta === 0) {
    throw new Error('Adjustment coin amount must be a non-zero integer.');
  }
  const cleanReason = params.reason.trim() || 'Manual Admin wallet adjustment';
  const walletRef = doc(db, 'coinWallets', params.targetUser.uid);
  const txId = createId('tx');
  const txRef = doc(db, 'coinTransactions', txId);

  try {
    await runTransaction(db, async (tx) => {
      const walletSnap = await tx.get(walletRef);
      if (!walletSnap.exists()) {
        throw new Error('Member coin wallet does not exist yet.');
      }
      const prev = Number(walletSnap.data().availableCoins || 0);
      const next = Math.max(0, prev + delta);

      tx.update(walletRef, {
        availableCoins: next,
        updatedAt: serverTimestamp(),
      });

      tx.set(txRef, {
        transactionId: txId,
        uid: params.targetUser.uid,
        userId: params.targetUser.userId,
        type: 'ADMIN_ADJUSTMENT',
        amount: delta,
        previousBalance: prev,
        newBalance: next,
        referenceId: `ADJ_${params.actor.uid.slice(0, 8)}`,
        idempotencyKey: txId,
        status: 'COMPLETED',
        description: cleanReason.slice(0, 300),
        createdAt: serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('PERMISSION_DENIED')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `coinWallets/${params.targetUser.uid}`);
  }

  await recordAdminAction({
    actor: params.actor,
    actionType: 'WALLET_ADJUSTED',
    targetId: params.targetUser.uid,
    summary: `Adjusted ${params.targetUser.userId} wallet by ${delta > 0 ? `+${delta}` : delta} Coins (${cleanReason})`,
  });
}

export async function adjustUserWithdrawableInr(params: {
  actor: AdminActorContext;
  targetUser: UserProfile;
  deltaInr: number;
  reason: string;
}): Promise<void> {
  const delta = Math.round(params.deltaInr);
  if (!Number.isFinite(delta) || delta === 0) {
    throw new Error('Adjustment INR amount must be a non-zero whole rupee integer.');
  }
  const cleanReason = params.reason.trim() || 'Eligible INR earnings credit';
  const walletRef = doc(db, 'coinWallets', params.targetUser.uid);
  const txId = createId('tx');
  const txRef = doc(db, 'coinTransactions', txId);

  try {
    await runTransaction(db, async (tx) => {
      const walletSnap = await tx.get(walletRef);
      if (!walletSnap.exists()) {
        throw new Error('Member wallet does not exist yet.');
      }
      const prev = Number(walletSnap.data().withdrawableBalanceInr || 0);
      const next = Math.max(0, prev + delta);

      tx.update(walletRef, {
        withdrawableBalanceInr: next,
        updatedAt: serverTimestamp(),
      });

      tx.set(txRef, {
        transactionId: txId,
        uid: params.targetUser.uid,
        userId: params.targetUser.userId,
        type: 'ADMIN_ADJUSTMENT',
        assetType: 'INR',
        amount: delta,
        previousBalance: prev,
        newBalance: next,
        referenceId: `INR_ADJ_${params.actor.uid.slice(0, 8)}`,
        idempotencyKey: txId,
        status: 'COMPLETED',
        description: `Eligible INR Balance: ${cleanReason}`.slice(0, 300),
        createdAt: serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('PERMISSION_DENIED')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `coinWallets/${params.targetUser.uid}`);
  }

  await recordAdminAction({
    actor: params.actor,
    actionType: 'WALLET_ADJUSTED',
    targetId: params.targetUser.uid,
    summary: `Adjusted ${params.targetUser.userId} Eligible INR by ${delta > 0 ? `+₹${delta}` : `-₹${Math.abs(delta)}`} (${cleanReason})`,
  });
}

export function subscribeAllUpiAccounts(
  onData: (items: UpiAccount[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const q = query(collection(db, 'upiAccounts'), limit(50));
  return onSnapshot(
    q,
    (snap) => {
      const items: UpiAccount[] = snap.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          accountId: String(data.accountId || docSnap.id),
          upiId: String(data.upiId || ''),
          displayName: String(data.displayName || ''),
          qrCodeImageUrl: String(data.qrCodeImageUrl || ''),
          isActive: Boolean(data.isActive),
          updatedAt: toIso(data.updatedAt),
        };
      });
      onData(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'upiAccounts');
      } catch {
        onError('Unable to load UPI accounts.');
      }
    }
  );
}

export async function saveUpiAccount(params: {
  actor: AdminActorContext;
  accountId?: string;
  upiId: string;
  displayName: string;
  qrCodeImageUrl: string;
  isActive: boolean;
}): Promise<void> {
  const accountId = params.accountId || createId('upi');
  const path = `upiAccounts/${accountId}`;
  try {
    await setDoc(doc(db, 'upiAccounts', accountId), {
      accountId,
      upiId: params.upiId.trim().slice(0, 120),
      displayName: params.displayName.trim().slice(0, 100),
      qrCodeImageUrl: params.qrCodeImageUrl.trim().slice(0, 50000),
      isActive: params.isActive,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }

  await recordAdminAction({
    actor: params.actor,
    actionType: 'UPI_ACCOUNT_UPDATED',
    targetId: accountId,
    summary: `${params.accountId ? 'Updated' : 'Created'} UPI account ${params.upiId} (${params.isActive ? 'ACTIVE' : 'INACTIVE'})`,
  });
}

export async function deleteUpiAccount(params: {
  actor: AdminActorContext;
  accountId: string;
  upiId: string;
}): Promise<void> {
  try {
    await deleteDoc(doc(db, 'upiAccounts', params.accountId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `upiAccounts/${params.accountId}`);
  }
  await recordAdminAction({
    actor: params.actor,
    actionType: 'UPI_ACCOUNT_UPDATED',
    targetId: params.accountId,
    summary: `Removed UPI account ${params.upiId}`,
  });
}

export function subscribeAllProductPlans(
  onData: (items: ProductPlan[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const q = query(collection(db, 'productPlans'), limit(50));
  return onSnapshot(
    q,
    (snap) => {
      const items: ProductPlan[] = snap.docs
        .map((docSnap) => {
          const data = docSnap.data();
          const coinDeductionAmount = Number(data.coinDeductionAmount || 0);
          const durationDays = Number(data.durationDays || 1);
          const totalCoinReward = Number(data.totalCoinReward || 0);
          const derivedDailyPct =
            coinDeductionAmount > 0 && durationDays > 0
              ? Math.round((totalCoinReward / durationDays / coinDeductionAmount) * 10000) / 100
              : 0;
          return {
            planId: String(data.planId || docSnap.id),
            productName: String(data.productName || ''),
            category: String(data.category || ''),
            imageUrl: String(data.imageUrl || ''),
            displayedValueInr: Number(data.displayedValueInr || 0),
            planPriceInr: Number(data.planPriceInr || 0),
            coinDeductionAmount,
            durationDays,
            totalCoinReward,
            dailyCoinRewardPreview: Number(data.dailyCoinRewardPreview || 0),
            tierName: data.tierName ? String(data.tierName) : 'Standard Tier',
            minCoins:
              typeof data.minCoins === 'number'
                ? data.minCoins
                : Math.max(1, coinDeductionAmount || 100),
            maxCoins:
              typeof data.maxCoins === 'number'
                ? data.maxCoins
                : Math.max(1, (coinDeductionAmount || 100) * 10),
            dailyRewardPercent:
              typeof data.dailyRewardPercent === 'number'
                ? data.dailyRewardPercent
                : derivedDailyPct,
            description: String(data.description || ''),
            termsAndConditions: String(data.termsAndConditions || ''),
            isActive: Boolean(data.isActive),
            createdAt: toIso(data.createdAt),
            updatedAt: toIso(data.updatedAt),
          };
        })
        .sort((a, b) => (a.minCoins ?? a.coinDeductionAmount) - (b.minCoins ?? b.coinDeductionAmount));
      onData(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'productPlans');
      } catch {
        onError('Unable to load product plans.');
      }
    }
  );
}

export async function saveProductPlan(params: {
  actor: AdminActorContext;
  planId?: string;
  productName: string;
  category: string;
  imageUrl: string;
  displayedValueInr: number;
  planPriceInr: number;
  durationDays: number;
  totalCoinReward: number;
  tierName?: string;
  minCoins?: number;
  maxCoins?: number;
  dailyRewardPercent?: number;
  description: string;
  termsAndConditions: string;
  isActive: boolean;
}): Promise<void> {
  const planId = params.planId || createId('plan');
  const cleanName = params.productName.trim().slice(0, 120);
  if (cleanName.length < 2) {
    throw new Error('Plan name must be at least 2 characters.');
  }

  const planPriceInr = Math.max(1, Math.round(params.planPriceInr));
  const coinDeductionAmount = convertInrToCoins(planPriceInr);
  const durationDays = Math.max(1, Math.min(365, Math.round(params.durationDays)));
  const minCoins = Math.max(
    1,
    Math.min(100000000, Math.round(params.minCoins ?? coinDeductionAmount))
  );
  const maxCoins = Math.max(
    minCoins,
    Math.min(100000000, Math.round(params.maxCoins ?? minCoins * 10))
  );
  if (maxCoins < minCoins) {
    throw new Error('Maximum coin requirement must be greater than or equal to minimum coins.');
  }

  const dailyRewardPercent = Math.max(
    0,
    Math.min(100, Math.round((params.dailyRewardPercent ?? 0) * 100) / 100)
  );
  const totalCoinReward = Math.max(0, Math.round(params.totalCoinReward));
  const schedule = calculateDailyDistribution(totalCoinReward, durationDays);
  const dailyCoinRewardPreview = schedule[0] ?? 0;
  const tierName = (params.tierName?.trim() || 'Standard Tier').slice(0, 48);

  const ref = doc(db, 'productPlans', planId);
  try {
    const existing = await getDoc(ref);
    await setDoc(ref, {
      planId,
      productName: cleanName,
      category: params.category.trim().slice(0, 64) || 'Electronics',
      imageUrl: params.imageUrl.trim().slice(0, 500),
      displayedValueInr: Math.max(0, Math.round(params.displayedValueInr)),
      planPriceInr,
      coinDeductionAmount,
      durationDays,
      totalCoinReward,
      dailyCoinRewardPreview,
      tierName,
      minCoins,
      maxCoins,
      dailyRewardPercent,
      description: params.description.trim().slice(0, 500),
      termsAndConditions: params.termsAndConditions.trim().slice(0, 1000),
      isActive: params.isActive,
      createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('PERMISSION_DENIED')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `productPlans/${planId}`);
  }

  await recordAdminAction({
    actor: params.actor,
    actionType: 'PRODUCT_PLAN_UPDATED',
    targetId: planId,
    summary: `${params.planId ? 'Updated' : 'Created'} ${tierName} cycle "${cleanName}" (${minCoins}–${maxCoins} Coins · ${durationDays}d · ${dailyRewardPercent}%/day)`,
  });
}

export async function deleteProductPlan(params: {
  actor: AdminActorContext;
  planId: string;
  productName: string;
}): Promise<void> {
  try {
    await deleteDoc(doc(db, 'productPlans', params.planId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `productPlans/${params.planId}`);
  }

  await recordAdminAction({
    actor: params.actor,
    actionType: 'PRODUCT_PLAN_UPDATED',
    targetId: params.planId,
    summary: `Deleted product plan "${params.productName}"`,
  });
}

export function subscribeAllCoinPackages(
  onData: (items: CoinPackageRecord[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const q = query(collection(db, 'coinPackages'), limit(50));
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
        .sort((a, b) => a.sortOrder - b.sortOrder || a.priceInr - b.priceInr);
      onData(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'coinPackages');
      } catch {
        onError('Unable to load virtual coin package configurations.');
      }
    }
  );
}

export async function saveCoinPackage(params: {
  actor: AdminActorContext;
  packageId?: string;
  name: string;
  priceInr: number;
  bonusType: CoinPackageBonusType;
  bonusValue: number;
  badgeTag?: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
}): Promise<string> {
  const cleanName = params.name.trim().slice(0, 80);
  if (cleanName.length < 2) {
    throw new Error('Package name must be at least 2 characters.');
  }

  const calc = computePackageBonusMetrics({
    priceInr: params.priceInr,
    bonusType: params.bonusType,
    bonusValue: params.bonusValue,
  });
  if (calc.error) {
    throw new Error(calc.error);
  }

  const packageId = (params.packageId || createId('cpkg')).slice(0, 64);
  const cleanBadge = (params.badgeTag || '').trim().slice(0, 24);
  const cleanDescription = params.description.trim().slice(0, 240);
  const sortOrder = Math.max(0, Math.min(1000, Math.round(params.sortOrder || 0)));

  const ref = doc(db, 'coinPackages', packageId);
  try {
    const existing = await getDoc(ref);
    await setDoc(ref, {
      packageId,
      name: cleanName,
      priceInr: calc.priceInr,
      baseCoins: calc.baseCoins,
      bonusType: calc.bonusType,
      bonusValue: calc.bonusValue,
      bonusCoins: calc.bonusCoins,
      totalCoins: calc.totalCoins,
      ...(cleanBadge ? { badgeTag: cleanBadge } : {}),
      description: cleanDescription,
      sortOrder,
      isActive: params.isActive,
      updatedByUid: params.actor.uid,
      createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('PERMISSION_DENIED')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `coinPackages/${packageId}`);
  }

  await recordAdminAction({
    actor: params.actor,
    actionType: 'COIN_PACKAGE_UPDATED',
    targetId: packageId,
    summary: `${params.packageId ? 'Updated' : 'Created'} coin package "${cleanName}" (₹${calc.priceInr} -> ${calc.baseCoins} Base + ${calc.bonusCoins} Bonus = ${calc.totalCoins} Coins)`,
  });

  return packageId;
}

export async function deleteCoinPackage(params: {
  actor: AdminActorContext;
  packageId: string;
  name: string;
}): Promise<void> {
  try {
    await deleteDoc(doc(db, 'coinPackages', params.packageId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `coinPackages/${params.packageId}`);
  }

  await recordAdminAction({
    actor: params.actor,
    actionType: 'COIN_PACKAGE_UPDATED',
    targetId: params.packageId,
    summary: `Deleted coin package "${params.name}"`,
  });
}

export async function seedDefaultCoinPackages(actor: AdminActorContext): Promise<number> {
  const presets: {
    packageId: string;
    name: string;
    priceInr: number;
    bonusType: CoinPackageBonusType;
    bonusValue: number;
    badgeTag: string;
    description: string;
    sortOrder: number;
  }[] = [
    {
      packageId: 'cpkg_starter_100',
      name: 'Starter Pack',
      priceInr: 100,
      bonusType: 'NONE',
      bonusValue: 0,
      badgeTag: '',
      description: 'Entry INR coin pack at 1:1 base conversion.',
      sortOrder: 1,
    },
    {
      packageId: 'cpkg_standard_500',
      name: 'Standard Pack',
      priceInr: 500,
      bonusType: 'NONE',
      bonusValue: 0,
      badgeTag: '',
      description: 'Standard INR recharge for entry-tier cycles.',
      sortOrder: 2,
    },
    {
      packageId: 'cpkg_growth_1000',
      name: 'Growth Pack',
      priceInr: 1000,
      bonusType: 'PERCENTAGE',
      bonusValue: 2,
      badgeTag: 'Popular · +2%',
      description: 'Includes +2% bonus coins on top of base 1:1 parity.',
      sortOrder: 3,
    },
    {
      packageId: 'cpkg_silver_2500',
      name: 'Silver Pack',
      priceInr: 2500,
      bonusType: 'PERCENTAGE',
      bonusValue: 3,
      badgeTag: '+3% Bonus',
      description: 'Silver recharge tier with 3% promotional coin bonus.',
      sortOrder: 4,
    },
    {
      packageId: 'cpkg_gold_5000',
      name: 'Gold Pack',
      priceInr: 5000,
      bonusType: 'PERCENTAGE',
      bonusValue: 5,
      badgeTag: 'Best Value · +5%',
      description: 'High-value package awarding +250 bonus virtual coins.',
      sortOrder: 5,
    },
    {
      packageId: 'cpkg_inst_10000',
      name: 'Institutional Pack',
      priceInr: 10000,
      bonusType: 'FLAT_COINS',
      bonusValue: 800,
      badgeTag: '+800 Coins',
      description: 'Institutional allocation with +800 flat bonus coins.',
      sortOrder: 6,
    },
  ];

  for (const preset of presets) {
    await saveCoinPackage({
      actor,
      ...preset,
      isActive: true,
    });
  }
  return presets.length;
}

export function subscribeAllDeposits(
  onData: (items: DepositRequest[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const q = query(collection(db, 'depositRequests'), limit(150));
  return onSnapshot(
    q,
    (snap) => {
      const items: DepositRequest[] = snap.docs
        .map((docSnap) => {
          const data = docSnap.data();
          return {
            depositId: String(data.depositId || docSnap.id),
            uid: String(data.uid || ''),
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
        onError('Unable to load deposit requests.');
      }
    }
  );
}

export async function reviewDepositRequest(params: {
  actor: AdminActorContext;
  deposit: DepositRequest;
  decision: 'APPROVED' | 'REJECTED';
  rejectionReason?: string;
}): Promise<void> {
  const depositId = params.deposit.depositId;
  const paymentTxId = buildPaymentTxId(depositId);
  const creditLockId = buildDepositCreditLockId(depositId);
  const coinTxId = buildCoinTxIdForDeposit(depositId);
  const idempotencyKey = buildDepositIdempotencyKey(depositId);

  const depositRef = doc(db, 'depositRequests', depositId);
  const payTxRef = doc(db, 'paymentTransactions', paymentTxId);
  const depLockRef = doc(db, 'paymentCreditLocks', creditLockId);
  const walletRef = doc(db, 'coinWallets', params.deposit.uid);
  const txRef = doc(db, 'coinTransactions', coinTxId);

  try {
    await runTransaction(db, async (tx) => {
      const depSnap = await tx.get(depositRef);
      if (!depSnap.exists()) throw new Error('Deposit request not found.');
      const depData = depSnap.data();
      const currentStatus = depData.status;
      if (currentStatus === 'APPROVED' || currentStatus === 'REJECTED') {
        throw new Error(`Deposit already finalized (${currentStatus}).`);
      }

      const cleanUtr = depData.utrNumber
        ? normalizeUtrReference(String(depData.utrNumber))
        : '';
      const utrLockId = cleanUtr ? buildUtrCreditLockId(cleanUtr) : '';
      const utrLockRef = utrLockId ? doc(db, 'paymentCreditLocks', utrLockId) : null;

      const [payTxSnap, depLockSnap, utrLockSnap, coinTxSnap, walletSnap] = await Promise.all([
        tx.get(payTxRef),
        tx.get(depLockRef),
        utrLockRef ? tx.get(utrLockRef) : Promise.resolve(null),
        tx.get(txRef),
        params.decision === 'APPROVED' ? tx.get(walletRef) : Promise.resolve(null),
      ]);

      if (params.decision === 'APPROVED') {
        if (
          depLockSnap.exists() ||
          utrLockSnap?.exists() ||
          coinTxSnap.exists() ||
          (payTxSnap.exists() && payTxSnap.data().status === 'CREDITED')
        ) {
          throw new Error(
            'Duplicate coin credit blocked: an immutable credit lock already exists for this deposit or UTR reference.'
          );
        }
        if (!walletSnap?.exists()) {
          throw new Error('Member coin wallet does not exist yet.');
        }
      }

      const verifiedAmountInr = Math.max(0, Math.round(Number(depData.amountInr || 0)));
      const baseCoins = convertInrToCoins(verifiedAmountInr);
      const rawBonus =
        depData.packageId &&
        typeof depData.bonusCoins === 'number' &&
        Number.isInteger(depData.bonusCoins) &&
        depData.bonusCoins >= 0 &&
        depData.bonusCoins <= verifiedAmountInr
          ? depData.bonusCoins
          : 0;
      const coins = baseCoins + rawBonus;

      tx.update(depositRef, {
        status: params.decision,
        rejectionReason:
          params.decision === 'REJECTED'
            ? (params.rejectionReason || 'Rejected by administrator').slice(0, 300)
            : '',
        verifiedAt: serverTimestamp(),
        verifiedByAdminUid: params.actor.uid,
      });

      if (params.decision === 'APPROVED' && walletSnap?.exists()) {
        const prev = Number(walletSnap.data().availableCoins || 0);
        const purchasedPrev = Number(walletSnap.data().purchasedCoins || 0);
        const earnedPrev = Number(walletSnap.data().earnedCoins || 0);
        const next = prev + coins;

        tx.update(walletRef, {
          availableCoins: next,
          purchasedCoins: purchasedPrev + baseCoins,
          earnedCoins: earnedPrev + rawBonus,
          updatedAt: serverTimestamp(),
        });

        tx.set(txRef, {
          transactionId: coinTxId,
          uid: params.deposit.uid,
          userId: params.deposit.userId,
          type: 'COIN_PURCHASE',
          amount: coins,
          previousBalance: prev,
          newBalance: next,
          referenceId: cleanUtr || depositId,
          idempotencyKey,
          status: 'COMPLETED',
          description:
            rawBonus > 0
              ? `Approved INR ₹${verifiedAmountInr} UPI deposit (+${rawBonus} Package Bonus Coins)`
              : `Approved INR ₹${verifiedAmountInr} UPI deposit`,
          createdAt: serverTimestamp(),
        });

        tx.set(depLockRef, {
          lockId: creditLockId,
          lockScope: 'DEPOSIT_ORDER',
          paymentTxId,
          depositId,
          uid: params.deposit.uid,
          userId: params.deposit.userId,
          coinsCredited: coins,
          coinTransactionId: coinTxId,
          createdByUid: params.actor.uid,
          createdAt: serverTimestamp(),
        });

        if (utrLockRef && utrLockId) {
          tx.set(utrLockRef, {
            lockId: utrLockId,
            lockScope: 'UTR_REFERENCE',
            paymentTxId,
            depositId,
            uid: params.deposit.uid,
            userId: params.deposit.userId,
            coinsCredited: coins,
            coinTransactionId: coinTxId,
            createdByUid: params.actor.uid,
            createdAt: serverTimestamp(),
          });
        }

        if (payTxSnap.exists()) {
          const existingPayStatus = payTxSnap.data().status;
          if (existingPayStatus !== 'CREDITED' && existingPayStatus !== 'REJECTED') {
            tx.update(payTxRef, {
              ...(utrLockId ? { utrLockId } : {}),
              status: 'CREDITED',
              coinTransactionId: coinTxId,
              updatedAt: serverTimestamp(),
              creditedAt: serverTimestamp(),
            });
          }
        } else {
          tx.set(payTxRef, {
            paymentTxId,
            depositId,
            uid: params.deposit.uid,
            userId: params.deposit.userId,
            provider: 'UPI_GATEWAY',
            ...(cleanUtr ? { utrReference: cleanUtr } : {}),
            amountInr: verifiedAmountInr,
            coinsToCredit: coins,
            currency: 'INR',
            idempotencyKey,
            creditLockId,
            ...(utrLockId ? { utrLockId } : {}),
            verificationMethod: 'ADMIN_SETTLEMENT',
            webhookVerificationStatus: 'NOT_RECEIVED',
            status: 'CREDITED',
            coinTransactionId: coinTxId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            creditedAt: serverTimestamp(),
          });
        }
      } else if (params.decision === 'REJECTED') {
        const failReason = (params.rejectionReason || 'Rejected by administrator').slice(0, 300);
        if (payTxSnap.exists()) {
          const existingPayStatus = payTxSnap.data().status;
          if (existingPayStatus !== 'CREDITED' && existingPayStatus !== 'REJECTED') {
            tx.update(payTxRef, {
              status: 'REJECTED',
              failureReason: failReason,
              updatedAt: serverTimestamp(),
            });
          }
        } else {
          tx.set(payTxRef, {
            paymentTxId,
            depositId,
            uid: params.deposit.uid,
            userId: params.deposit.userId,
            provider: 'UPI_GATEWAY',
            ...(cleanUtr ? { utrReference: cleanUtr } : {}),
            amountInr: verifiedAmountInr,
            coinsToCredit: coins,
            currency: 'INR',
            idempotencyKey,
            creditLockId,
            ...(utrLockId ? { utrLockId } : {}),
            verificationMethod: 'ADMIN_SETTLEMENT',
            webhookVerificationStatus: 'NOT_RECEIVED',
            status: 'REJECTED',
            failureReason: failReason,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
    });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('PERMISSION_DENIED')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `depositRequests/${depositId}`);
  }

  await recordAdminAction({
    actor: params.actor,
    actionType: 'DEPOSIT_REVIEWED',
    targetId: depositId,
    summary: `${params.decision} deposit ${depositId} (${params.deposit.userId}, ${params.deposit.coinsRequested} Coins)`,
  });
}

export function subscribeAllPayoutMethods(
  onData: (items: UserPayoutMethod[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const q = query(collection(db, 'userPayoutMethods'), limit(150));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((docSnap) => mapPayoutMethodDoc(docSnap.id, docSnap.data()))
        .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
      onData(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'userPayoutMethods');
      } catch {
        onError('Unable to load user payout methods for verification.');
      }
    }
  );
}

export async function reviewUserPayoutMethod(params: {
  actor: AdminActorContext;
  method: UserPayoutMethod;
  decision: 'VERIFIED' | 'REJECTED';
  note?: string;
}): Promise<void> {
  const ref = doc(db, 'userPayoutMethods', params.method.methodId);
  const cleanNote = (
    params.note ||
    (params.decision === 'VERIFIED'
      ? `Ownership verified by ${params.actor.email}`
      : 'Rejected during ownership verification')
  )
    .trim()
    .slice(0, 300);

  try {
    await updateDoc(ref, {
      verificationStatus: params.decision,
      verificationMethod:
        params.decision === 'VERIFIED' ? 'OWNERSHIP_CONFIRMED' : 'ADMIN_REVIEW',
      verificationNote: cleanNote,
      verifiedByAdminUid: params.actor.uid,
      verifiedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.UPDATE,
      `userPayoutMethods/${params.method.methodId}`
    );
  }

  await recordAdminAction({
    actor: params.actor,
    actionType: 'PAYOUT_METHOD_REVIEWED',
    targetId: params.method.methodId,
    summary: `Marked ${params.method.userId} ${params.method.methodType} (${params.method.label}) as ${params.decision}`,
  });
}

export function subscribeAllWithdrawals(
  onData: (items: WithdrawalRequest[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const q = query(collection(db, 'withdrawalRequests'), limit(150));
  return onSnapshot(
    q,
    (snap) => {
      const items: WithdrawalRequest[] = snap.docs
        .map((docSnap) => {
          const data = docSnap.data();
          return {
            withdrawalId: String(data.withdrawalId || docSnap.id),
            uid: String(data.uid || ''),
            userId: String(data.userId || ''),
            amountInr: Number(data.amountInr || 0),
            payoutMethodId: data.payoutMethodId ? String(data.payoutMethodId) : undefined,
            payoutMethodType:
              data.payoutMethodType === 'BANK_ACCOUNT'
                ? ('BANK_ACCOUNT' as PayoutMethodType)
                : data.payoutMethodType === 'UPI'
                ? ('UPI' as PayoutMethodType)
                : undefined,
            payoutLabel: data.payoutLabel ? String(data.payoutLabel) : undefined,
            payoutDestinationMasked: data.payoutDestinationMasked
              ? String(data.payoutDestinationMasked)
              : undefined,
            idempotencyKey: data.idempotencyKey ? String(data.idempotencyKey) : undefined,
            status: (data.status as WithdrawalStatus) || 'PENDING',
            remarks: data.remarks ? String(data.remarks) : undefined,
            createdAt: toIso(data.createdAt),
            updatedAt: toIso(data.updatedAt),
            paidAt: data.paidAt ? toIso(data.paidAt) : undefined,
          };
        })
        .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
      onData(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'withdrawalRequests');
      } catch {
        onError('Unable to load withdrawal requests.');
      }
    }
  );
}

export async function reviewWithdrawalRequest(params: {
  actor: AdminActorContext;
  withdrawal: WithdrawalRequest;
  nextStatus: 'PROCESSING' | 'APPROVED' | 'COMPLETED' | 'PAID' | 'REJECTED';
  remarks?: string;
}): Promise<void> {
  const wdRef = doc(db, 'withdrawalRequests', params.withdrawal.withdrawalId);
  const walletRef = doc(db, 'coinWallets', params.withdrawal.uid);
  const refundTxId = `wref_${params.withdrawal.withdrawalId}`;
  const txRef = doc(db, 'coinTransactions', refundTxId);

  try {
    await runTransaction(db, async (tx) => {
      const wdSnap = await tx.get(wdRef);
      if (!wdSnap.exists()) throw new Error('Withdrawal request not found.');
      const curr = String(wdSnap.data().status || '');
      if (curr === 'COMPLETED' || curr === 'PAID' || curr === 'REJECTED') {
        throw new Error(`Withdrawal already finalized (${curr}).`);
      }

      const [walletSnap, refundTxSnap] = await Promise.all([
        tx.get(walletRef),
        params.nextStatus === 'REJECTED' ? tx.get(txRef) : Promise.resolve(null),
      ]);

      const isCompletion =
        params.nextStatus === 'COMPLETED' || params.nextStatus === 'PAID';

      tx.update(wdRef, {
        status: params.nextStatus,
        remarks: (params.remarks || `Processed (${params.nextStatus}) by ${params.actor.email}`).slice(
          0,
          300
        ),
        updatedAt: serverTimestamp(),
        ...(isCompletion ? { paidAt: serverTimestamp() } : {}),
      });

      // Refund INR directly back to withdrawableBalanceInr without converting or touching Coin balances.
      if (params.nextStatus === 'REJECTED' && walletSnap.exists() && !refundTxSnap?.exists()) {
        const prevInr = Number(walletSnap.data().withdrawableBalanceInr || 0);
        const refundInr = Math.max(0, Math.round(params.withdrawal.amountInr));
        const nextInr = prevInr + refundInr;
        tx.update(walletRef, {
          withdrawableBalanceInr: nextInr,
          updatedAt: serverTimestamp(),
        });
        tx.set(txRef, {
          transactionId: refundTxId,
          uid: params.withdrawal.uid,
          userId: params.withdrawal.userId,
          type: 'WITHDRAWAL_REFUND',
          assetType: 'INR',
          amount: refundInr,
          previousBalance: prevInr,
          newBalance: nextInr,
          referenceId: params.withdrawal.withdrawalId,
          idempotencyKey: `${params.withdrawal.withdrawalId}_refund`,
          status: 'COMPLETED',
          description: `Refunded rejected withdrawal ₹${refundInr.toLocaleString('en-IN')} to Eligible INR Balance`,
          createdAt: serverTimestamp(),
        });
      }
    });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('PERMISSION_DENIED')) {
      throw err;
    }
    handleFirestoreError(
      err,
      OperationType.WRITE,
      `withdrawalRequests/${params.withdrawal.withdrawalId}`
    );
  }

  await recordAdminAction({
    actor: params.actor,
    actionType: 'WITHDRAWAL_REVIEWED',
    targetId: params.withdrawal.withdrawalId,
    summary: `Marked withdrawal ${params.withdrawal.withdrawalId} (${params.withdrawal.userId}, ₹${params.withdrawal.amountInr}) as ${params.nextStatus}`,
  });
}

export function subscribeAdminActivityLogs(
  onData: (logs: AdminActivityLogEntry[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const q = query(collection(db, 'adminActivityLogs'), limit(150));
  return onSnapshot(
    q,
    (snap) => {
      const items: AdminActivityLogEntry[] = snap.docs
        .map((docSnap) => {
          const data = docSnap.data();
          const actorRole: 'ADMIN' | 'SUPER_ADMIN' =
            data.actorRole === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN';
          return {
            logId: String(data.logId || docSnap.id),
            actorUid: String(data.actorUid || ''),
            actorEmail: String(data.actorEmail || ''),
            actorRole,
            actionType: (data.actionType as AdminActionType) || 'USER_STATUS_UPDATED',
            targetId: String(data.targetId || ''),
            summary: String(data.summary || ''),
            createdAt: toIso(data.createdAt),
          };
        })
        .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
      onData(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'adminActivityLogs');
      } catch {
        onError('Unable to load admin audit logs.');
      }
    }
  );
}

export function subscribePlatformSettings(
  onData: (settings: PlatformSettingsRecord | null) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const ref = doc(db, 'platformSettings', 'global');
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const data = snap.data();
      onData({
        settingId: String(data.settingId || 'global'),
        payoutsEnabled: Boolean(data.payoutsEnabled),
        registrationsEnabled: data.registrationsEnabled !== false,
        supportEmail: String(data.supportEmail || 'support@nexorainvest.example'),
        supportPhone: String(data.supportPhone || '+91 800-000-0000'),
        securityNotice: data.securityNotice ? String(data.securityNotice) : undefined,
        requireEmailVerification:
          typeof data.requireEmailVerification === 'boolean'
            ? data.requireEmailVerification
            : true,
        enforceAdminMfaOrOtp:
          typeof data.enforceAdminMfaOrOtp === 'boolean' ? data.enforceAdminMfaOrOtp : false,
        sessionTimeoutMinutes:
          typeof data.sessionTimeoutMinutes === 'number' ? data.sessionTimeoutMinutes : 60,
        maxAdminLoginAttempts:
          typeof data.maxAdminLoginAttempts === 'number' ? data.maxAdminLoginAttempts : 5,
        auditLogRetentionDays:
          typeof data.auditLogRetentionDays === 'number' ? data.auditLogRetentionDays : 365,
        upiDepositsEnabled: data.upiDepositsEnabled !== false,
        minDepositInr: typeof data.minDepositInr === 'number' ? data.minDepositInr : 100,
        maxDepositInr: typeof data.maxDepositInr === 'number' ? data.maxDepositInr : 500000,
        coinPackagesCsv:
          typeof data.coinPackagesCsv === 'string' && data.coinPackagesCsv
            ? data.coinPackagesCsv
            : '100,500,1000,2500,5000,10000',
        updatedByUid: String(data.updatedByUid || ''),
        updatedAt: toIso(data.updatedAt),
      });
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, 'platformSettings/global');
      } catch {
        onError('Unable to load platform settings.');
      }
    }
  );
}

export async function savePlatformSettings(params: {
  actor: AdminActorContext;
  payoutsEnabled: boolean;
  registrationsEnabled: boolean;
  supportEmail: string;
  supportPhone: string;
  securityNotice: string;
  requireEmailVerification?: boolean;
  enforceAdminMfaOrOtp?: boolean;
  sessionTimeoutMinutes?: number;
  maxAdminLoginAttempts?: number;
  auditLogRetentionDays?: number;
  upiDepositsEnabled?: boolean;
  minDepositInr?: number;
  maxDepositInr?: number;
  coinPackagesCsv?: string;
}): Promise<void> {
  if (params.actor.role !== 'SUPER_ADMIN') {
    throw new Error('Only Super Admin may update website configuration and security settings.');
  }

  const sessionTimeoutMinutes = Math.max(
    15,
    Math.min(1440, Math.round(params.sessionTimeoutMinutes ?? 60))
  );
  const maxAdminLoginAttempts = Math.max(
    3,
    Math.min(20, Math.round(params.maxAdminLoginAttempts ?? 5))
  );
  const auditLogRetentionDays = Math.max(
    30,
    Math.min(3650, Math.round(params.auditLogRetentionDays ?? 365))
  );
  const minDepositInr = Math.max(
    100,
    Math.min(100000, Math.round(params.minDepositInr ?? 100))
  );
  const maxDepositInr = Math.max(
    minDepositInr,
    Math.min(500000, Math.round(params.maxDepositInr ?? 500000))
  );
  const cleanedCsv = (params.coinPackagesCsv || '100,500,1000,2500,5000,10000')
    .split(',')
    .map((p) => Number.parseInt(p.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 100 && n <= 500000)
    .slice(0, 8)
    .join(',');
  const coinPackagesCsv = /^[0-9]{2,6}(,[0-9]{2,6}){0,7}$/.test(cleanedCsv)
    ? cleanedCsv
    : '100,500,1000,2500,5000,10000';

  try {
    await setDoc(doc(db, 'platformSettings', 'global'), {
      settingId: 'global',
      payoutsEnabled: params.payoutsEnabled,
      registrationsEnabled: params.registrationsEnabled,
      supportEmail: params.supportEmail.trim().slice(0, 160),
      supportPhone: params.supportPhone.trim().slice(0, 30),
      securityNotice: params.securityNotice.trim().slice(0, 300),
      requireEmailVerification: params.requireEmailVerification ?? true,
      enforceAdminMfaOrOtp: params.enforceAdminMfaOrOtp ?? false,
      sessionTimeoutMinutes,
      maxAdminLoginAttempts,
      auditLogRetentionDays,
      upiDepositsEnabled: params.upiDepositsEnabled ?? true,
      minDepositInr,
      maxDepositInr,
      coinPackagesCsv,
      updatedByUid: params.actor.uid,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'platformSettings/global');
  }

  await recordAdminAction({
    actor: params.actor,
    actionType: 'PLATFORM_SETTINGS_UPDATED',
    targetId: 'global',
    summary: `Updated security & payment config (payouts=${params.payoutsEnabled}, upiDeposits=${params.upiDepositsEnabled ?? true}, retention=${auditLogRetentionDays}d)`,
  });
}

export async function recordAdminLoginAttempt(params: {
  uid: string;
  email: string;
  role: UserRole;
  outcome: 'SUCCESS' | 'DENIED_NOT_ADMIN';
}): Promise<void> {
  if (!params.uid) return;
  const attemptId = createId('loginatt');
  const path = `adminLoginAttempts/${attemptId}`;
  try {
    await setDoc(doc(db, 'adminLoginAttempts', attemptId), {
      attemptId,
      uid: params.uid,
      email: params.email.trim().slice(0, 160),
      role: params.role,
      outcome: params.outcome,
      timestamp: serverTimestamp(),
    });
  } catch (err) {
    try {
      handleFirestoreError(err, OperationType.CREATE, path);
    } catch {
      // Telemetry write must not block authentication flow
    }
  }
}

export function subscribeAdminLoginAttempts(
  onData: (items: AdminLoginAttemptRecord[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const q = query(collection(db, 'adminLoginAttempts'), limit(100));
  return onSnapshot(
    q,
    (snap) => {
      const items: AdminLoginAttemptRecord[] = snap.docs
        .map((docSnap) => {
          const data = docSnap.data();
          const role: UserRole =
            data.role === 'SUPER_ADMIN'
              ? 'SUPER_ADMIN'
              : data.role === 'ADMIN'
              ? 'ADMIN'
              : 'USER';
          const outcome: AdminLoginAttemptRecord['outcome'] =
            data.outcome === 'DENIED_NOT_ADMIN' ? 'DENIED_NOT_ADMIN' : 'SUCCESS';
          return {
            attemptId: String(data.attemptId || docSnap.id),
            uid: String(data.uid || ''),
            email: String(data.email || ''),
            role,
            outcome,
            timestamp: toIso(data.timestamp),
          };
        })
        .sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));
      onData(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'adminLoginAttempts');
      } catch {
        onError('Unable to load real-time admin login attempts.');
      }
    }
  );
}

export function subscribeAllTransactions(
  onData: (items: CoinTransaction[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const q = query(collection(db, 'coinTransactions'), limit(250));
  return onSnapshot(
    q,
    (snap) => {
      const items: CoinTransaction[] = snap.docs
        .map((docSnap) => {
          const data = docSnap.data();
          return {
            transactionId: String(data.transactionId || docSnap.id),
            uid: String(data.uid || ''),
            userId: String(data.userId || ''),
            type: (data.type as TransactionType) || 'ADMIN_ADJUSTMENT',
            assetType: (data.assetType === 'INR' ? 'INR' : 'COINS') as 'COINS' | 'INR',
            amount: Number(data.amount || 0),
            previousBalance: Number(data.previousBalance || 0),
            newBalance: Number(data.newBalance || 0),
            referenceId: String(data.referenceId || ''),
            idempotencyKey: String(data.idempotencyKey || ''),
            status: (data.status as TransactionStatus) || 'COMPLETED',
            description: String(data.description || ''),
            createdAt: toIso(data.createdAt),
          };
        })
        .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
      onData(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'coinTransactions');
      } catch {
        onError('Unable to query platform transactions.');
      }
    }
  );
}
