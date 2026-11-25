import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ILLUSTRATIVE_PLANS } from '../../data/catalogPreview';
import { ProductPlan } from '../../types/domain';
import {
  buildAuthUrlWithPlan,
  buildHomeReturnUrlWithPlan,
  extractSelectedPlanId,
  resolvePostAuthDestination,
  sanitizeInternalRedirectPath,
} from '../planNavigation';
import {
  aggregateAdminPlanAnalytics,
  canDeleteInvestmentPlan,
  computePlanEconomics,
  evaluateInvestmentComplianceGate,
  evaluatePlanInvestmentEligibility,
  resolveCatalogPlans,
} from '../planInvestment';
import { InvestmentRequest, UserPlan } from '../../types/domain';

describe('planNavigation utilities', () => {
  it('blocks external and protocol-relative redirect targets (open redirect protection)', () => {
    assert.equal(sanitizeInternalRedirectPath('https://evil.example/phish'), '/dashboard');
    assert.equal(sanitizeInternalRedirectPath('//evil.example/phish'), '/dashboard');
    assert.equal(sanitizeInternalRedirectPath('/\\evil.example'), '/dashboard');
    assert.equal(sanitizeInternalRedirectPath('/javascript:alert(1)'), '/dashboard');
    assert.equal(sanitizeInternalRedirectPath('javascript:alert(1)'), '/dashboard');
    assert.equal(sanitizeInternalRedirectPath('/?plan=PLAN_LAPTOP_100'), '/?plan=PLAN_LAPTOP_100');
    assert.equal(sanitizeInternalRedirectPath('/dashboard?plan=PLAN_LAPTOP_100'), '/dashboard?plan=PLAN_LAPTOP_100');
  });

  it('preserves selected plan ID across login <-> register links and post-auth redirect', () => {
    const returnUrl = buildHomeReturnUrlWithPlan('PLAN_SERVER_1000');
    assert.equal(returnUrl, '/?plan=PLAN_SERVER_1000');

    const loginUrl = buildAuthUrlWithPlan('/login', {
      planId: 'PLAN_SERVER_1000',
      redirectPath: returnUrl,
    });
    assert.equal(
      loginUrl,
      '/login?plan=PLAN_SERVER_1000&redirect=%2F%3Fplan%3DPLAN_SERVER_1000'
    );

    const registerUrl = buildAuthUrlWithPlan('/register', {
      planId: 'PLAN_SERVER_1000',
      redirectPath: returnUrl,
      referralCode: 'nx100001',
    });
    assert.equal(
      registerUrl,
      '/register?plan=PLAN_SERVER_1000&redirect=%2F%3Fplan%3DPLAN_SERVER_1000&ref=NX100001'
    );

    const destination = resolvePostAuthDestination({
      searchParams: new URLSearchParams('plan=PLAN_SERVER_1000&redirect=%2Fdashboard'),
    });
    assert.equal(destination, '/?plan=PLAN_SERVER_1000');
  });

  it('extracts plan ID from query string or location state and falls back to safe redirect/dashboard', () => {
    const fromState = extractSelectedPlanId({
      searchParams: new URLSearchParams(),
      locationState: { selectedPlanId: 'PLAN_MACHINERY_500' },
      useStorageFallback: false,
    });
    assert.equal(fromState, 'PLAN_MACHINERY_500');

    const storedDest = resolvePostAuthDestination({
      searchParams: new URLSearchParams(),
      storedPlanId: 'PLAN_ENERGY_5000',
    });
    assert.equal(storedDest, '/?plan=PLAN_ENERGY_5000');

    const defaultDest = resolvePostAuthDestination({
      searchParams: new URLSearchParams(),
    });
    assert.equal(defaultDest, '/dashboard');
  });
});

describe('planInvestment eligibility & catalog resolution', () => {
  const samplePlan: ProductPlan = ILLUSTRATIVE_PLANS[0];

  it('rejects insufficient verified coin balances with exact shortfall', () => {
    const result = evaluatePlanInvestmentEligibility({
      plan: samplePlan,
      availableCoins: 40,
      accountStatus: 'ACTIVE',
      acceptedTerms: true,
    });

    assert.equal(result.eligible, false);
    assert.equal(result.shortfallCoins, 60);
    assert.equal(result.postInvestmentCoins, 0);
    assert.match(result.reason || '', /Insufficient verified coins/i);
  });

  it('rejects paused plans, non-ACTIVE users, and unaccepted terms', () => {
    const paused = evaluatePlanInvestmentEligibility({
      plan: { ...samplePlan, isActive: false },
      availableCoins: 500,
      accountStatus: 'ACTIVE',
      acceptedTerms: true,
    });
    assert.equal(paused.eligible, false);

    const suspended = evaluatePlanInvestmentEligibility({
      plan: samplePlan,
      availableCoins: 500,
      accountStatus: 'SUSPENDED',
      acceptedTerms: true,
    });
    assert.equal(suspended.eligible, false);

    const noTerms = evaluatePlanInvestmentEligibility({
      plan: samplePlan,
      availableCoins: 500,
      accountStatus: 'ACTIVE',
      acceptedTerms: false,
    });
    assert.equal(noTerms.eligible, false);
  });

  it('permits eligible investment and calculates exact post-investment coin balance', () => {
    const result = evaluatePlanInvestmentEligibility({
      plan: samplePlan,
      availableCoins: 250,
      accountStatus: 'ACTIVE',
      acceptedTerms: true,
    });

    assert.equal(result.eligible, true);
    assert.equal(result.shortfallCoins, 0);
    assert.equal(result.requiredCoins, 100);
    assert.equal(result.postInvestmentCoins, 150);
  });

  it('uses live active Firestore productPlans when published and falls back to illustrative plans when empty', () => {
    assert.equal(resolveCatalogPlans([], ILLUSTRATIVE_PLANS).length, ILLUSTRATIVE_PLANS.length);

    const livePlans: ProductPlan[] = [
      { ...ILLUSTRATIVE_PLANS[2], isIllustrativePreview: false, isActive: true },
      { ...ILLUSTRATIVE_PLANS[1], isIllustrativePreview: false, isActive: false },
      { ...ILLUSTRATIVE_PLANS[0], isIllustrativePreview: false, isActive: true },
    ];
    const resolved = resolveCatalogPlans(livePlans, ILLUSTRATIVE_PLANS);
    assert.equal(resolved.length, 2);
    assert.equal(resolved[0].planId, ILLUSTRATIVE_PLANS[0].planId);
    assert.equal(resolved[1].planId, ILLUSTRATIVE_PLANS[2].planId);
  });

  it('computes variable-amount plan economics with proportional payout, expected return %, and daily earnings', () => {
    const rangePlan: ProductPlan = {
      ...ILLUSTRATIVE_PLANS[2],
      planId: 'PLAN_RANGE_TEST',
      planPriceInr: 1000,
      coinDeductionAmount: 1000,
      minCoins: 1000,
      maxCoins: 5000,
      durationDays: 20,
      totalCoinReward: 1250,
      expectedReturnPercent: 25,
    };

    const econ = computePlanEconomics({ plan: rangePlan, investmentAmountInr: 3000 });
    assert.equal(econ.investmentAmountInr, 3000);
    assert.equal(econ.coinCost, 3000);
    assert.equal(econ.expectedReturnPercent, 25);
    assert.equal(econ.estimatedTotalPayoutInr, 3750);
    assert.equal(econ.estimatedNetProfitInr, 750);
    assert.equal(econ.dailyEarningsInr, 37.5);
    assert.equal(
      econ.dailyDistribution.reduce((sum, v) => sum + v, 0),
      3750
    );

    const outOfRange = evaluatePlanInvestmentEligibility({
      plan: rangePlan,
      availableCoins: 10000,
      accountStatus: 'ACTIVE',
      acceptedTerms: true,
      investmentAmountInr: 6000,
      complianceApproved: true,
    });
    assert.equal(outOfRange.eligible, false);
    assert.match(outOfRange.reason || '', /between ₹1,000 and ₹5,000/i);

    const blockedByCompliance = evaluatePlanInvestmentEligibility({
      plan: rangePlan,
      availableCoins: 10000,
      accountStatus: 'ACTIVE',
      acceptedTerms: true,
      investmentAmountInr: 2000,
      complianceApproved: false,
    });
    assert.equal(blockedByCompliance.eligible, false);
    assert.match(blockedByCompliance.reason || '', /compliance checks are complete/i);
  });

  it('fails closed on compliance gate unless legal, payment provider, and admin flag are all enabled', () => {
    assert.equal(evaluateInvestmentComplianceGate(null).allowed, false);
    assert.equal(
      evaluateInvestmentComplianceGate({
        legalComplianceVerified: true,
        paymentProviderComplianceVerified: false,
        realMoneyInvestmentsEnabled: true,
      }).allowed,
      false
    );
    assert.equal(
      evaluateInvestmentComplianceGate({
        legalComplianceVerified: true,
        paymentProviderComplianceVerified: true,
        realMoneyInvestmentsEnabled: true,
      }).allowed,
      true
    );
  });

  it('blocks plan deletion if active investments or pending requests exist and aggregates admin analytics accurately', () => {
    const plans: ProductPlan[] = [
      { ...ILLUSTRATIVE_PLANS[0], planId: 'P1', isActive: true },
      { ...ILLUSTRATIVE_PLANS[1], planId: 'P2', isActive: false },
    ];
    const userPlans: Pick<UserPlan, 'planId' | 'uid' | 'coinCost' | 'status'>[] = [
      { planId: 'P1', uid: 'u1', coinCost: 100, status: 'ACTIVE' },
      { planId: 'P1', uid: 'u1', coinCost: 200, status: 'COMPLETED' },
      { planId: 'P1', uid: 'u2', coinCost: 150, status: 'ACTIVE' },
      { planId: 'P2', uid: 'u3', coinCost: 500, status: 'COMPLETED' },
    ];
    const requests: Pick<InvestmentRequest, 'planId' | 'status'>[] = [
      { planId: 'P1', status: 'PENDING_VERIFICATION' },
      { planId: 'P2', status: 'ACTIVATED' },
    ];

    const p1DeleteCheck = canDeleteInvestmentPlan({
      planId: 'P1',
      userPlans,
      investmentRequests: requests,
    });
    assert.equal(p1DeleteCheck.canDelete, false);
    assert.equal(p1DeleteCheck.activeInvestmentsCount, 2);
    assert.equal(p1DeleteCheck.pendingRequestsCount, 1);

    const p2DeleteCheck = canDeleteInvestmentPlan({
      planId: 'P2',
      userPlans,
      investmentRequests: requests,
    });
    assert.equal(p2DeleteCheck.canDelete, true);

    const analytics = aggregateAdminPlanAnalytics({
      plans,
      userPlans,
      investmentRequests: requests,
    });
    assert.equal(analytics.byPlanId.P1.totalInvestors, 2);
    assert.equal(analytics.byPlanId.P1.activeInvestors, 2);
    assert.equal(analytics.byPlanId.P1.activeInvestmentsCount, 2);
    assert.equal(analytics.byPlanId.P1.totalInvestmentAmountInr, 450);
    assert.equal(analytics.byPlanId.P1.pendingRequestsCount, 1);
    assert.equal(analytics.byPlanId.P2.totalInvestors, 1);
    assert.equal(analytics.byPlanId.P2.totalInvestmentAmountInr, 500);
    assert.equal(analytics.summary.totalPlans, 2);
    assert.equal(analytics.summary.activePlans, 1);
    assert.equal(analytics.summary.pausedPlans, 1);
    assert.equal(analytics.summary.totalInvestors, 3);
    assert.equal(analytics.summary.totalActiveInvestments, 2);
    assert.equal(analytics.summary.totalInvestmentAmountInr, 950);
  });
});
