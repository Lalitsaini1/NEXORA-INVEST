import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Unsubscribe,
  where,
} from 'firebase/firestore';
import { OperationType, db, handleFirestoreError } from '../firebase/client';
import {
  ReferralRecord,
  UserActivityCategory,
  UserActivityLogEntry,
} from '../types/domain';

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

function makeLogId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 14)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now()}_${rand}`;
}

export async function recordUserActivity(params: {
  uid: string;
  category: UserActivityCategory;
  action: string;
  details: string;
}): Promise<void> {
  if (!params.uid) return;
  const logId = makeLogId('ulog');
  const path = `userActivityLogs/${logId}`;
  try {
    await setDoc(doc(db, 'userActivityLogs', logId), {
      logId,
      uid: params.uid,
      category: params.category,
      action: params.action.trim().slice(0, 120),
      details: params.details.trim().slice(0, 300),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    try {
      handleFirestoreError(err, OperationType.CREATE, path);
    } catch {
      // Activity audit logging must remain non-blocking for primary user flows
    }
  }
}

export function subscribeUserActivityLogs(
  uid: string,
  onData: (logs: UserActivityLogEntry[]) => void,
  onError: (message: string) => void
): Unsubscribe {
  const q = query(
    collection(db, 'userActivityLogs'),
    where('uid', '==', uid),
    limit(100)
  );

  return onSnapshot(
    q,
    (snap) => {
      const items: UserActivityLogEntry[] = snap.docs
        .map((docSnap) => {
          const data = docSnap.data();
          return {
            logId: String(data.logId || docSnap.id),
            uid: String(data.uid || uid),
            category: (data.category as UserActivityCategory) || 'SECURITY',
            action: String(data.action || 'Account Activity'),
            details: String(data.details || ''),
            createdAt: toIso(data.createdAt),
          };
        })
        .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));

      onData(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'userActivityLogs');
      } catch {
        onError('Unable to load account activity log from Firestore.');
      }
    }
  );
}

export async function ensureReferralCodeRegistered(
  uid: string,
  userId: string
): Promise<void> {
  if (!uid || !/^NX[0-9]{6,10}$/.test(userId)) return;
  const path = `referralCodes/${userId}`;
  try {
    const ref = doc(db, 'referralCodes', userId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        code: userId,
        ownerUid: uid,
        createdAt: serverTimestamp(),
      });
    }
  } catch (err) {
    try {
      handleFirestoreError(err, OperationType.WRITE, path);
    } catch {
      // Non-fatal if referral directory doc already exists
    }
  }
}

export async function attributeReferralSignup(params: {
  referralCode: string;
  referredUid: string;
  referredUserId: string;
}): Promise<boolean> {
  const cleanCode = params.referralCode.trim().toUpperCase();
  if (!/^NX[0-9]{6,10}$/.test(cleanCode) || !params.referredUid) {
    return false;
  }

  try {
    const codeSnap = await getDoc(doc(db, 'referralCodes', cleanCode));
    if (!codeSnap.exists()) {
      return false;
    }

    const ownerUid = String(codeSnap.data().ownerUid || '');
    if (!ownerUid || ownerUid === params.referredUid) {
      return false;
    }

    const referralRef = doc(db, 'referrals', params.referredUid);
    const existing = await getDoc(referralRef);
    if (existing.exists()) {
      return false;
    }

    await setDoc(referralRef, {
      referralId: params.referredUid,
      referrerUid: ownerUid,
      referrerCode: cleanCode,
      referredUid: params.referredUid,
      referredUserId: params.referredUserId,
      createdAt: serverTimestamp(),
    });
    return true;
  } catch (err) {
    try {
      handleFirestoreError(err, OperationType.WRITE, `referrals/${params.referredUid}`);
    } catch {
      return false;
    }
  }
}

export function subscribeUserReferrals(
  uid: string,
  onData: (referrals: ReferralRecord[]) => void,
  onError: (message: string) => void
): Unsubscribe {
  const q = query(
    collection(db, 'referrals'),
    where('referrerUid', '==', uid),
    limit(100)
  );

  return onSnapshot(
    q,
    (snap) => {
      const items: ReferralRecord[] = snap.docs
        .map((docSnap) => {
          const data = docSnap.data();
          return {
            referralId: String(data.referralId || docSnap.id),
            referrerUid: String(data.referrerUid || uid),
            referrerCode: String(data.referrerCode || ''),
            referredUid: String(data.referredUid || ''),
            referredUserId: String(data.referredUserId || ''),
            createdAt: toIso(data.createdAt),
          };
        })
        .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));

      onData(items);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, 'referrals');
      } catch {
        onError('Unable to load referral records from Firestore.');
      }
    }
  );
}
