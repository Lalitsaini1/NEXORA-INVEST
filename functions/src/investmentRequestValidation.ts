import { createHash } from 'node:crypto';

export interface BuiltInPlanSpec {
  planId: string;
  productName: string;
  imageUrl: string;
  planPriceInr: number;
  coinCost: number;
  durationDays: number;
  totalRewardEntitlement: number;
  isActive: boolean;
}

export const BUILT_IN_PLANS: Record<string, BuiltInPlanSpec> = {
  PLAN_LAPTOP_100: {
    planId: 'PLAN_LAPTOP_100',
    productName: 'Laptop Plan',
    imageUrl: '',
    planPriceInr: 100,
    coinCost: 100,
    durationDays: 7,
    totalRewardEntitlement: 188,
    isActive: true,
  },
  PLAN_MACHINERY_500: {
    planId: 'PLAN_MACHINERY_500',
    productName: 'Machinery Plan',
    imageUrl: '',
    planPriceInr: 500,
    coinCost: 500,
    durationDays: 14,
    totalRewardEntitlement: 650,
    isActive: true,
  },
  PLAN_SERVER_1000: {
    planId: 'PLAN_SERVER_1000',
    productName: 'Compute Node Plan',
    imageUrl: '',
    planPriceInr: 1000,
    coinCost: 1000,
    durationDays: 21,
    totalRewardEntitlement: 1320,
    isActive: true,
  },
  PLAN_ENERGY_5000: {
    planId: 'PLAN_ENERGY_5000',
    productName: 'Grid Storage Plan',
    imageUrl: '',
    planPriceInr: 5000,
    coinCost: 5000,
    durationDays: 30,
    totalRewardEntitlement: 6600,
    isActive: true,
  },
};

/**
 * Fields strictly owned and computed by the backend Cloud Function.
 * Any attempt by a client payload to set or override these triggers an immediate rejection.
 */
export const PROTECTED_SERVER_FIELDS = [
  'uid',
  'userId',
  'status',
  'paymentStatus',
  'coinCost',
  'planPriceInr',
  'durationDays',
  'totalRewardEntitlement',
  'collectedReward',
  'remainingReward',
  'daysCompleted',
  'remainingDays',
  'availableCoins',
  'purchasedCoins',
  'earnedCoins',
  'coinsUsedForPlans',
  'withdrawableBalanceInr',
  'activatedUserPlanId',
  'coinTransactionId',
  'verifiedByUid',
  'verifiedAt',
  'activatedAt',
  'failureReason',
  'productName',
  'startDate',
  'endDate',
  'nextRewardEligibilityTime',
] as const;

export function sanitizeIdentifier(raw: unknown): string {
  const val = String(raw || '').trim();
  if (!val || val.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(val)) {
    return '';
  }
  return val;
}

export function buildDeterministicLockId(
  prefix: 'req' | 'inv',
  uid: string,
  idempotencyKey: string
): string {
  const digest = createHash('sha256')
    .update(`${prefix}:${uid}:${idempotencyKey}`)
    .digest('hex')
    .slice(0, 48);
  return `${prefix}_${digest}`;
}

export function detectTamperedServerFields(
  rawPayload: unknown
): { ok: true } | { ok: false; field: string; message: string } {
  if (rawPayload === null || rawPayload === undefined) {
    return { ok: true };
  }
  if (typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return {
      ok: false,
      field: 'payload',
      message: 'Investment request payload must be a JSON object.',
    };
  }
  const record = rawPayload as Record<string, unknown>;
  for (const field of PROTECTED_SERVER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, field) && record[field] !== undefined) {
      return {
        ok: false,
        field,
        message: `Client-side override of server-controlled financial or status field "${field}" is not permitted.`,
      };
    }
  }
  return { ok: true };
}

export type PlanResolutionResult =
  | { ok: true; plan: BuiltInPlanSpec }
  | { ok: false; code: 'not-found' | 'failed-precondition'; message: string };

export function resolveAuthoritativePlanSpec(
  planId: string,
  livePlanData?: Record<string, unknown> | null
): PlanResolutionResult {
  const cleanPlanId = sanitizeIdentifier(planId);
  if (!cleanPlanId || cleanPlanId.length > 64) {
    return { ok: false, code: 'not-found', message: 'Selected investment plan was not found.' };
  }

  let plan: BuiltInPlanSpec;
  if (livePlanData) {
    const rawPrice = Number(livePlanData.planPriceInr);
    const rawCoins = Number(livePlanData.coinDeductionAmount);
    const rawDays = Number(livePlanData.durationDays);
    const rawReward = Number(livePlanData.totalCoinReward);

    if (
      !Number.isFinite(rawPrice) ||
      !Number.isInteger(rawPrice) ||
      rawPrice < 1 ||
      rawPrice > 100000000 ||
      !Number.isFinite(rawCoins) ||
      !Number.isInteger(rawCoins) ||
      rawCoins < 1 ||
      rawCoins > 100000000 ||
      !Number.isFinite(rawDays) ||
      !Number.isInteger(rawDays) ||
      rawDays < 1 ||
      rawDays > 365 ||
      !Number.isFinite(rawReward) ||
      !Number.isInteger(rawReward) ||
      rawReward < 0
    ) {
      return {
        ok: false,
        code: 'failed-precondition',
        message: 'Published plan configuration contains invalid financial terms.',
      };
    }

    plan = {
      planId: String(livePlanData.planId || cleanPlanId),
      productName: String(livePlanData.productName || 'Structured Plan').trim().slice(0, 120),
      imageUrl: String(livePlanData.imageUrl || '').slice(0, 500),
      planPriceInr: rawPrice,
      coinCost: rawCoins,
      durationDays: rawDays,
      totalRewardEntitlement: rawReward,
      isActive: Boolean(livePlanData.isActive),
    };
  } else if (BUILT_IN_PLANS[cleanPlanId]) {
    plan = BUILT_IN_PLANS[cleanPlanId];
  } else {
    return { ok: false, code: 'not-found', message: 'Selected investment plan was not found.' };
  }

  if (!plan.isActive) {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'This investment plan is currently paused by administration.',
    };
  }

  return { ok: true, plan };
}

export type RequestInputValidationResult =
  | { ok: true }
  | { ok: false; message: string };

export function validatePlanAmountsMatch(params: {
  plan: BuiltInPlanSpec;
  expectedPlanPriceInr?: unknown;
  expectedCoinCost?: unknown;
}): RequestInputValidationResult {
  if (params.expectedPlanPriceInr !== undefined && params.expectedPlanPriceInr !== null) {
    const price = Number(params.expectedPlanPriceInr);
    if (!Number.isInteger(price) || price !== params.plan.planPriceInr) {
      return {
        ok: false,
        message: 'Plan price mismatch detected. Refresh the catalog and confirm current plan terms.',
      };
    }
  }

  if (params.expectedCoinCost !== undefined && params.expectedCoinCost !== null) {
    const cost = Number(params.expectedCoinCost);
    if (!Number.isInteger(cost) || cost !== params.plan.coinCost) {
      return {
        ok: false,
        message: 'Plan coin allocation mismatch detected. Refresh the catalog and try again.',
      };
    }
  }

  return { ok: true };
}

export interface PendingInvestmentRequestDoc {
  requestId: string;
  uid: string;
  userId: string;
  planId: string;
  productName: string;
  planPriceInr: number;
  coinCost: number;
  durationDays: number;
  totalRewardEntitlement: number;
  acceptedTerms: true;
  idempotencyKey: string;
  status: 'PENDING_VERIFICATION';
  paymentStatus: 'PENDING';
}

export function buildPendingInvestmentRequestDoc(params: {
  requestId: string;
  uid: string;
  userId: string;
  plan: BuiltInPlanSpec;
  idempotencyKey: string;
}): PendingInvestmentRequestDoc {
  return {
    requestId: params.requestId,
    uid: params.uid,
    userId: params.userId,
    planId: params.plan.planId,
    productName: params.plan.productName.slice(0, 120),
    planPriceInr: params.plan.planPriceInr,
    coinCost: params.plan.coinCost,
    durationDays: params.plan.durationDays,
    totalRewardEntitlement: params.plan.totalRewardEntitlement,
    acceptedTerms: true,
    idempotencyKey: params.idempotencyKey,
    // Strictly server-controlled pending states; browser cannot approve or activate.
    status: 'PENDING_VERIFICATION',
    paymentStatus: 'PENDING',
  };
}
