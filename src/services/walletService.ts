import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Unsubscribe,
  where,
  writeBatch,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { OperationType, auth, db, functions, handleFirestoreError } from '../firebase/client';
import {
  PayoutMethodType,
  PayoutVerificationStatus,
  UserPayoutMethod,
  WithdrawalRequest,
  WithdrawalStatus,
} from '../types/domain';
import {
  extractAccountLast4,
  maskBankAccountNumber,
  maskUpiId,
  MAX_WITHDRAWAL_INR,
  MIN_WITHDRAWAL_INR,
  normalizeIfscCode,
  normalizeUpiId,
  sanitizeBankAccountDigits,
  validateBankAccountInput,
  validateUserUpiId,
} from '../utils/walletControl';

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

export interface WalletPayoutRuntimeStatus {
  payoutsEnabled: boolean;
  securityNotice: string;
}

export function subscribeWalletPayoutStatus(
  onData: (status: WalletPayoutRuntimeStatus) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, 'platformSettings', 'global'),
    (snap) => {
      if (!snap.exists()) {
        onData({
          payoutsEnabled: false,
          securityNotice: '',
        });
        return;
      }
      const d = snap.data();
      onData({
        payoutsEnabled: Boolean(d.payoutsEnabled),
        securityNotice: typeof d.securityNotice === 'string' ? d.securityNotice : '',
      });
    },
    () => {
      onData({
        payoutsEnabled: false,
        securityNotice: '',
      });
    }
  );
}

export function mapPayoutMethodDoc(
  docId: string,
  d: Record<string, unknown>,
  fallbackUid = ''
): UserPayoutMethod {
  return {
    methodId: String(d.methodId || docId),
    uid: String(d.uid || fallbackUid),
    userId: String(d.userId || ''),
    methodType: d.methodType === 'BANK_ACCOUNT' ? 'BANK_ACCOUNT' : 'UPI',
    label: String(d.label || ''),
    upiId: d.upiId ? String(d.upiId) : undefined,
    upiProvider: d.upiProvider ? String(d.upiProvider) : undefined,
    accountHolderName: d.accountHolderName ? String(d.accountHolderName) : undefined,
    bankName: d.bankName ? String(d.bankName) : undefined,
    accountNumber: d.accountNumber ? String(d.accountNumber) : undefined,
    accountNumberMasked: d.accountNumberMasked ? String(d.accountNumberMasked) : undefined,
    accountLast4: d.accountLast4 ? String(d.accountLast4) : undefined,
    ifscCode: d.ifscCode ? String(d.ifscCode) : undefined,
    accountType:
      d.accountType === 'CURRENT'
        ? 'CURRENT'
        : d.accountType === 'SAVINGS'
        ? 'SAVINGS'
        : undefined,
    isDefault: Boolean(d.isDefault),
    verificationStatus:
      (d.verificationStatus as PayoutVerificationStatus) || 'PENDING_VERIFICATION',
    verificationMethod:
      d.verificationMethod === 'OWNERSHIP_CONFIRMED'
        ? 'OWNERSHIP_CONFIRMED'
        : 'ADMIN_REVIEW',
    verificationNote: d.verificationNote ? String(d.verificationNote) : undefined,
    verifiedByAdminUid: d.verifiedByAdminUid ? String(d.verifiedByAdminUid) : undefined,
    verifiedAt: d.verifiedAt ? toIso(d.verifiedAt) : undefined,
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt),
  };
}

export function subscribeUserPayoutMethods(
  uid: string,
  onData: (methods: UserPayoutMethod[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const q = query(
    collection(db, 'userPayoutMethods'),
    where('uid', '==', uid),
    limit(25)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map((docSnap) => mapPayoutMethodDoc(docSnap.id, docSnap.data(), uid))
        .sort((a, b) => {
          if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
          return (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
        });
      onData(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'userPayoutMethods');
      } catch {
        onError('Unable to load your saved UPI IDs and bank accounts.');
      }
    }
  );
}

export function subscribeUserWithdrawals(
  uid: string,
  onData: (items: WithdrawalRequest[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const q = query(
    collection(db, 'withdrawalRequests'),
    where('uid', '==', uid),
    limit(100)
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: WithdrawalRequest[] = snap.docs
        .map((docSnap) => {
          const data = docSnap.data();
          return {
            withdrawalId: String(data.withdrawalId || docSnap.id),
            uid: String(data.uid || uid),
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
        onError('Unable to load your withdrawal history.');
      }
    }
  );
}

async function logWalletSecurityEvent(params: {
  uid: string;
  category: 'SECURITY' | 'WALLET';
  action: string;
  details: string;
}): Promise<void> {
  const logId = createId('ulog');
  try {
    await setDoc(doc(db, 'userActivityLogs', logId), {
      logId,
      uid: params.uid,
      category: params.category,
      action: params.action.slice(0, 120),
      details: params.details.slice(0, 300),
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking audit log
  }
}

export async function saveUserUpiMethod(params: {
  uid: string;
  userId: string;
  methodId?: string;
  label: string;
  upiId: string;
  upiProvider: string;
  isDefault?: boolean;
}): Promise<string> {
  const cleanUid = params.uid.trim();
  const cleanUserId = params.userId.trim();
  if (!cleanUid || !/^NX[0-9]{6,10}$/.test(cleanUserId)) {
    throw new Error('Verified NEXORA User ID is required before adding a UPI ID.');
  }

  const upiErr = validateUserUpiId(params.upiId);
  if (upiErr) throw new Error(upiErr);

  const cleanLabel = params.label.trim().slice(0, 60);
  if (cleanLabel.length < 2) {
    throw new Error('Enter a short nickname/label (e.g., Primary Google Pay).');
  }

  const cleanUpi = normalizeUpiId(params.upiId);
  const cleanProvider = (params.upiProvider || 'Other UPI').trim().slice(0, 40);
  const methodId = (params.methodId || createId('pm_upi')).slice(0, 128);
  const ref = doc(db, 'userPayoutMethods', methodId);

  try {
    await runTransaction(db, async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists()) {
        if (existing.data().uid !== cleanUid) {
          throw new Error('Unauthorized payout method edit attempt.');
        }
        tx.set(ref, {
          methodId,
          uid: cleanUid,
          userId: cleanUserId,
          methodType: 'UPI',
          label: cleanLabel,
          upiId: cleanUpi,
          upiProvider: cleanProvider,
          isDefault: params.isDefault ?? Boolean(existing.data().isDefault),
          verificationStatus: 'PENDING_VERIFICATION',
          verificationMethod: 'ADMIN_REVIEW',
          createdAt: existing.data().createdAt,
          updatedAt: serverTimestamp(),
        });
      } else {
        tx.set(ref, {
          methodId,
          uid: cleanUid,
          userId: cleanUserId,
          methodType: 'UPI',
          label: cleanLabel,
          upiId: cleanUpi,
          upiProvider: cleanProvider,
          isDefault: Boolean(params.isDefault),
          verificationStatus: 'PENDING_VERIFICATION',
          verificationMethod: 'ADMIN_REVIEW',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('PERMISSION_DENIED')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `userPayoutMethods/${methodId}`);
  }

  await logWalletSecurityEvent({
    uid: cleanUid,
    category: 'SECURITY',
    action: params.methodId ? 'UPI_PAYOUT_UPDATED' : 'UPI_PAYOUT_ADDED',
    details: `${params.methodId ? 'Updated' : 'Added'} UPI payout method "${cleanLabel}" (${maskUpiId(cleanUpi)}) -> pending verification`,
  });

  return methodId;
}

export async function saveUserBankAccount(params: {
  uid: string;
  userId: string;
  methodId?: string;
  label: string;
  accountHolderName: string;
  bankName: string;
  accountNumber: string;
  confirmAccountNumber: string;
  ifscCode: string;
  accountType: 'SAVINGS' | 'CURRENT';
  isDefault?: boolean;
}): Promise<string> {
  const cleanUid = params.uid.trim();
  const cleanUserId = params.userId.trim();
  if (!cleanUid || !/^NX[0-9]{6,10}$/.test(cleanUserId)) {
    throw new Error('Verified NEXORA User ID is required before adding a bank account.');
  }

  const cleanLabel = params.label.trim().slice(0, 60);
  if (cleanLabel.length < 2) {
    throw new Error('Enter a bank account label (e.g., HDFC Primary Savings).');
  }

  const bankErr = validateBankAccountInput({
    accountHolderName: params.accountHolderName,
    bankName: params.bankName,
    accountNumber: params.accountNumber,
    confirmAccountNumber: params.confirmAccountNumber,
    ifscCode: params.ifscCode,
  });
  if (bankErr) throw new Error(bankErr);

  const cleanAcct = sanitizeBankAccountDigits(params.accountNumber);
  const masked = maskBankAccountNumber(cleanAcct);
  const last4 = extractAccountLast4(cleanAcct);
  const cleanIfsc = normalizeIfscCode(params.ifscCode);
  const cleanHolder = params.accountHolderName.trim().slice(0, 80);
  const cleanBank = params.bankName.trim().slice(0, 80);
  const methodId = (params.methodId || createId('pm_bank')).slice(0, 128);
  const ref = doc(db, 'userPayoutMethods', methodId);

  try {
    await runTransaction(db, async (tx) => {
      const existing = await tx.get(ref);
      const basePayload = {
        methodId,
        uid: cleanUid,
        userId: cleanUserId,
        methodType: 'BANK_ACCOUNT',
        label: cleanLabel,
        accountHolderName: cleanHolder,
        bankName: cleanBank,
        accountNumber: cleanAcct,
        accountNumberMasked: masked,
        accountLast4: last4,
        ifscCode: cleanIfsc,
        accountType: params.accountType === 'CURRENT' ? 'CURRENT' : 'SAVINGS',
        isDefault: existing.exists()
          ? params.isDefault ?? Boolean(existing.data().isDefault)
          : Boolean(params.isDefault),
        verificationStatus: 'PENDING_VERIFICATION',
        verificationMethod: 'ADMIN_REVIEW',
        updatedAt: serverTimestamp(),
      };

      if (existing.exists()) {
        if (existing.data().uid !== cleanUid) {
          throw new Error('Unauthorized bank account modification.');
        }
        tx.set(ref, {
          ...basePayload,
          createdAt: existing.data().createdAt,
        });
      } else {
        tx.set(ref, {
          ...basePayload,
          createdAt: serverTimestamp(),
        });
      }
    });
  } catch (err) {
    if (err instanceof Error && !err.message.includes('PERMISSION_DENIED')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `userPayoutMethods/${methodId}`);
  }

  await logWalletSecurityEvent({
    uid: cleanUid,
    category: 'SECURITY',
    action: params.methodId ? 'BANK_ACCOUNT_UPDATED' : 'BANK_ACCOUNT_ADDED',
    details: `${params.methodId ? 'Updated' : 'Added'} ${cleanBank} (${masked}, IFSC: ${cleanIfsc}) -> pending ownership check`,
  });

  return methodId;
}

export async function setDefaultUserPayoutMethod(params: {
  uid: string;
  targetMethodId: string;
  methods: UserPayoutMethod[];
}): Promise<void> {
  const batch = writeBatch(db);
  for (const m of params.methods) {
    if (m.uid !== params.uid) continue;
    const nextDefault = m.methodId === params.targetMethodId;
    if (m.isDefault !== nextDefault) {
      batch.update(doc(db, 'userPayoutMethods', m.methodId), {
        isDefault: nextDefault,
        updatedAt: serverTimestamp(),
      });
    }
  }
  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `userPayoutMethods/${params.targetMethodId}`);
  }
}

export async function deleteUserPayoutMethod(params: {
  uid: string;
  method: UserPayoutMethod;
}): Promise<void> {
  if (params.method.uid !== params.uid) {
    throw new Error('Unauthorized payout method removal.');
  }
  try {
    await deleteDoc(doc(db, 'userPayoutMethods', params.method.methodId));
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.DELETE,
      `userPayoutMethods/${params.method.methodId}`
    );
  }

  const maskedDesc =
    params.method.methodType === 'UPI'
      ? maskUpiId(params.method.upiId || '')
      : `${params.method.bankName || 'Bank'} (${params.method.accountNumberMasked || '••••'})`;

  await logWalletSecurityEvent({
    uid: params.uid,
    category: 'SECURITY',
    action:
      params.method.methodType === 'UPI' ? 'UPI_PAYOUT_REMOVED' : 'BANK_ACCOUNT_REMOVED',
    details: `Removed saved payout method "${params.method.label}" (${maskedDesc})`,
  });
}

export async function submitWalletWithdrawal(params: {
  uid: string;
  userId: string;
  amountInr: number;
  payoutMethod: UserPayoutMethod;
  idempotencyKey?: string;
}): Promise<{ withdrawalId: string; amountInr: number }> {
  const cleanUid = params.uid.trim();
  const cleanUserId = params.userId.trim();
  if (!auth.currentUser || auth.currentUser.uid !== cleanUid) {
    throw new Error('Active Firebase Authentication session is required to submit a withdrawal.');
  }
  if (!cleanUid || !/^NX[0-9]{6,10}$/.test(cleanUserId)) {
    throw new Error('Verified NEXORA User ID is required to submit a withdrawal.');
  }
  if (params.payoutMethod.uid !== cleanUid) {
    throw new Error('Selected payout method does not belong to your account.');
  }
  if (params.payoutMethod.verificationStatus !== 'VERIFIED') {
    throw new Error(
      'Selected payout method must pass ownership verification before withdrawals are enabled.'
    );
  }

  const cleanAmount = Math.round(params.amountInr);
  if (
    !Number.isFinite(cleanAmount) ||
    cleanAmount < MIN_WITHDRAWAL_INR ||
    cleanAmount > MAX_WITHDRAWAL_INR
  ) {
    throw new Error(
      `Withdrawal amount must be between ₹${MIN_WITHDRAWAL_INR.toLocaleString('en-IN')} and ₹${MAX_WITHDRAWAL_INR.toLocaleString('en-IN')}.`
    );
  }

  const rawKey = params.idempotencyKey || `${cleanUid}_${Date.now()}`;
  const idempotencyKey = rawKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);

  try {
    const withdrawFn = httpsCallable<
      {
        amountInr: number;
        payoutMethodId: string;
        idempotencyKey: string;
      },
      { withdrawalId: string; amountInr: number }
    >(functions, 'submitWalletWithdrawalFn');

    const response = await withdrawFn({
      amountInr: cleanAmount,
      payoutMethodId: params.payoutMethod.methodId,
      idempotencyKey,
    });

    return response.data;
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code: unknown }).code)
        : '';
    if (code === 'functions/not-found' || code === 'functions/unavailable') {
      throw new Error(
        'Backend withdrawal ledger service (submitWalletWithdrawalFn) is not deployed or unreachable on this Firebase project.'
      );
    }
    if (err instanceof Error && err.message) {
      throw err;
    }
    throw new Error('Unable to submit withdrawal request.');
  }
}
