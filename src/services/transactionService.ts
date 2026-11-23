import {
  collection,
  limit,
  onSnapshot,
  query,
  Unsubscribe,
  where,
} from 'firebase/firestore';
import { OperationType, db, handleFirestoreError } from '../firebase/client';
import {
  CoinTransaction,
  DailyRewardRecord,
  TransactionStatus,
  TransactionType,
  UserPlan,
  UserPlanStatus,
} from '../types/domain';

function normalizeTimestamp(raw: unknown): string {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'toDate' in raw &&
    typeof (raw as { toDate: unknown }).toDate === 'function'
  ) {
    return (raw as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof raw === 'string') {
    return raw;
  }
  return '';
}

function normalizeStatus(raw: unknown): TransactionStatus {
  const val = String(raw || '').toUpperCase();
  if (val === 'PENDING' || val === 'COMPLETED' || val === 'REJECTED' || val === 'FAILED') {
    return val;
  }
  return 'PENDING';
}

function normalizeType(raw: unknown): TransactionType {
  const val = String(raw || '').toUpperCase();
  if (
    val === 'COIN_PURCHASE' ||
    val === 'PLAN_INVESTMENT' ||
    val === 'DAILY_REWARD' ||
    val === 'WITHDRAWAL_REQUEST' ||
    val === 'WITHDRAWAL_REFUND' ||
    val === 'ADMIN_ADJUSTMENT'
  ) {
    return val;
  }
  return 'ADMIN_ADJUSTMENT';
}

export function subscribeUserTransactions(
  uid: string,
  onData: (transactions: CoinTransaction[]) => void,
  onError: (message: string) => void
): Unsubscribe {
  const txQuery = query(
    collection(db, 'coinTransactions'),
    where('uid', '==', uid),
    limit(100)
  );

  return onSnapshot(
    txQuery,
    (snapshot) => {
      const items: CoinTransaction[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          transactionId: String(data.transactionId || docSnap.id),
          uid: String(data.uid || uid),
          userId: String(data.userId || ''),
          type: normalizeType(data.type),
          assetType: data.assetType === 'INR' ? 'INR' : 'COINS',
          amount: Number(data.amount || 0),
          previousBalance: Number(data.previousBalance || 0),
          newBalance: Number(data.newBalance || 0),
          referenceId: String(data.referenceId || docSnap.id),
          idempotencyKey: String(data.idempotencyKey || ''),
          status: normalizeStatus(data.status),
          description: String(data.description || ''),
          createdAt: normalizeTimestamp(data.createdAt),
        };
      });
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'coinTransactions');
      } catch {
        onError(
          'Unable to load transaction history from Firestore. Please check permissions or try again.'
        );
      }
    }
  );
}

function normalizePlanStatus(raw: unknown): UserPlanStatus {
  const val = String(raw || '').toUpperCase();
  if (val === 'ACTIVE' || val === 'COMPLETED' || val === 'CANCELLED') {
    return val;
  }
  return 'ACTIVE';
}

export function subscribeUserPlans(
  uid: string,
  onData: (plans: UserPlan[]) => void,
  onError: (message: string) => void
): Unsubscribe {
  const plansQuery = query(
    collection(db, 'userPlans'),
    where('uid', '==', uid),
    limit(50)
  );

  return onSnapshot(
    plansQuery,
    (snapshot) => {
      const items: UserPlan[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          userPlanId: String(data.userPlanId || docSnap.id),
          uid: String(data.uid || uid),
          userId: String(data.userId || ''),
          planId: String(data.planId || ''),
          productName: String(data.productName || 'Structured Plan'),
          imageUrl: String(data.imageUrl || ''),
          coinCost: Number(data.coinCost || 0),
          durationDays: Number(data.durationDays || 1),
          totalRewardEntitlement: Number(data.totalRewardEntitlement || 0),
          collectedReward: Number(data.collectedReward || 0),
          remainingReward: Number(data.remainingReward || 0),
          daysCompleted: Number(data.daysCompleted || 0),
          remainingDays: Number(data.remainingDays || 0),
          startDate: normalizeTimestamp(data.startDate),
          endDate: normalizeTimestamp(data.endDate),
          nextRewardEligibilityTime: data.nextRewardEligibilityTime
            ? normalizeTimestamp(data.nextRewardEligibilityTime)
            : null,
          status: normalizePlanStatus(data.status),
          createdAt: normalizeTimestamp(data.createdAt),
        };
      });
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'userPlans');
      } catch {
        onError('Unable to load active plan reward progress. Please check permissions or retry.');
      }
    }
  );
}

export function subscribeUserDailyRewards(
  uid: string,
  onData: (rewards: DailyRewardRecord[]) => void,
  onError: (message: string) => void
): Unsubscribe {
  const rewardsQuery = query(
    collection(db, 'dailyRewards'),
    where('uid', '==', uid),
    limit(150)
  );

  return onSnapshot(
    rewardsQuery,
    (snapshot) => {
      const items: DailyRewardRecord[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          rewardId: String(data.rewardId || docSnap.id),
          userPlanId: String(data.userPlanId || ''),
          uid: String(data.uid || uid),
          userId: String(data.userId || ''),
          rewardDayNumber: Number(data.rewardDayNumber || 0),
          coinsCredited: Number(data.coinsCredited || 0),
          scheduledFor: normalizeTimestamp(data.scheduledFor),
          creditedAt: normalizeTimestamp(data.creditedAt),
        };
      });
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'dailyRewards');
      } catch {
        onError('Unable to load daily reward records. Please check permissions or retry.');
      }
    }
  );
}
