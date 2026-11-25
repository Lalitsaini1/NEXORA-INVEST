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
import { isCloudFunctionUnreachableError } from '../utils/cloudFunctionErrorFormatter';
import {
  formatMemberPlanFunctionError,
  InvestmentStageError,
} from '../utils/planErrorFormatter';
import {
  computePlanEconomics,
  evaluatePlanInvestmentEligibility,
} from '../utils/planInvestment';
import { attemptLoggedInvestmentRequestWrite } from './investmentDiagnosticService';

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
          const planPriceInr = Math.max(1, Number(data.planPriceInr || 1));
          const coinDeductionAmount = Math.max(1, Number(data.coinDeductionAmount || planPriceInr));
          const durationDays = Math.max(1, Number(data.durationDays || 1));
          const totalCoinReward = Math.max(0, Number(data.totalCoinReward || 0));
          const derivedExpectedPct =
            Math.max(0, Math.round(((totalCoinReward - planPriceInr) / planPriceInr) * 10000) / 100);
          return {
            planId: String(data.planId || docSnap.id),
            productName: String(data.productName || ''),
            category: String(data.category || ''),
            imageUrl: String(data.imageUrl || ''),
            displayedValueInr: Number(data.displayedValueInr || 0),
            planPriceInr,
            coinDeductionAmount,
            durationDays,
            totalCoinReward,
            dailyCoinRewardPreview: Number(data.dailyCoinRewardPreview || 0),
            tierName: data.tierName ? String(data.tierName) : undefined,
            minCoins: typeof data.minCoins === 'number' ? data.minCoins : undefined,
            maxCoins: typeof data.maxCoins === 'number' ? data.maxCoins : undefined,
            expectedReturnPercent:
              typeof data.expectedReturnPercent === 'number'
                ? data.expectedReturnPercent
                : derivedExpectedPct,
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
  investmentAmountInr?: number;
  complianceApproved?: boolean;
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
  if (params.complianceApproved === false) {
    throw new Error(
      'Real-money investments are currently disabled until legal and payment-provider compliance checks are completed.'
    );
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
        minCoins: typeof pd.minCoins === 'number' ? pd.minCoins : undefined,
        maxCoins: typeof pd.maxCoins === 'number' ? pd.maxCoins : undefined,
        durationDays: Math.max(1, Math.round(Number(pd.durationDays || 1))),
        totalCoinReward: Math.max(0, Math.round(Number(pd.totalCoinReward || 0))),
        expectedReturnPercent:
          typeof pd.expectedReturnPercent === 'number' ? pd.expectedReturnPercent : undefined,
        dailyRewardPercent:
          typeof pd.dailyRewardPercent === 'number' ? pd.dailyRewardPercent : undefined,
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

  const economics = computePlanEconomics({
    plan: authoritativePlan,
    investmentAmountInr: params.investmentAmountInr,
  });

  const eligibility = evaluatePlanInvestmentEligibility({
    plan: authoritativePlan,
    availableCoins: economics.investmentAmountInr,
    accountStatus: 'ACTIVE',
    acceptedTerms: params.acceptedTerms,
    investmentAmountInr: params.investmentAmountInr ?? economics.investmentAmountInr,
    complianceApproved: params.complianceApproved,
  });
  if (!eligibility.eligible) {
    throw new Error(eligibility.reason || 'Selected investment plan is currently unavailable.');
  }

  let requestId = createId('invreq');
  const rawKey = params.idempotencyKey || `${cleanUid}_${requestId}`;
  const idempotencyKey =
    rawKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128) || `${cleanUid}_${requestId}`;

  const expectedPlanPriceInr = economics.investmentAmountInr;
  const expectedCoinCost = economics.coinCost;
  const expectedTotalReward = economics.estimatedTotalPayoutInr;

  let creationMode: 'CLOUD_FUNCTION' | 'FIRESTORE_RULES_FALLBACK' = 'CLOUD_FUNCTION';

  // Step 1: Create PENDING_VERIFICATION request via `createInvestmentRequest` Cloud Function
  // (falls back to rule-validated client write only if Cloud Function is not deployed/reachable).
  try {
    const createReqFn = httpsCallable<
      {
        planId: string;
        acceptedTerms: boolean;
        idempotencyKey: string;
        investmentAmountInr: number;
        expectedPlanPriceInr: number;
        expectedCoinCost: number;
      },
      CreateInvestmentRequestCallableResponse
    >(functions, 'createInvestmentRequest');

    const createdResp = await createReqFn({
      planId: authoritativePlan.planId,
      acceptedTerms: true,
      idempotencyKey,
      investmentAmountInr: expectedPlanPriceInr,
      expectedPlanPriceInr,
      expectedCoinCost,
    });

    if (createdResp.data?.requestId) {
      requestId = createdResp.data.requestId;
    }
  } catch (createFnErr) {
    const fnCode = getFirebaseErrorCode(createFnErr);
    const functionsUnavailable = isCloudFunctionUnreachableError(createFnErr);

    if (!functionsUnavailable) {
      throw new InvestmentStageError(
        formatMemberPlanFunctionError(
          createFnErr,
          'Unable to create verified investment request on the server.'
        ),
        { code: fnCode, savedAsPending: false, creationMode: 'CLOUD_FUNCTION' }
      );
    }

    // Fallback when Cloud Function is not yet deployed: strict rule-validated client write
    // (PENDING_VERIFICATION / PENDING only; zero balance or activation mutation allowed).
    creationMode = 'FIRESTORE_RULES_FALLBACK';
    const reqRef = doc(db, 'investmentRequests', requestId);
    const fallbackPayload: Record<string, unknown> = {
      requestId,
      uid: cleanUid,
      userId: cleanUserId,
      planId: authoritativePlan.planId,
      productName: authoritativePlan.productName.slice(0, 120),
      planPriceInr: expectedPlanPriceInr,
      coinCost: expectedCoinCost,
      durationDays: economics.durationDays,
      totalRewardEntitlement: expectedTotalReward,
      acceptedTerms: true,
      idempotencyKey,
      status: 'PENDING_VERIFICATION',
      paymentStatus: 'PENDING',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    try {
      await attemptLoggedInvestmentRequestWrite({
        operation: 'create',
        requestId,
        payload: fallbackPayload,
        uid: cleanUid,
        planId: authoritativePlan.planId,
        executeWrite: () => setDoc(reqRef, fallbackPayload),
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

  // Step 2: Activate exclusively through backend Cloud Function `investInPlan`
  // (falling back to `processInvestmentRequest` only if `investInPlan` is unreachable).
  try {
    const investFn = httpsCallable<
      {
        requestId: string;
        planId: string;
        acceptedTerms: boolean;
        idempotencyKey: string;
        investmentAmountInr: number;
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
      investmentAmountInr: expectedPlanPriceInr,
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

    if (isCloudFunctionUnreachableError(err)) {
      try {
        const processFn = httpsCallable<
          {
            requestId: string;
            planId: string;
            acceptedTerms: boolean;
            idempotencyKey: string;
            investmentAmountInr: number;
            expectedPlanPriceInr: number;
            expectedCoinCost: number;
          },
          InvestInPlanCallableResponse
        >(functions, 'processInvestmentRequest');

        const processResp = await processFn({
          requestId,
          planId: authoritativePlan.planId,
          acceptedTerms: true,
          idempotencyKey,
          investmentAmountInr: expectedPlanPriceInr,
          expectedPlanPriceInr,
          expectedCoinCost,
        });

        if (processResp.data?.userPlan) {
          return {
            userPlan: processResp.data.userPlan,
            coinTransactionId: processResp.data.coinTransactionId,
            newAvailableCoins: Number(processResp.data.newAvailableCoins || 0),
            requestId: processResp.data.requestId || requestId,
            verifiedInFirestore,
            creationMode,
          };
        }
      } catch (processFallbackErr) {
        if (!isCloudFunctionUnreachableError(processFallbackErr)) {
          throw new InvestmentStageError(
            formatMemberPlanFunctionError(
              processFallbackErr,
              'Unable to complete backend investment verification. Please try again.'
            ),
            { requestId, savedAsPending: true, code: getFirebaseErrorCode(processFallbackErr), creationMode }
          );
        }
      }

      throw new InvestmentStageError(
        `Your investment request (${requestId}) was saved as PENDING_VERIFICATION, but the backend Cloud Functions ("createInvestmentRequest" / "investInPlan") are not deployed or unreachable on this Firebase project.`,
        { requestId, savedAsPending: true, code, creationMode }
      );
    }
    if (err instanceof InvestmentStageError) {
      throw err;
    }
    throw new InvestmentStageError(
      formatMemberPlanFunctionError(
        err,
        'Unable to complete backend investment verification. Please try again.'
      ),
      { requestId, savedAsPending: true, code, creationMode }
    );
  }
}

