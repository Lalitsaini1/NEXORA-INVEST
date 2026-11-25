"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROTECTED_SERVER_FIELDS = exports.BUILT_IN_PLANS = void 0;
exports.sanitizeIdentifier = sanitizeIdentifier;
exports.buildDeterministicLockId = buildDeterministicLockId;
exports.detectTamperedServerFields = detectTamperedServerFields;
exports.evaluateServerComplianceGate = evaluateServerComplianceGate;
exports.resolveAuthoritativePlanSpec = resolveAuthoritativePlanSpec;
exports.validatePlanAmountsMatch = validatePlanAmountsMatch;
exports.buildPendingInvestmentRequestDoc = buildPendingInvestmentRequestDoc;
const node_crypto_1 = require("node:crypto");
exports.BUILT_IN_PLANS = {
    PLAN_LAPTOP_100: {
        planId: 'PLAN_LAPTOP_100',
        productName: 'Laptop Plan',
        imageUrl: '',
        planPriceInr: 100,
        coinCost: 100,
        minInvestmentInr: 100,
        maxInvestmentInr: 100,
        durationDays: 7,
        expectedReturnPercent: 88,
        dailyRewardPercent: 12.57,
        totalRewardEntitlement: 188,
        isActive: true,
    },
    PLAN_MACHINERY_500: {
        planId: 'PLAN_MACHINERY_500',
        productName: 'Machinery Plan',
        imageUrl: '',
        planPriceInr: 500,
        coinCost: 500,
        minInvestmentInr: 500,
        maxInvestmentInr: 500,
        durationDays: 14,
        expectedReturnPercent: 30,
        dailyRewardPercent: 2.14,
        totalRewardEntitlement: 650,
        isActive: true,
    },
    PLAN_SERVER_1000: {
        planId: 'PLAN_SERVER_1000',
        productName: 'Compute Node Plan',
        imageUrl: '',
        planPriceInr: 1000,
        coinCost: 1000,
        minInvestmentInr: 1000,
        maxInvestmentInr: 1000,
        durationDays: 21,
        expectedReturnPercent: 32,
        dailyRewardPercent: 1.52,
        totalRewardEntitlement: 1320,
        isActive: true,
    },
    PLAN_ENERGY_5000: {
        planId: 'PLAN_ENERGY_5000',
        productName: 'Grid Storage Plan',
        imageUrl: '',
        planPriceInr: 5000,
        coinCost: 5000,
        minInvestmentInr: 5000,
        maxInvestmentInr: 5000,
        durationDays: 30,
        expectedReturnPercent: 32,
        dailyRewardPercent: 1.07,
        totalRewardEntitlement: 6600,
        isActive: true,
    },
};
/**
 * Fields strictly owned and computed by the backend Cloud Function.
 * Any attempt by a client payload to set or override these triggers an immediate rejection.
 */
exports.PROTECTED_SERVER_FIELDS = [
    'uid',
    'userId',
    'status',
    'paymentStatus',
    'coinCost',
    'planPriceInr',
    'durationDays',
    'totalRewardEntitlement',
    'expectedReturnPercent',
    'dailyRewardPercent',
    'dailyCoinRewardPreview',
    'dailyEarningsInr',
    'minCoins',
    'maxCoins',
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
];
function sanitizeIdentifier(raw) {
    const val = String(raw || '').trim();
    if (!val || val.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(val)) {
        return '';
    }
    return val;
}
function buildDeterministicLockId(prefix, uid, idempotencyKey) {
    const digest = (0, node_crypto_1.createHash)('sha256')
        .update(`${prefix}:${uid}:${idempotencyKey}`)
        .digest('hex')
        .slice(0, 48);
    return `${prefix}_${digest}`;
}
function detectTamperedServerFields(rawPayload) {
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
    const record = rawPayload;
    for (const field of exports.PROTECTED_SERVER_FIELDS) {
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
function evaluateServerComplianceGate(settingsData) {
    if (!settingsData ||
        settingsData.legalComplianceVerified !== true ||
        settingsData.paymentProviderComplianceVerified !== true ||
        settingsData.realMoneyInvestmentsEnabled !== true) {
        return {
            ok: false,
            message: 'Real-money investments are currently disabled until legal and payment-provider compliance checks are completed and verified.',
        };
    }
    return { ok: true };
}
function resolveAuthoritativePlanSpec(planId, livePlanData, requestedAmountInr) {
    const cleanPlanId = sanitizeIdentifier(planId);
    if (!cleanPlanId || cleanPlanId.length > 64) {
        return { ok: false, code: 'not-found', message: 'Selected investment plan was not found.' };
    }
    let basePlan;
    if (livePlanData) {
        const rawPrice = Number(livePlanData.planPriceInr);
        const rawCoins = Number(livePlanData.coinDeductionAmount);
        const rawDays = Number(livePlanData.durationDays);
        const rawReward = Number(livePlanData.totalCoinReward);
        const minInv = typeof livePlanData.minCoins === 'number' &&
            Number.isInteger(livePlanData.minCoins) &&
            livePlanData.minCoins >= 1
            ? livePlanData.minCoins
            : rawPrice;
        const maxInv = typeof livePlanData.maxCoins === 'number' &&
            Number.isInteger(livePlanData.maxCoins) &&
            livePlanData.maxCoins >= minInv
            ? livePlanData.maxCoins
            : Math.max(minInv, rawPrice);
        if (!Number.isFinite(rawPrice) ||
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
            rawReward < 0) {
            return {
                ok: false,
                code: 'failed-precondition',
                message: 'Published plan configuration contains invalid financial terms.',
            };
        }
        const expectedReturnPercent = typeof livePlanData.expectedReturnPercent === 'number' &&
            Number.isFinite(livePlanData.expectedReturnPercent)
            ? Math.max(0, Math.round(livePlanData.expectedReturnPercent * 100) / 100)
            : Math.max(0, Math.round(((rawReward - rawPrice) / rawPrice) * 10000) / 100);
        const dailyRewardPercent = typeof livePlanData.dailyRewardPercent === 'number' &&
            Number.isFinite(livePlanData.dailyRewardPercent)
            ? Math.max(0, Math.round(livePlanData.dailyRewardPercent * 100) / 100)
            : Math.round((expectedReturnPercent / rawDays) * 100) / 100;
        basePlan = {
            planId: String(livePlanData.planId || cleanPlanId),
            productName: String(livePlanData.productName || 'Structured Plan').trim().slice(0, 120),
            imageUrl: String(livePlanData.imageUrl || '').slice(0, 500),
            planPriceInr: rawPrice,
            coinCost: rawCoins,
            minInvestmentInr: minInv,
            maxInvestmentInr: maxInv,
            durationDays: rawDays,
            expectedReturnPercent,
            dailyRewardPercent,
            totalRewardEntitlement: rawReward,
            isActive: Boolean(livePlanData.isActive),
        };
    }
    else if (exports.BUILT_IN_PLANS[cleanPlanId]) {
        basePlan = exports.BUILT_IN_PLANS[cleanPlanId];
    }
    else {
        return { ok: false, code: 'not-found', message: 'Selected investment plan was not found.' };
    }
    if (!basePlan.isActive) {
        return {
            ok: false,
            code: 'failed-precondition',
            message: 'This investment plan is currently paused by administration.',
        };
    }
    let chosenAmountInr = basePlan.planPriceInr;
    if (requestedAmountInr !== undefined && requestedAmountInr !== null) {
        const parsed = Number(requestedAmountInr);
        if (!Number.isFinite(parsed) ||
            !Number.isInteger(parsed) ||
            parsed < basePlan.minInvestmentInr ||
            parsed > basePlan.maxInvestmentInr) {
            return {
                ok: false,
                code: 'invalid-argument',
                message: `Investment amount must be an integer between ₹${basePlan.minInvestmentInr.toLocaleString('en-IN')} and ₹${basePlan.maxInvestmentInr.toLocaleString('en-IN')}.`,
            };
        }
        chosenAmountInr = parsed;
    }
    const authoritativeTotalReward = chosenAmountInr === basePlan.planPriceInr
        ? basePlan.totalRewardEntitlement
        : Math.max(0, Math.round(chosenAmountInr * (basePlan.totalRewardEntitlement / basePlan.planPriceInr)));
    return {
        ok: true,
        plan: {
            ...basePlan,
            planPriceInr: chosenAmountInr,
            coinCost: chosenAmountInr,
            totalRewardEntitlement: authoritativeTotalReward,
        },
    };
}
function validatePlanAmountsMatch(params) {
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
function buildPendingInvestmentRequestDoc(params) {
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
//# sourceMappingURL=investmentRequestValidation.js.map