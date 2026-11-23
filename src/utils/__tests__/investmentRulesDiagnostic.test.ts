import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { serverTimestamp, Timestamp } from 'firebase/firestore';
import { ILLUSTRATIVE_PLANS } from '../../data/catalogPreview';
import { SUPER_ADMIN_UID } from '../../config/constants';
import {
  buildExpectedInvestmentRequestPayload,
  DEFAULT_DIAGNOSTIC_DATABASE_ID,
  diagnoseInvestmentRequestRules,
  InvestmentRequestAuthContext,
} from '../investmentRulesDiagnostic';

const ACTIVE_MEMBER_AUTH: InvestmentRequestAuthContext = {
  isAuthenticated: true,
  uid: 'member_uid_123',
  email: 'member@nexora.in',
  emailVerified: true,
  signInProvider: 'password',
  isAnonymous: false,
};

const ACTIVE_MEMBER_PROFILE = {
  uid: 'member_uid_123',
  userId: 'NX100042',
  status: 'ACTIVE',
  role: 'USER',
};

describe('diagnoseInvestmentRequestRules', () => {
  it('allows valid create payload matching built-in catalog plan and provides deployment drift guidance', () => {
    const requestId = 'invreq_1700000000000_abc123';
    const payload = buildExpectedInvestmentRequestPayload({
      requestId,
      uid: 'member_uid_123',
      userId: 'NX100042',
      plan: ILLUSTRATIVE_PLANS[0],
      acceptedTerms: true,
      createdAtSentinel: serverTimestamp(),
      updatedAtSentinel: serverTimestamp(),
    });

    const report = diagnoseInvestmentRequestRules({
      operation: 'create',
      requestId,
      auth: ACTIVE_MEMBER_AUTH,
      incomingData: payload,
      userProfileDoc: ACTIVE_MEMBER_PROFILE,
      productPlanDoc: null,
      existingRequestDoc: null,
    });

    assert.equal(report.allowed, true);
    assert.equal(report.databaseId, DEFAULT_DIAGNOSTIC_DATABASE_ID);
    assert.equal(report.failedConditions.length, 0);
    assert.equal(report.firstDenyingCondition, null);
    assert.match(report.summary, /^ALLOWED \(create on investmentRequests\//);
    assert.match(report.deploymentDriftNote, /out of sync with local firestore\.rules/i);
  });

  it('allows valid create payload matching a live active published productPlans document', () => {
    const requestId = 'invreq_custom_001';
    const customPlan = {
      planId: 'PLAN_CUSTOM_TITAN_2500',
      productName: 'Titan Cluster Plan',
      planPriceInr: 2500,
      coinDeductionAmount: 2500,
      durationDays: 15,
      totalCoinReward: 3100,
      isActive: true,
    };

    const payload = buildExpectedInvestmentRequestPayload({
      requestId,
      uid: 'member_uid_123',
      userId: 'NX100042',
      plan: customPlan,
      acceptedTerms: true,
      createdAtSentinel: serverTimestamp(),
      updatedAtSentinel: serverTimestamp(),
    });

    const report = diagnoseInvestmentRequestRules({
      operation: 'create',
      requestId,
      auth: ACTIVE_MEMBER_AUTH,
      incomingData: payload,
      userProfileDoc: ACTIVE_MEMBER_PROFILE,
      productPlanDoc: customPlan,
      existingRequestDoc: null,
    });

    assert.equal(report.allowed, true);
    assert.equal(report.failedConditions.length, 0);
  });

  it('pinpoints unauthenticated and anonymous Firebase Auth failures (isSignedIn)', () => {
    const requestId = 'invreq_unauth_001';
    const payload = buildExpectedInvestmentRequestPayload({
      requestId,
      uid: 'member_uid_123',
      userId: 'NX100042',
      plan: ILLUSTRATIVE_PLANS[0],
      acceptedTerms: true,
    });

    const unauthReport = diagnoseInvestmentRequestRules({
      requestId,
      auth: { isAuthenticated: false, uid: null },
      incomingData: payload,
      userProfileDoc: ACTIVE_MEMBER_PROFILE,
    });
    assert.equal(unauthReport.allowed, false);
    assert.equal(unauthReport.firstDenyingCondition?.id, 'isSignedIn');

    const anonReport = diagnoseInvestmentRequestRules({
      requestId,
      auth: {
        isAuthenticated: true,
        uid: 'anon_123',
        signInProvider: 'anonymous',
        isAnonymous: true,
      },
      incomingData: { ...payload, uid: 'anon_123' },
      userProfileDoc: { ...ACTIVE_MEMBER_PROFILE, uid: 'anon_123' },
    });
    assert.equal(anonReport.allowed, false);
    assert.equal(anonReport.firstDenyingCondition?.id, 'isSignedIn');
  });

  it('pinpoints missing users/{uid} doc, non-ACTIVE user status, and NX userId parity mismatch', () => {
    const requestId = 'invreq_profile_001';
    const payload = buildExpectedInvestmentRequestPayload({
      requestId,
      uid: 'member_uid_123',
      userId: 'NX100042',
      plan: ILLUSTRATIVE_PLANS[0],
      acceptedTerms: true,
    });

    const missingProfileReport = diagnoseInvestmentRequestRules({
      requestId,
      auth: ACTIVE_MEMBER_AUTH,
      incomingData: payload,
      userProfileDoc: null,
    });
    assert.equal(missingProfileReport.allowed, false);
    assert.ok(
      missingProfileReport.failedConditions.some((c) => c.id === 'create_user_profile_exists')
    );

    const suspendedReport = diagnoseInvestmentRequestRules({
      requestId,
      auth: ACTIVE_MEMBER_AUTH,
      incomingData: payload,
      userProfileDoc: { ...ACTIVE_MEMBER_PROFILE, status: 'SUSPENDED' },
    });
    assert.equal(suspendedReport.allowed, false);
    assert.equal(suspendedReport.firstDenyingCondition?.id, 'create_user_status_active');
    assert.match(suspendedReport.firstDenyingCondition?.actual || '', /SUSPENDED/);

    const mismatchUserIdReport = diagnoseInvestmentRequestRules({
      requestId,
      auth: ACTIVE_MEMBER_AUTH,
      incomingData: payload,
      userProfileDoc: { ...ACTIVE_MEMBER_PROFILE, userId: 'NX999999' },
    });
    assert.equal(mismatchUserIdReport.allowed, false);
    assert.equal(mismatchUserIdReport.firstDenyingCondition?.id, 'create_userId_matches_profile');
  });

  it('detects schema violations, extra keys, float values, bad timestamps, and forbidden server fields', () => {
    const requestId = 'invreq_schema_001';
    const basePayload = buildExpectedInvestmentRequestPayload({
      requestId,
      uid: 'member_uid_123',
      userId: 'NX100042',
      plan: ILLUSTRATIVE_PLANS[0],
      acceptedTerms: true,
    });

    const badPayload: Record<string, unknown> = {
      ...basePayload,
      planPriceInr: 100.5,
      status: 'ACTIVATED',
      paymentStatus: 'VERIFIED',
      activatedUserPlanId: 'uplan_spoofed',
      unexpectedField: 'spoof',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    delete badPayload.idempotencyKey;

    const report = diagnoseInvestmentRequestRules({
      requestId,
      auth: ACTIVE_MEMBER_AUTH,
      incomingData: badPayload,
      userProfileDoc: ACTIVE_MEMBER_PROFILE,
    });

    assert.equal(report.allowed, false);
    const failedIds = new Set(report.failedConditions.map((c) => c.id));
    assert.ok(failedIds.has('schema_required_keys'));
    assert.ok(failedIds.has('schema_allowed_keys_only'));
    assert.ok(failedIds.has('schema_planPriceInr'));
    assert.ok(failedIds.has('create_status_pending_verification'));
    assert.ok(failedIds.has('create_paymentStatus_pending'));
    assert.ok(failedIds.has('create_absent_activatedUserPlanId'));
    assert.ok(failedIds.has('create_createdAt_server_time'));
  });

  it('detects paused plans, parameter drift against published productPlans, missing custom plans, and catalog tampering', () => {
    const requestId = 'invreq_plan_001';
    const payload = buildExpectedInvestmentRequestPayload({
      requestId,
      uid: 'member_uid_123',
      userId: 'NX100042',
      plan: ILLUSTRATIVE_PLANS[0],
      acceptedTerms: true,
    });

    // Paused + price mismatch on live published plan
    const publishedMismatch = diagnoseInvestmentRequestRules({
      requestId,
      auth: ACTIVE_MEMBER_AUTH,
      incomingData: payload,
      userProfileDoc: ACTIVE_MEMBER_PROFILE,
      productPlanDoc: {
        planId: 'PLAN_LAPTOP_100',
        productName: 'Laptop Plan',
        planPriceInr: 150,
        coinDeductionAmount: 150,
        durationDays: 7,
        totalCoinReward: 188,
        isActive: false,
      },
    });
    assert.equal(publishedMismatch.allowed, false);
    assert.equal(
      publishedMismatch.firstDenyingCondition?.id,
      'create_matches_published_productPlan'
    );
    assert.match(publishedMismatch.firstDenyingCondition?.actual || '', /isActive=false/);
    assert.match(publishedMismatch.firstDenyingCondition?.actual || '', /planPriceInr/);

    // Custom plan missing from Firestore
    const missingCustomPlanPayload = buildExpectedInvestmentRequestPayload({
      requestId,
      uid: 'member_uid_123',
      userId: 'NX100042',
      plan: {
        planId: 'PLAN_CUSTOM_MISSING',
        productName: 'Missing Custom Plan',
        planPriceInr: 999,
        coinDeductionAmount: 999,
        durationDays: 10,
        totalCoinReward: 1200,
      },
      acceptedTerms: true,
    });
    const missingCustomReport = diagnoseInvestmentRequestRules({
      requestId,
      auth: ACTIVE_MEMBER_AUTH,
      incomingData: missingCustomPlanPayload,
      userProfileDoc: ACTIVE_MEMBER_PROFILE,
      productPlanDoc: null,
    });
    assert.equal(missingCustomReport.allowed, false);
    assert.equal(
      missingCustomReport.firstDenyingCondition?.id,
      'create_matches_catalog_or_published_plan'
    );

    // Built-in catalog plan with tampered reward
    const tamperedCatalogReport = diagnoseInvestmentRequestRules({
      requestId,
      auth: ACTIVE_MEMBER_AUTH,
      incomingData: { ...payload, totalRewardEntitlement: 99999 },
      userProfileDoc: ACTIVE_MEMBER_PROFILE,
      productPlanDoc: null,
    });
    assert.equal(tamperedCatalogReport.allowed, false);
    assert.equal(
      tamperedCatalogReport.firstDenyingCondition?.id,
      'create_matches_catalog_or_published_plan'
    );
    assert.match(tamperedCatalogReport.firstDenyingCondition?.actual || '', /totalRewardEntitlement/);
  });

  it('detects pre-existing document collision on create and enforces admin/immutability rules on update and delete', () => {
    const requestId = 'invreq_dup_001';
    const createdAtTs = Timestamp.fromMillis(1700000000000);
    const existingDoc = {
      ...buildExpectedInvestmentRequestPayload({
        requestId,
        uid: 'member_uid_123',
        userId: 'NX100042',
        plan: ILLUSTRATIVE_PLANS[0],
        acceptedTerms: true,
        createdAtSentinel: createdAtTs,
        updatedAtSentinel: createdAtTs,
      }),
    };

    const duplicateReport = diagnoseInvestmentRequestRules({
      operation: 'create',
      requestId,
      auth: ACTIVE_MEMBER_AUTH,
      incomingData: buildExpectedInvestmentRequestPayload({
        requestId,
        uid: 'member_uid_123',
        userId: 'NX100042',
        plan: ILLUSTRATIVE_PLANS[0],
        acceptedTerms: true,
      }),
      userProfileDoc: ACTIVE_MEMBER_PROFILE,
      existingRequestDoc: existingDoc,
    });
    assert.equal(duplicateReport.allowed, false);
    assert.equal(duplicateReport.firstDenyingCondition?.id, 'create_doc_not_already_exists');

    // Member cannot update
    const memberUpdateReport = diagnoseInvestmentRequestRules({
      operation: 'update',
      requestId,
      auth: ACTIVE_MEMBER_AUTH,
      incomingData: {
        ...existingDoc,
        status: 'ACTIVATED',
        paymentStatus: 'VERIFIED',
        updatedAt: serverTimestamp(),
      },
      existingRequestDoc: existingDoc,
      adminUserDoc: null,
    });
    assert.equal(memberUpdateReport.allowed, false);
    assert.equal(memberUpdateReport.firstDenyingCondition?.id, 'update_isAdmin');

    // Admin can update when immutable fields & createdAt are preserved
    const adminUpdateReport = diagnoseInvestmentRequestRules({
      operation: 'update',
      requestId,
      auth: {
        isAuthenticated: true,
        uid: SUPER_ADMIN_UID,
        email: 'saini.lalit278@gmail.com',
        emailVerified: true,
        signInProvider: 'password',
      },
      incomingData: {
        ...existingDoc,
        status: 'ACTIVATED',
        paymentStatus: 'VERIFIED',
        verifiedByUid: SUPER_ADMIN_UID,
        activatedUserPlanId: 'uplan_123',
        coinTransactionId: 'cointx_123',
        activatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      existingRequestDoc: existingDoc,
    });
    assert.equal(adminUpdateReport.allowed, true);

    // Delete always denied
    const deleteReport = diagnoseInvestmentRequestRules({
      operation: 'delete',
      requestId,
      auth: {
        isAuthenticated: true,
        uid: SUPER_ADMIN_UID,
        emailVerified: true,
      },
      incomingData: {},
    });
    assert.equal(deleteReport.allowed, false);
    assert.equal(deleteReport.firstDenyingCondition?.id, 'delete_unconditionally_denied');
  });
});
