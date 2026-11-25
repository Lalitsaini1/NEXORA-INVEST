import {
  InvestmentRequest,
  PlatformSettingsRecord,
  ProductPlan,
  UserPlan,
} from '../types/domain';
import { calculateDailyDistribution } from './formatters';

export interface PlanInvestmentEligibility {
  eligible: boolean;
  reason?: string;
  availableCoins: number;
  requiredCoins: number;
  shortfallCoins: number;
  postInvestmentCoins: number;
}

export interface PlanInvestmentEconomics {
  minInvestmentInr: number;
  maxInvestmentInr: number;
  investmentAmountInr: number;
  coinCost: number;
  durationDays: number;
  expectedReturnPercent: number;
  dailyRewardPercent: number;
  estimatedNetProfitInr: number;
  estimatedTotalPayoutInr: number;
  dailyEarningsInr: number;
  dailyPayoutMinCoins: number;
  dailyPayoutMaxCoins: number;
  dailyDistribution: number[];
}

export interface InvestmentComplianceStatus {
  allowed: boolean;
  legalComplianceVerified: boolean;
  paymentProviderComplianceVerified: boolean;
  realMoneyInvestmentsEnabled: boolean;
  reason: string;
  complianceStatusNote?: string;
}

export interface AdminPlanAnalytics {
  planId: string;
  totalInvestors: number;
  activeInvestors: number;
  activeInvestmentsCount: number;
  pendingRequestsCount: number;
  totalInvestmentAmountInr: number;
  activeInvestmentAmountInr: number;
}

export interface AdminPortfolioPlanSummary {
  totalPlans: number;
  activePlans: number;
  pausedPlans: number;
  totalInvestors: number;
  totalActiveInvestments: number;
  totalInvestmentAmountInr: number;
}

export function resolvePlanBounds(
  plan: Pick<ProductPlan, 'planPriceInr' | 'coinDeductionAmount' | 'minCoins' | 'maxCoins'>
): { minInvestmentInr: number; maxInvestmentInr: number } {
  const base = Math.max(1, Math.round(plan.planPriceInr || plan.coinDeductionAmount || 1));
  const minInvestmentInr =
    typeof plan.minCoins === 'number' && Number.isFinite(plan.minCoins) && plan.minCoins >= 1
      ? Math.round(plan.minCoins)
      : base;
  const maxInvestmentInr =
    typeof plan.maxCoins === 'number' &&
    Number.isFinite(plan.maxCoins) &&
    plan.maxCoins >= minInvestmentInr
      ? Math.round(plan.maxCoins)
      : Math.max(minInvestmentInr, base);
  return { minInvestmentInr, maxInvestmentInr };
}

export function computePlanEconomics(params: {
  plan: Pick<
    ProductPlan,
    | 'planPriceInr'
    | 'coinDeductionAmount'
    | 'durationDays'
    | 'totalCoinReward'
    | 'minCoins'
    | 'maxCoins'
    | 'dailyRewardPercent'
    | 'expectedReturnPercent'
  >;
  investmentAmountInr?: number;
}): PlanInvestmentEconomics {
  const { plan } = params;
  const { minInvestmentInr, maxInvestmentInr } = resolvePlanBounds(plan);
  const basePrice = Math.max(1, Math.round(plan.planPriceInr || plan.coinDeductionAmount || minInvestmentInr));
  const durationDays = Math.max(1, Math.min(365, Math.round(plan.durationDays || 1)));
  const baseTotalReward = Math.max(0, Math.round(plan.totalCoinReward || 0));

  const rawRequested =
    params.investmentAmountInr !== undefined && Number.isFinite(params.investmentAmountInr)
      ? Math.round(params.investmentAmountInr)
      : minInvestmentInr;
  const investmentAmountInr = Math.min(
    maxInvestmentInr,
    Math.max(minInvestmentInr, rawRequested)
  );

  const derivedExpectedReturnPct =
    typeof plan.expectedReturnPercent === 'number' && Number.isFinite(plan.expectedReturnPercent)
      ? Math.round(plan.expectedReturnPercent * 100) / 100
      : Math.round(((baseTotalReward - basePrice) / basePrice) * 10000) / 100;

  const expectedReturnPercent = Math.max(0, derivedExpectedReturnPct);
  const dailyRewardPercent =
    typeof plan.dailyRewardPercent === 'number' && Number.isFinite(plan.dailyRewardPercent)
      ? Math.round(plan.dailyRewardPercent * 100) / 100
      : Math.round((expectedReturnPercent / durationDays) * 100) / 100;

  const estimatedTotalPayoutInr =
    investmentAmountInr === basePrice
      ? baseTotalReward
      : Math.max(0, Math.round(investmentAmountInr * (baseTotalReward / basePrice)));

  const estimatedNetProfitInr = Math.max(0, estimatedTotalPayoutInr - investmentAmountInr);
  const dailyEarningsInr = Math.round((estimatedNetProfitInr / durationDays) * 100) / 100;
  const dailyDistribution = calculateDailyDistribution(estimatedTotalPayoutInr, durationDays);
  const dailyPayoutMinCoins = dailyDistribution.length ? Math.min(...dailyDistribution) : 0;
  const dailyPayoutMaxCoins = dailyDistribution.length ? Math.max(...dailyDistribution) : 0;

  return {
    minInvestmentInr,
    maxInvestmentInr,
    investmentAmountInr,
    coinCost: investmentAmountInr,
    durationDays,
    expectedReturnPercent,
    dailyRewardPercent,
    estimatedNetProfitInr,
    estimatedTotalPayoutInr,
    dailyEarningsInr,
    dailyPayoutMinCoins,
    dailyPayoutMaxCoins,
    dailyDistribution,
  };
}

export function evaluateInvestmentComplianceGate(
  settings?: Pick<
    PlatformSettingsRecord,
    | 'legalComplianceVerified'
    | 'paymentProviderComplianceVerified'
    | 'realMoneyInvestmentsEnabled'
    | 'complianceStatusNote'
  > | null
): InvestmentComplianceStatus {
  const legalComplianceVerified = settings?.legalComplianceVerified === true;
  const paymentProviderComplianceVerified = settings?.paymentProviderComplianceVerified === true;
  const realMoneyInvestmentsEnabled = settings?.realMoneyInvestmentsEnabled === true;

  if (!legalComplianceVerified || !paymentProviderComplianceVerified || !realMoneyInvestmentsEnabled) {
    const missing: string[] = [];
    if (!legalComplianceVerified) missing.push('legal & regulatory verification');
    if (!paymentProviderComplianceVerified) missing.push('payment-provider compliance');
    if (legalComplianceVerified && paymentProviderComplianceVerified && !realMoneyInvestmentsEnabled) {
      missing.push('Super Admin activation');
    }

    return {
      allowed: false,
      legalComplianceVerified,
      paymentProviderComplianceVerified,
      realMoneyInvestmentsEnabled,
      reason: `Real-money investments are currently disabled pending ${missing.join(' and ')}.`,
      complianceStatusNote: settings?.complianceStatusNote,
    };
  }

  return {
    allowed: true,
    legalComplianceVerified: true,
    paymentProviderComplianceVerified: true,
    realMoneyInvestmentsEnabled: true,
    reason: 'Legal and payment-provider compliance checks verified.',
    complianceStatusNote: settings?.complianceStatusNote,
  };
}

export function evaluatePlanInvestmentEligibility(params: {
  plan: ProductPlan;
  availableCoins: number;
  accountStatus?: string;
  acceptedTerms: boolean;
  investmentAmountInr?: number;
  complianceApproved?: boolean;
}): PlanInvestmentEligibility {
  const available = Math.max(0, Math.floor(Number(params.availableCoins || 0)));
  const { minInvestmentInr, maxInvestmentInr } = resolvePlanBounds(params.plan);

  const requestedRaw =
    params.investmentAmountInr !== undefined
      ? Number(params.investmentAmountInr)
      : Number(params.plan.coinDeductionAmount || minInvestmentInr);
  const requestedInt = Number.isFinite(requestedRaw) ? Math.floor(requestedRaw) : 0;
  const required = Math.max(1, requestedInt);
  const shortfall = Math.max(0, required - available);
  const postInvestment = Math.max(0, available - required);

  if (!params.plan.isActive) {
    return {
      eligible: false,
      reason: 'This investment plan is currently paused by administration.',
      availableCoins: available,
      requiredCoins: required,
      shortfallCoins: shortfall,
      postInvestmentCoins: postInvestment,
    };
  }

  if (params.complianceApproved === false) {
    return {
      eligible: false,
      reason:
        'Real-money investments are disabled until required legal and payment-provider compliance checks are complete.',
      availableCoins: available,
      requiredCoins: required,
      shortfallCoins: shortfall,
      postInvestmentCoins: postInvestment,
    };
  }

  if (
    params.investmentAmountInr !== undefined &&
    (!Number.isInteger(Number(params.investmentAmountInr)) ||
      Number(params.investmentAmountInr) < minInvestmentInr ||
      Number(params.investmentAmountInr) > maxInvestmentInr)
  ) {
    return {
      eligible: false,
      reason: `Investment amount must be a whole INR amount between ₹${minInvestmentInr.toLocaleString('en-IN')} and ₹${maxInvestmentInr.toLocaleString('en-IN')}.`,
      availableCoins: available,
      requiredCoins: required,
      shortfallCoins: shortfall,
      postInvestmentCoins: postInvestment,
    };
  }

  if (params.accountStatus && params.accountStatus !== 'ACTIVE') {
    return {
      eligible: false,
      reason: 'Your member account must be ACTIVE before enrolling in a plan.',
      availableCoins: available,
      requiredCoins: required,
      shortfallCoins: shortfall,
      postInvestmentCoins: postInvestment,
    };
  }

  if (shortfall > 0) {
    return {
      eligible: false,
      reason: `Insufficient verified coins. You need ${shortfall.toLocaleString('en-IN')} more Coins (₹${shortfall.toLocaleString('en-IN')}) via verified UPI payment.`,
      availableCoins: available,
      requiredCoins: required,
      shortfallCoins: shortfall,
      postInvestmentCoins: 0,
    };
  }

  if (!params.acceptedTerms) {
    return {
      eligible: false,
      reason: 'Please confirm that you accept the Plan Terms and Conditions.',
      availableCoins: available,
      requiredCoins: required,
      shortfallCoins: 0,
      postInvestmentCoins: postInvestment,
    };
  }

  return {
    eligible: true,
    availableCoins: available,
    requiredCoins: required,
    shortfallCoins: 0,
    postInvestmentCoins: postInvestment,
  };
}

export function canDeleteInvestmentPlan(params: {
  planId: string;
  userPlans: Pick<UserPlan, 'planId' | 'status'>[];
  investmentRequests?: Pick<InvestmentRequest, 'planId' | 'status'>[];
}): {
  canDelete: boolean;
  activeInvestmentsCount: number;
  pendingRequestsCount: number;
  reason?: string;
} {
  const activeInvestmentsCount = params.userPlans.filter(
    (up) => up.planId === params.planId && up.status === 'ACTIVE'
  ).length;
  const pendingRequestsCount = (params.investmentRequests || []).filter(
    (req) => req.planId === params.planId && req.status === 'PENDING_VERIFICATION'
  ).length;

  if (activeInvestmentsCount > 0 || pendingRequestsCount > 0) {
    return {
      canDelete: false,
      activeInvestmentsCount,
      pendingRequestsCount,
      reason: `Cannot delete this plan while ${activeInvestmentsCount} active investment(s) and ${pendingRequestsCount} pending request(s) exist. Deactivate the plan instead to stop new enrollments.`,
    };
  }

  return {
    canDelete: true,
    activeInvestmentsCount: 0,
    pendingRequestsCount: 0,
  };
}

export function aggregateAdminPlanAnalytics(params: {
  plans: ProductPlan[];
  userPlans: Pick<UserPlan, 'planId' | 'uid' | 'coinCost' | 'status'>[];
  investmentRequests?: Pick<InvestmentRequest, 'planId' | 'status'>[];
}): {
  byPlanId: Record<string, AdminPlanAnalytics>;
  summary: AdminPortfolioPlanSummary;
} {
  const byPlanId: Record<string, AdminPlanAnalytics> = {};
  const uniqueInvestorsOverall = new Set<string>();
  let totalActiveInvestments = 0;
  let totalInvestmentAmountInr = 0;

  for (const plan of params.plans) {
    byPlanId[plan.planId] = {
      planId: plan.planId,
      totalInvestors: 0,
      activeInvestors: 0,
      activeInvestmentsCount: 0,
      pendingRequestsCount: 0,
      totalInvestmentAmountInr: 0,
      activeInvestmentAmountInr: 0,
    };
  }

  const investorsPerPlan = new Map<string, Set<string>>();
  const activeInvestorsPerPlan = new Map<string, Set<string>>();

  for (const up of params.userPlans) {
    if (up.status === 'CANCELLED') continue;
    const cost = Math.max(0, Math.round(Number(up.coinCost || 0)));
    if (up.uid) {
      uniqueInvestorsOverall.add(up.uid);
    }
    totalInvestmentAmountInr += cost;
    if (up.status === 'ACTIVE') {
      totalActiveInvestments += 1;
    }

    if (!byPlanId[up.planId]) {
      byPlanId[up.planId] = {
        planId: up.planId,
        totalInvestors: 0,
        activeInvestors: 0,
        activeInvestmentsCount: 0,
        pendingRequestsCount: 0,
        totalInvestmentAmountInr: 0,
        activeInvestmentAmountInr: 0,
      };
    }

    const entry = byPlanId[up.planId];
    entry.totalInvestmentAmountInr += cost;

    let invSet = investorsPerPlan.get(up.planId);
    if (!invSet) {
      invSet = new Set<string>();
      investorsPerPlan.set(up.planId, invSet);
    }
    if (up.uid) invSet.add(up.uid);

    if (up.status === 'ACTIVE') {
      entry.activeInvestmentsCount += 1;
      entry.activeInvestmentAmountInr += cost;
      let activeSet = activeInvestorsPerPlan.get(up.planId);
      if (!activeSet) {
        activeSet = new Set<string>();
        activeInvestorsPerPlan.set(up.planId, activeSet);
      }
      if (up.uid) activeSet.add(up.uid);
    }
  }

  for (const req of params.investmentRequests || []) {
    if (req.status !== 'PENDING_VERIFICATION') continue;
    if (byPlanId[req.planId]) {
      byPlanId[req.planId].pendingRequestsCount += 1;
    }
  }

  for (const [planId, invSet] of investorsPerPlan.entries()) {
    if (byPlanId[planId]) {
      byPlanId[planId].totalInvestors = invSet.size;
    }
  }
  for (const [planId, activeSet] of activeInvestorsPerPlan.entries()) {
    if (byPlanId[planId]) {
      byPlanId[planId].activeInvestors = activeSet.size;
    }
  }

  const activePlans = params.plans.filter((p) => p.isActive).length;
  return {
    byPlanId,
    summary: {
      totalPlans: params.plans.length,
      activePlans,
      pausedPlans: params.plans.length - activePlans,
      totalInvestors: uniqueInvestorsOverall.size,
      totalActiveInvestments,
      totalInvestmentAmountInr,
    },
  };
}

/**
 * Resolves the homepage catalog list from Firestore productPlans when live
 * documents are published, preserving illustrative catalog defaults when none exist.
 */
export function resolveCatalogPlans(
  firestorePlans: ProductPlan[],
  fallbackPlans: ProductPlan[]
): ProductPlan[] {
  if (!firestorePlans.length) {
    return fallbackPlans;
  }

  const activeLive = firestorePlans.filter((plan) => plan.isActive);
  return activeLive.sort((a, b) => a.planPriceInr - b.planPriceInr);
}
