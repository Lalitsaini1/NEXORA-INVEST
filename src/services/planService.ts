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
import { InvestmentStageError } from '../utils/planErrorFormatter';
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

interface CreateInvestmentRequestCallableResponse {
  requestId: string;
  investmentRequest: InvestmentRequest;
  deduplicated?: boolean;
}

interface InvestInPlanCallableResponse {
  userPlan: UserPlan;
  coinTransactionId: string;
  newAvailableCoins: number;
  requestId: string;
  deduplicated?: boolean;
}

function getFirebaseErrorCode(err: unknown): string {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : '';
}

/**
 * Securely creates a backend-governed `investmentRequests/{requestId}` document via the
 * `createInvestmentRequest` Cloud Function (falling back to rule-validated client
 * PENDING_VERIFICATION creation only if Cloud Functions are not yet deployed), verifies the
 * request record in Firestore, and invokes `investInPlan` to validate coin balance and
 * activate the UserPlan record exclusively on the server.
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
  verifiedInFirestore: boolean;
  creationMode: 'CLOUD_FUNCTION' | 'FIRESTORE_RULES_FALLBACK';
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

  let requestId = createId('invreq');
  const rawKey = params.idempotencyKey || `${cleanUid}_${requestId}`;
  const idempotencyKey =
    rawKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128) || `${cleanUid}_${requestId}`;

  const expectedPlanPriceInr = Math.max(1, Math.round(authoritativePlan.planPriceInr));
  const expectedCoinCost = Math.max(1, Math.round(authoritativePlan.coinDeductionAmount));

  // Primary path: unified server-controlled `processInvestmentRequest` Cloud Function
  // Sends only plan selection, terms acceptance, idempotency key, and display expectations.
  // Never sends financial overrides (coinCost, totalRewardEntitlement, status, uid, wallet).
  try {
    const processFn = httpsCallable<
      {
        planId: string;
        acceptedTerms: boolean;
        idempotencyKey: string;
        expectedPlanPriceInr: number;
        expectedCoinCost: number;
      },
      InvestInPlanCallableResponse
    >(functions, 'processInvestmentRequest');

    const response = await processFn({
      planId: authoritativePlan.planId,
      acceptedTerms: true,
      idempotencyKey,
      expectedPlanPriceInr,
      expectedCoinCost,
    });

    if (!response.data || !response.data.userPlan) {
      throw new InvestmentStageError(
        'Unexpected response from backend investment processing service.',
        { savedAsPending: false, creationMode: 'CLOUD_FUNCTION' }
      );
    }

    const finalRequestId = response.data.requestId || requestId;
    let verifiedInFirestore = false;
    try {
      const checkSnap = await getDoc(doc(db, 'investmentRequests', finalRequestId));
      verifiedInFirestore = checkSnap.exists();
    } catch {
      verifiedInFirestore = false;
    }

    return {
      userPlan: response.data.userPlan,
      coinTransactionId: response.data.coinTransactionId,
      newAvailableCoins: Number(response.data.newAvailableCoins || 0),
      requestId: finalRequestId,
      verifiedInFirestore,
      creationMode: 'CLOUD_FUNCTION',
    };
  } catch (processErr) {
    const fnCode = getFirebaseErrorCode(processErr);
    const functionsUnavailable =
      fnCode === 'functions/not-found' ||
      fnCode === 'functions/unavailable' ||
      fnCode === 'functions/unimplemented';

    if (!functionsUnavailable) {
      if (processErr instanceof InvestmentStageError) {
        throw processErr;
      }
      throw new InvestmentStageError(
        processErr instanceof Error
          ? processErr.message
          : 'Unable to validate and process investment request on the backend.',
        { code: fnCode, savedAsPending: false, creationMode: 'CLOUD_FUNCTION' }
      );
    }
  }

  let creationMode: 'CLOUD_FUNCTION' | 'FIRESTORE_RULES_FALLBACK' = 'CLOUD_FUNCTION';

  // Legacy/Split Fallback Step 1: `createInvestmentRequest` or rule-validated `PENDING_VERIFICATION` write
  try {
    const createReqFn = httpsCallable<
      {
        planId: string;
        acceptedTerms: boolean;
        idempotencyKey: string;
        expectedPlanPriceInr: number;
        expectedCoinCost: number;
      },
      CreateInvestmentRequestCallableResponse
    >(functions, 'createInvestmentRequest');

    const createdResp = await createReqFn({
      planId: authoritativePlan.planId,
      acceptedTerms: true,
      idempotencyKey,
      expectedPlanPriceInr,
      expectedCoinCost,
    });

    if (createdResp.data?.requestId) {
      requestId = createdResp.data.requestId;
    }
  } catch (createFnErr) {
    const fnCode = getFirebaseErrorCode(createFnErr);
    const functionsUnavailable =
      fnCode === 'functions/not-found' ||
      fnCode === 'functions/unavailable' ||
      fnCode === 'functions/unimplemented';

    if (!functionsUnavailable) {
      throw new InvestmentStageError(
        createFnErr instanceof Error
          ? createFnErr.message
          : 'Unable to create verified investment request on the server.',
        { code: fnCode, savedAsPending: false }
      );
    }

    // Fallback when Cloud Function is not yet deployed: strict rule-validated client write
    // (PENDING_VERIFICATION / PENDING only; zero balance or activation mutation allowed).
    creationMode = 'FIRESTORE_RULES_FALLBACK';
    const reqRef = doc(db, 'investmentRequests', requestId);
    try {
      await setDoc(reqRef, {
        requestId,
        uid: cleanUid,
        userId: cleanUserId,
        planId: authoritativePlan.planId,
        productName: authoritativePlan.productName.slice(0, 120),
        planPriceInr: expectedPlanPriceInr,
        coinCost: expectedCoinCost,
        durationDays: Math.max(1, Math.round(authoritativePlan.durationDays)),
        totalRewardEntitlement: Math.max(0, Math.round(authoritativePlan.totalCoinReward)),
        acceptedTerms: true,
        idempotencyKey,
        status: 'PENDING_VERIFICATION',
        paymentStatus: 'PENDING',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (writeErr) {
      handleFirestoreError(writeErr, OperationType.WRITE, `investmentRequests/${requestId}`);
    }
  }

  // Verify the persisted investment request exists in Firestore
  let verifiedInFirestore = false;
  try {
    const checkSnap = await getDoc(doc(db, 'investmentRequests', requestId));
    verifiedInFirestore = checkSnap.exists();
  } catch {
    verifiedInFirestore = false;
  }

  // Activate exclusively through backend Cloud Function `investInPlan`
  try {
    const investFn = httpsCallable<
      {
        requestId: string;
        planId: string;
        acceptedTerms: boolean;
        idempotencyKey: string;
        expectedPlanPriceInr: number;
        expectedCoinCost: number;
      },
      InvestInPlanCallableResponse
    >(functions, 'investInPlan');

    const response = await investFn({
      requestId,
      planId: authoritativePlan.planId,
      acceptedTerms: true,
      idempotencyKey,
      expectedPlanPriceInr,
      expectedCoinCost,
    });

    if (!response.data || !response.data.userPlan) {
      throw new InvestmentStageError(
        'Unexpected response from backend investment verification service.',
        { requestId, savedAsPending: true, creationMode }
      );
    }

    return {
      userPlan: response.data.userPlan,
      coinTransactionId: response.data.coinTransactionId,
      newAvailableCoins: Number(response.data.newAvailableCoins || 0),
      requestId: response.data.requestId || requestId,
      verifiedInFirestore,
      creationMode,
    };
  } catch (err) {
    const code = getFirebaseErrorCode(err);

    if (
      code === 'functions/not-found' ||
      code === 'functions/unavailable' ||
      code === 'functions/unimplemented'
    ) {
      throw new InvestmentStageError(
        `Your investment request (${requestId}) was saved as PENDING_VERIFICATION, but the backend Cloud Functions ("processInvestmentRequest" / "investInPlan") are not deployed or unreachable on this Firebase project.`,
        { requestId, savedAsPending: true, code, creationMode }
      );
    }
    if (err instanceof InvestmentStageError) {
      throw err;
    }
    if (err instanceof Error && err.message) {
      throw new InvestmentStageError(err.message, {
        requestId,
        savedAsPending: true,
        code,
        creationMode,
      });
    }
    throw new InvestmentStageError(
      'Unable to complete backend investment verification. Please try again.',
      { requestId, savedAsPending: true, code, creationMode }
    );
  }
}

