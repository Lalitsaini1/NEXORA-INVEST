import { ProductPlan } from '../types/domain';

export interface PlanInvestmentEligibility {
  eligible: boolean;
  reason?: string;
  availableCoins: number;
  requiredCoins: number;
  shortfallCoins: number;
  postInvestmentCoins: number;
}

export function evaluatePlanInvestmentEligibility(params: {
  plan: ProductPlan;
  availableCoins: number;
  accountStatus?: string;
  acceptedTerms: boolean;
}): PlanInvestmentEligibility {
  const available = Math.max(0, Math.floor(Number(params.availableCoins || 0)));
  const required = Math.max(1, Math.floor(Number(params.plan.coinDeductionAmount || 0)));
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
