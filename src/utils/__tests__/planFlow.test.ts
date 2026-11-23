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
  evaluatePlanInvestmentEligibility,
  resolveCatalogPlans,
} from '../planInvestment';

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
});
