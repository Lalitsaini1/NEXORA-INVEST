import {
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  Unsubscribe,
} from 'firebase/firestore';
import { ILLUSTRATIVE_PLANS } from '../data/catalogPreview';
import { OperationType, db, handleFirestoreError } from '../firebase/client';
import { ProductPlan, UserPlan } from '../types/domain';
import { evaluatePlanInvestmentEligibility } from '../utils/planInvestment';

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

export function subscribePublicProductPlans(
  onData: (plans: ProductPlan[]) => void,
  onError?: (msg: string) => void
): Unsubscribe {
  const q = query(collection(db, 'productPlans'), limit(50));
  return onSnapshot(
    q,
    (snap) => {
      const items: ProductPlan[] = snap.docs
        .map((docSnap) => {
          const data = docSnap.data();
          return {
            planId: String(data.planId || docSnap.id),
            productName: String(data.productName || ''),
            category: String(data.category || ''),
            imageUrl: String(data.imageUrl || ''),
            displayedValueInr: Number(data.displayedValueInr || 0),
            planPriceInr: Number(data.planPriceInr || 0),
            coinDeductionAmount: Number(data.coinDeductionAmount || 0),
            durationDays: Number(data.durationDays || 1),
            totalCoinReward: Number(data.totalCoinReward || 0),
            dailyCoinRewardPreview: Number(data.dailyCoinRewardPreview || 0),
            tierName: data.tierName ? String(data.tierName) : undefined,
            minCoins: typeof data.minCoins === 'number' ? data.minCoins : undefined,
            maxCoins: typeof data.maxCoins === 'number' ? data.maxCoins : undefined,
            dailyRewardPercent:
              typeof data.dailyRewardPercent === 'number'
                ? data.dailyRewardPercent
                : undefined,
            description: String(data.description || ''),
            termsAndConditions: String(data.termsAndConditions || ''),
            isActive: Boolean(data.isActive),
            isIllustrativePreview: false,
            createdAt: toIso(data.createdAt),
            updatedAt: toIso(data.updatedAt),
          };
        })
        .sort((a, b) => a.planPriceInr - b.planPriceInr);
      onData(items);
    },
    (err) => {
      if (onError) {
        try {
          handleFirestoreError(err, OperationType.LIST, 'productPlans');
        } catch {
          onError('Unable to load live product plans.');
        }
      }
    }
  );
}

/**
 * Atomically enrolls an authenticated, ACTIVE member into a product plan after
 * verifying sufficient available virtual coin balance, deducting coins from
 * coinWallets, creating an ACTIVE UserPlan document, and appending an immutable
 * PLAN_INVESTMENT ledger record + user activity log entry.
 */
export async function investInProductPlan(params: {
  uid: string;
  userId: string;
  plan: ProductPlan;
  acceptedTerms: boolean;
  idempotencyKey?: string;
}): Promise<{ userPlan: UserPlan; coinTransactionId: string; newAvailableCoins: number }> {
  const cleanUid = params.uid.trim();
  const cleanUserId = params.userId.trim();
  if (!cleanUid || !/^NX[0-9]{6,10}$/.test(cleanUserId)) {
    throw new Error('Verified NEXORA User ID is required before activating an investment plan.');
  }
  if (!params.acceptedTerms) {
    throw new Error('Please accept the Plan Terms and Conditions before confirming.');
  }

  const userPlanId = createId('uplan');
  const coinTxId = `ptx_${userPlanId}`;
  const activityLogId = createId('ulog');
  const idempotencyKey = (params.idempotencyKey || `${cleanUid}_${userPlanId}`).slice(0, 128);

  const userRef = doc(db, 'users', cleanUid);
  const walletRef = doc(db, 'coinWallets', cleanUid);
  const productPlanRef = doc(db, 'productPlans', params.plan.planId);
  const userPlanRef = doc(db, 'userPlans', userPlanId);
  const txRef = doc(db, 'coinTransactions', coinTxId);
  const activityRef = doc(db, 'userActivityLogs', activityLogId);

  try {
    const result = await runTransaction(db, async (tx) => {
      const [userSnap, walletSnap, livePlanSnap, existingUserPlanSnap, existingTxSnap] =
        await Promise.all([
          tx.get(userRef),
          tx.get(walletRef),
          tx.get(productPlanRef),
          tx.get(userPlanRef),
          tx.get(txRef),
        ]);

      if (!userSnap.exists()) {
        throw new Error('Verified member profile not found.');
      }
      if (userSnap.data().status !== 'ACTIVE') {
        throw new Error('Only active member accounts can activate structured investment plans.');
      }
      if (!walletSnap.exists()) {
        throw new Error('Your wallet record is still initializing. Please try again shortly.');
      }
      if (existingUserPlanSnap.exists() || existingTxSnap.exists()) {
        throw new Error('Duplicate investment request detected. Please try again.');
      }

      // Resolve authoritative plan terms from Firestore if published, otherwise built-in catalog spec
      let authoritativePlan: ProductPlan;
      if (livePlanSnap.exists()) {
        const pd = livePlanSnap.data();
        authoritativePlan = {
          ...params.plan,
          planId: String(pd.planId || params.plan.planId),
          productName: String(pd.productName || params.plan.productName),
          imageUrl: String(pd.imageUrl || params.plan.imageUrl || ''),
          coinDeductionAmount: Math.round(Number(pd.coinDeductionAmount || 0)),
          planPriceInr: Math.round(Number(pd.planPriceInr || 0)),
          durationDays: Math.round(Number(pd.durationDays || 1)),
          totalCoinReward: Math.round(Number(pd.totalCoinReward || 0)),
          termsAndConditions: String(pd.termsAndConditions || params.plan.termsAndConditions || ''),
          isActive: Boolean(pd.isActive),
        };
      } else {
        const builtIn = ILLUSTRATIVE_PLANS.find((p) => p.planId === params.plan.planId);
        if (!builtIn) {
          throw new Error('Selected investment plan is unavailable.');
        }
        authoritativePlan = builtIn;
      }

      const prevAvailable = Math.max(0, Math.round(Number(walletSnap.data().availableCoins || 0)));
      const prevUsed = Math.max(0, Math.round(Number(walletSnap.data().coinsUsedForPlans || 0)));

      const eligibility = evaluatePlanInvestmentEligibility({
        plan: authoritativePlan,
        availableCoins: prevAvailable,
        accountStatus: String(userSnap.data().status),
        acceptedTerms: params.acceptedTerms,
      });

      if (!eligibility.eligible) {
        throw new Error(eligibility.reason || 'Plan investment validation failed.');
      }

      const coinCost = eligibility.requiredCoins;
      const nextAvailable = prevAvailable - coinCost;
      const nextUsed = prevUsed + coinCost;
      const totalReward = Math.max(0, Math.round(authoritativePlan.totalCoinReward));
      const durationDays = Math.max(1, Math.round(authoritativePlan.durationDays));

      const nowMs = Date.now();
      const startIso = new Date(nowMs).toISOString();
      const endIso = new Date(nowMs + durationDays * 24 * 60 * 60 * 1000).toISOString();
      const nextRewardIso = new Date(nowMs + 24 * 60 * 60 * 1000).toISOString();

      tx.update(walletRef, {
        availableCoins: nextAvailable,
        coinsUsedForPlans: nextUsed,
        lastPlanRef: userPlanId,
        updatedAt: serverTimestamp(),
      });

      const userPlanPayload = {
        userPlanId,
        uid: cleanUid,
        userId: cleanUserId,
        planId: authoritativePlan.planId,
        productName: authoritativePlan.productName.slice(0, 120),
        imageUrl: (authoritativePlan.imageUrl || '').slice(0, 500),
        coinCost,
        durationDays,
        totalRewardEntitlement: totalReward,
        collectedReward: 0,
        remainingReward: totalReward,
        daysCompleted: 0,
        remainingDays: durationDays,
        startDate: startIso,
        endDate: endIso,
        nextRewardEligibilityTime: nextRewardIso,
        status: 'ACTIVE' as const,
        createdAt: serverTimestamp(),
      };

      tx.set(userPlanRef, userPlanPayload);

      tx.set(txRef, {
        transactionId: coinTxId,
        uid: cleanUid,
        userId: cleanUserId,
        type: 'PLAN_INVESTMENT',
        assetType: 'COINS',
        amount: -coinCost,
        previousBalance: prevAvailable,
        newBalance: nextAvailable,
        referenceId: userPlanId,
        idempotencyKey,
        status: 'COMPLETED',
        description: `Activated ${authoritativePlan.productName} (${durationDays}d · ${coinCost} Coins)`.slice(
          0,
          300
        ),
        createdAt: serverTimestamp(),
      });

      tx.set(activityRef, {
        logId: activityLogId,
        uid: cleanUid,
        category: 'PLAN_CHANGE',
        action: 'PLAN_ACTIVATED',
        details: `Activated ${authoritativePlan.productName} (${authoritativePlan.planId}) with ${coinCost} Coins for ${durationDays} days -> ref ${userPlanId}`.slice(
          0,
          300
        ),
        createdAt: serverTimestamp(),
      });

      return {
        userPlan: {
          ...userPlanPayload,
          createdAt: startIso,
        } as UserPlan,
        coinTransactionId: coinTxId,
        newAvailableCoins: nextAvailable,
      };
    });

    return result;
  } catch (err) {
    if (err instanceof Error && !err.message.includes('PERMISSION_DENIED')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `userPlans/${userPlanId}`);
  }
}
