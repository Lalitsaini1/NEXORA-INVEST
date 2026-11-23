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
import { httpsCallable } from 'firebase/functions';
import { ILLUSTRATIVE_PLANS } from '../data/catalogPreview';
import { OperationType, auth, db, functions, handleFirestoreError } from '../firebase/client';
import { InvestmentRequest, ProductPlan, UserPlan } from '../types/domain';
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

export function subscribeUserInvestmentRequests(
  uid: string,
  onData: (requests: InvestmentRequest[]) => void,
  onError?: (msg: string) => void
): Unsubscribe {
  const q = query(collection(db, 'investmentRequests'), where('uid', '==', uid), limit(50));
  return onSnapshot(
    q,
    (snap) => {
      const items: InvestmentRequest[] = snap.docs
        .map((docSnap) => {
          const data = docSnap.data();
          return {
            requestId: String(data.requestId || docSnap.id),
            uid: String(data.uid || uid),
            userId: String(data.userId || ''),
            planId: String(data.planId || ''),
            productName: String(data.productName || ''),
            planPriceInr: Number(data.planPriceInr || 0),
            coinCost: Number(data.coinCost || 0),
            durationDays: Number(data.durationDays || 1),
            totalRewardEntitlement: Number(data.totalRewardEntitlement || 0),
            acceptedTerms: Boolean(data.acceptedTerms),
            idempotencyKey: String(data.idempotencyKey || ''),
            status: (data.status as InvestmentRequest['status']) || 'PENDING_VERIFICATION',
            paymentStatus: (data.paymentStatus as InvestmentRequest['paymentStatus']) || 'PENDING',
            activatedUserPlanId: data.activatedUserPlanId
              ? String(data.activatedUserPlanId)
              : undefined,
            coinTransactionId: data.coinTransactionId
              ? String(data.coinTransactionId)
              : undefined,
            verifiedByUid: data.verifiedByUid ? String(data.verifiedByUid) : undefined,
            failureReason: data.failureReason ? String(data.failureReason) : undefined,
            createdAt: toIso(data.createdAt),
            updatedAt: toIso(data.updatedAt),
            activatedAt: data.activatedAt ? toIso(data.activatedAt) : undefined,
          };
        })
        .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
      onData(items);
    },
    (err) => {
      if (onError) {
        try {
          handleFirestoreError(err, OperationType.LIST, 'investmentRequests');
        } catch {
          onError('Unable to load your investment requests.');
        }
      }
    }
  );
}

interface InvestInPlanCallableResponse {
  userPlan: UserPlan;
  coinTransactionId: string;
  newAvailableCoins: number;
  requestId: string;
  deduplicated?: boolean;
}

/**
 * Verifies user authentication, records a permitted PENDING_VERIFICATION investment
 * request in Firestore, and invokes the backend Cloud Function `investInPlan` to
 * atomically verify verified wallet balance, enforce idempotency locks, debit coins,
 * and activate the UserPlan record.
 */
export async function investInProductPlan(params: {
  uid: string;
  userId: string;
  plan: ProductPlan;
  acceptedTerms: boolean;
  idempotencyKey?: string;
}): Promise<{
  userPlan: UserPlan;
  coinTransactionId: string;
  newAvailableCoins: number;
  requestId: string;
}> {
  const cleanUid = params.uid.trim();
  const cleanUserId = params.userId.trim();
  if (!auth.currentUser || auth.currentUser.uid !== cleanUid) {
    throw new Error('Active Firebase Authentication session required before investing.');
  }
  if (!cleanUid || !/^NX[0-9]{6,10}$/.test(cleanUserId)) {
    throw new Error('Verified NEXORA User ID is required before activating an investment plan.');
  }
  if (!params.acceptedTerms) {
    throw new Error('Please accept the Plan Terms and Conditions before confirming.');
  }

  // Resolve authoritative plan details from Firestore productPlans or built-in catalog
  let authoritativePlan: ProductPlan;
  try {
    const livePlanSnap = await getDoc(doc(db, 'productPlans', params.plan.planId));
    if (livePlanSnap.exists()) {
      const pd = livePlanSnap.data();
      authoritativePlan = {
        ...params.plan,
        planId: String(pd.planId || params.plan.planId),
        productName: String(pd.productName || params.plan.productName),
        imageUrl: String(pd.imageUrl || params.plan.imageUrl || ''),
        coinDeductionAmount: Math.max(1, Math.round(Number(pd.coinDeductionAmount || 0))),
        planPriceInr: Math.max(1, Math.round(Number(pd.planPriceInr || 0))),
        durationDays: Math.max(1, Math.round(Number(pd.durationDays || 1))),
        totalCoinReward: Math.max(0, Math.round(Number(pd.totalCoinReward || 0))),
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
  } catch (err) {
    if (err instanceof Error && err.message === 'Selected investment plan is unavailable.') {
      throw err;
    }
    const builtIn = ILLUSTRATIVE_PLANS.find((p) => p.planId === params.plan.planId);
    authoritativePlan = builtIn || params.plan;
  }

  const eligibility = evaluatePlanInvestmentEligibility({
    plan: authoritativePlan,
    availableCoins: Math.max(0, Math.round(authoritativePlan.coinDeductionAmount)),
    accountStatus: 'ACTIVE',
    acceptedTerms: params.acceptedTerms,
  });
  if (!eligibility.eligible) {
    throw new Error(eligibility.reason || 'Selected investment plan is currently unavailable.');
  }

  const requestId = createId('invreq');
  const rawKey = params.idempotencyKey || `${cleanUid}_${requestId}`;
  const idempotencyKey =
    rawKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128) || `${cleanUid}_${requestId}`;

  // Step 1: Create permitted PENDING_VERIFICATION request in Firestore
  const reqRef = doc(db, 'investmentRequests', requestId);
  try {
    await setDoc(reqRef, {
      requestId,
      uid: cleanUid,
      userId: cleanUserId,
      planId: authoritativePlan.planId,
      productName: authoritativePlan.productName.slice(0, 120),
      planPriceInr: Math.max(1, Math.round(authoritativePlan.planPriceInr)),
      coinCost: Math.max(1, Math.round(authoritativePlan.coinDeductionAmount)),
      durationDays: Math.max(1, Math.round(authoritativePlan.durationDays)),
      totalRewardEntitlement: Math.max(0, Math.round(authoritativePlan.totalCoinReward)),
      acceptedTerms: true,
      idempotencyKey,
      status: 'PENDING_VERIFICATION',
      paymentStatus: 'PENDING',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `investmentRequests/${requestId}`);
  }

  // Step 2: Verify balance & activate exclusively through backend Cloud Function `investInPlan`
  try {
    const investFn = httpsCallable<
      {
        requestId: string;
        planId: string;
        acceptedTerms: boolean;
        idempotencyKey: string;
      },
      InvestInPlanCallableResponse
    >(functions, 'investInPlan');

    const response = await investFn({
      requestId,
      planId: authoritativePlan.planId,
      acceptedTerms: true,
      idempotencyKey,
    });

    if (!response.data || !response.data.userPlan) {
      throw new Error('Unexpected response from backend investment verification service.');
    }

    return {
      userPlan: response.data.userPlan,
      coinTransactionId: response.data.coinTransactionId,
      newAvailableCoins: Number(response.data.newAvailableCoins || 0),
      requestId: response.data.requestId || requestId,
    };
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code: unknown }).code)
        : '';

    if (code === 'functions/not-found' || code === 'functions/unavailable') {
      throw new Error(
        `Your investment request (${requestId}) was securely saved as PENDING_VERIFICATION, but the backend Cloud Function "investInPlan" is not deployed or unreachable on this Firebase project.`
      );
    }
    if (err instanceof Error && err.message) {
      throw err;
    }
    throw new Error('Unable to complete backend investment verification. Please try again.');
  }
}

