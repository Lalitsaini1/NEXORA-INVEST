import { createHash, randomUUID } from 'node:crypto';
import * as admin from 'firebase-admin';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  buildCanonicalDepositTxIds,
  DepositSettlementProofInput,
  DepositVerificationError,
  normalizeUtrRef,
  validateDepositApprovalRequirements,
} from './depositVerification';
import {
  buildMailDocumentId,
  buildPlanActivationEmailPayload,
  isPendingToActiveTransition,
  isValidEmailAddress,
} from './planActivationEmail';
import {
  buildDeterministicLockId,
  BuiltInPlanSpec,
  buildPendingInvestmentRequestDoc,
  detectTamperedServerFields,
  evaluateServerComplianceGate,
  resolveAuthoritativePlanSpec,
  sanitizeIdentifier,
  validatePlanAmountsMatch,
} from './investmentRequestValidation';

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'nexora-invest-e4399';
const MAIL_COLLECTION = process.env.NEXORA_MAIL_COLLECTION || 'mail';
const DATABASE_ID =
  process.env.NEXORA_FIRESTORE_DB_ID ||
  'ai-studio-nexorainvest-c25f96bd-2963-4ef8-b030-e5a6fe625870';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}

const db = getFirestore(admin.app(), DATABASE_ID);

const OWNER_ADMIN_EMAIL = 'saini.lalit278@gmail.com';
const SUPER_ADMIN_UID = 'wZQCw7fXrWQCn5HqdSjS6RQHVyi1';
const SUPER_ADMIN_EMAILS = new Set([OWNER_ADMIN_EMAIL]);

// Built-in catalog specs imported from ./investmentRequestValidation

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function sanitizeId(raw: unknown): string {
  return sanitizeIdentifier(raw);
}

function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw.trim().toLowerCase()).digest('hex');
}

function maskUpi(upiId: string): string {
  const clean = upiId.trim();
  const atIdx = clean.indexOf('@');
  if (atIdx <= 1) return clean;
  const local = clean.slice(0, atIdx);
  const handle = clean.slice(atIdx);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${'•'.repeat(Math.max(2, local.length - head.length))}${handle}`;
}

function isAnonymousAuthToken(token: Record<string, unknown>): boolean {
  const firebaseMeta = token.firebase;
  if (typeof firebaseMeta === 'object' && firebaseMeta !== null && 'sign_in_provider' in firebaseMeta) {
    return (firebaseMeta as { sign_in_provider?: unknown }).sign_in_provider === 'anonymous';
  }
  return false;
}

async function assertSuperAdminCaller(request: {
  auth?: { uid: string; token: Record<string, unknown> };
}): Promise<string> {
  if (!request.auth || isAnonymousAuthToken(request.auth.token)) {
    throw new HttpsError('unauthenticated', 'Authenticated non-anonymous session is required.');
  }

  const uid = request.auth.uid;
  const email = String(request.auth.token.email || '').toLowerCase();
  const emailVerified = Boolean(request.auth.token.email_verified);
  const claimsSuper =
    request.auth.token.super_admin === true ||
    request.auth.token.role === 'SUPER_ADMIN';

  if (
    uid === SUPER_ADMIN_UID ||
    claimsSuper ||
    (emailVerified && SUPER_ADMIN_EMAILS.has(email))
  ) {
    return uid;
  }

  const adminSnap = await db.collection('adminUsers').doc(uid).get();
  if (
    adminSnap.exists &&
    adminSnap.data()?.active === true &&
    adminSnap.data()?.role === 'SUPER_ADMIN'
  ) {
    return uid;
  }

  throw new HttpsError(
    'permission-denied',
    'Only the verified Super Admin may perform this operation.'
  );
}

async function assertAdminCaller(request: {
  auth?: { uid: string; token: Record<string, unknown> };
}): Promise<{ uid: string; email: string; role: 'ADMIN' | 'SUPER_ADMIN' }> {
  if (!request.auth || isAnonymousAuthToken(request.auth.token)) {
    throw new HttpsError('unauthenticated', 'Authenticated administrator session is required.');
  }

  const uid = request.auth.uid;
  const email = String(request.auth.token.email || '').toLowerCase();
  const emailVerified = Boolean(request.auth.token.email_verified);
  const claimsSuper =
    request.auth.token.super_admin === true ||
    request.auth.token.role === 'SUPER_ADMIN';
  const claimsAdmin =
    request.auth.token.admin === true || request.auth.token.role === 'ADMIN';

  if (
    uid === SUPER_ADMIN_UID ||
    claimsSuper ||
    (emailVerified && SUPER_ADMIN_EMAILS.has(email))
  ) {
    return { uid, email, role: 'SUPER_ADMIN' };
  }

  const adminSnap = await db.collection('adminUsers').doc(uid).get();
  if (adminSnap.exists && adminSnap.data()?.active === true) {
    const docRole =
      adminSnap.data()?.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN';
    return { uid, email, role: docRole };
  }

  if (claimsAdmin) {
    return { uid, email, role: 'ADMIN' };
  }

  throw new HttpsError(
    'permission-denied',
    'Verified Administrator privileges are required.'
  );
}

/**
 * Production Firebase Cloud Function for backend-governed registration provisioning.
 */
export const provisionNexoraProfile = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication is required.');
  }

  const uid = request.auth.uid;
  const fullName = String(request.data?.fullName || '').trim();
  const email = String(request.auth.token.email || request.data?.email || '')
    .trim()
    .toLowerCase()
    .slice(0, 160);
  const mobile = String(request.auth.token.phone_number || request.data?.mobile || '')
    .trim()
    .slice(0, 20);

  if (fullName.length < 2 || fullName.length > 80) {
    throw new HttpsError('invalid-argument', 'Full name must be between 2 and 80 characters.');
  }

  const userRef = db.collection('users').doc(uid);
  const walletRef = db.collection('coinWallets').doc(uid);
  const counterRef = db.collection('counters').doc('userIds');
  const emailLockId = email ? `email_${sha256Hex(email)}` : '';
  const mobileLockId = mobile ? `mobile_${sha256Hex(mobile)}` : '';
  const emailLockRef = emailLockId ? db.collection('identityLocks').doc(emailLockId) : null;
  const mobileLockRef = mobileLockId ? db.collection('identityLocks').doc(mobileLockId) : null;

  const result = await db.runTransaction(async (tx) => {
    const existing = await tx.get(userRef);
    if (existing.exists) {
      return existing.data();
    }

    const [counterSnap, walletSnap, emailLockSnap, mobileLockSnap] = await Promise.all([
      tx.get(counterRef),
      tx.get(walletRef),
      emailLockRef ? tx.get(emailLockRef) : Promise.resolve(null),
      mobileLockRef ? tx.get(mobileLockRef) : Promise.resolve(null),
    ]);

    if (emailLockSnap?.exists && emailLockSnap.data()?.uid !== uid) {
      throw new HttpsError('already-exists', 'Email is already registered to another account.');
    }
    if (mobileLockSnap?.exists && mobileLockSnap.data()?.uid !== uid) {
      throw new HttpsError(
        'already-exists',
        'Mobile number is already registered to another account.'
      );
    }

    const nextNum = counterSnap.exists ? Number(counterSnap.data()?.nextNumber || 100001) : 100001;
    const assignedUserId = `NX${nextNum}`;

    tx.set(counterRef, {
      nextNumber: nextNum + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const profile = {
      uid,
      userId: assignedUserId,
      role: 'USER',
      fullName,
      email,
      mobile,
      emailVerified: Boolean(request.auth?.token.email_verified),
      mobileVerified: Boolean(request.auth?.token.phone_number),
      authProvider: request.auth?.token.phone_number ? 'phone' : 'password',
      status: 'ACTIVE',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    tx.set(userRef, profile);
    if (!walletSnap.exists) {
      tx.set(walletRef, {
        uid,
        userId: assignedUserId,
        availableCoins: 0,
        purchasedCoins: 0,
        earnedCoins: 0,
        coinsUsedForPlans: 0,
        pendingTransactionCoins: 0,
        withdrawableBalanceInr: 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    if (emailLockRef && emailLockId && !emailLockSnap?.exists) {
      tx.set(emailLockRef, {
        type: 'EMAIL',
        valueHash: emailLockId.replace('email_', ''),
        uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    if (mobileLockRef && mobileLockId && !mobileLockSnap?.exists) {
      tx.set(mobileLockRef, {
        type: 'MOBILE',
        valueHash: mobileLockId.replace('mobile_', ''),
        uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    return profile;
  });

  return result;
});

/**
 * Super Admin callable to assign or revoke ADMIN role with Firebase Custom Claims
 * while preserving existing claims and strictly protecting SUPER_ADMIN_UID.
 */
export const setNexoraAdminRole = onCall(async (request) => {
  const actorUid = await assertSuperAdminCaller(request);

  const targetUid = String(request.data?.targetUid || '').trim();
  const nextRole = String(request.data?.role || '').toUpperCase();

  if (!targetUid) {
    throw new HttpsError('invalid-argument', 'targetUid is required.');
  }
  if (targetUid === SUPER_ADMIN_UID) {
    throw new HttpsError(
      'permission-denied',
      'Protected Super Admin account cannot be modified or demoted.'
    );
  }
  if (nextRole !== 'ADMIN' && nextRole !== 'USER') {
    throw new HttpsError('invalid-argument', 'Role must be ADMIN or USER.');
  }

  const targetUser = await admin.auth().getUser(targetUid);
  const preservedClaims = { ...(targetUser.customClaims || {}) };
  if (nextRole === 'ADMIN') {
    preservedClaims.role = 'ADMIN';
    preservedClaims.admin = true;
  } else {
    delete preservedClaims.role;
    delete preservedClaims.admin;
  }

  await admin.auth().setCustomUserClaims(targetUid, preservedClaims);

  const batch = db.batch();
  const userRef = db.collection('users').doc(targetUid);
  const adminRef = db.collection('adminUsers').doc(targetUid);
  const logRef = db.collection('adminActivityLogs').doc();

  batch.set(
    userRef,
    {
      role: nextRole,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  if (nextRole === 'ADMIN') {
    batch.set(
      adminRef,
      {
        uid: targetUid,
        email: (targetUser.email || '').toLowerCase(),
        role: 'ADMIN',
        active: true,
        createdByUid: actorUid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } else {
    batch.set(
      adminRef,
      {
        uid: targetUid,
        role: 'ADMIN',
        active: false,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  batch.set(logRef, {
    logId: logRef.id,
    actorUid,
    actorEmail: String(request.auth?.token.email || ''),
    actorRole: 'SUPER_ADMIN',
    actionType: nextRole === 'ADMIN' ? 'USER_PROMOTED_TO_ADMIN' : 'ADMIN_REVOKED',
    targetId: targetUid,
    summary: `Server role change for ${targetUser.email || targetUid} -> ${nextRole}`,
    createdAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
  return { ok: true, targetUid, role: nextRole };
});

/**
 * Trusted server-side callable that verifies the authenticated caller is the
 * project owner (verified saini.lalit278@gmail.com or SUPER_ADMIN_UID),
 * assigns Firebase Auth Custom Claims (`SUPER_ADMIN`), and synchronizes
 * `adminUsers/{uid}` and `users/{uid}` in Firestore.
 */
export const syncOwnerSuperAdmin = onCall(async (request) => {
  if (!request.auth || isAnonymousAuthToken(request.auth.token)) {
    throw new HttpsError('unauthenticated', 'Authenticated session is required.');
  }

  const uid = request.auth.uid;
  const tokenEmail = String(request.auth.token.email || '')
    .trim()
    .toLowerCase();
  const emailVerified = Boolean(request.auth.token.email_verified);

  const isAuthorizedOwner =
    uid === SUPER_ADMIN_UID ||
    (emailVerified && SUPER_ADMIN_EMAILS.has(tokenEmail));

  if (!isAuthorizedOwner) {
    throw new HttpsError(
      'permission-denied',
      'Only the verified project owner email (saini.lalit278@gmail.com) may claim Super Admin privileges.'
    );
  }

  const authUser = await admin.auth().getUser(uid);
  const resolvedEmail = (authUser.email || tokenEmail).trim().toLowerCase();
  if (uid !== SUPER_ADMIN_UID && (!authUser.emailVerified || !SUPER_ADMIN_EMAILS.has(resolvedEmail))) {
    throw new HttpsError(
      'permission-denied',
      'Owner email must be verified in Firebase Authentication before Super Admin role assignment.'
    );
  }

  const preservedClaims = { ...(authUser.customClaims || {}) };
  preservedClaims.role = 'SUPER_ADMIN';
  preservedClaims.super_admin = true;
  preservedClaims.admin = true;
  await admin.auth().setCustomUserClaims(uid, preservedClaims);

  const userRef = db.collection('users').doc(uid);
  const adminRef = db.collection('adminUsers').doc(uid);
  const logRef = db.collection('adminActivityLogs').doc();

  await db.runTransaction(async (tx) => {
    const [userSnap, adminSnap] = await Promise.all([tx.get(userRef), tx.get(adminRef)]);
    tx.set(
      adminRef,
      {
        uid,
        email: resolvedEmail || OWNER_ADMIN_EMAIL,
        displayName: (authUser.displayName || 'NEXORA Owner Super Admin').slice(0, 80),
        role: 'SUPER_ADMIN',
        active: true,
        createdByUid: uid,
        createdAt: adminSnap.exists ? adminSnap.data()?.createdAt : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (userSnap.exists) {
      tx.set(
        userRef,
        {
          role: 'SUPER_ADMIN',
          emailVerified: Boolean(authUser.emailVerified),
          status: 'ACTIVE',
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    tx.set(logRef, {
      logId: logRef.id,
      actorUid: uid,
      actorEmail: resolvedEmail || OWNER_ADMIN_EMAIL,
      actorRole: 'SUPER_ADMIN',
      actionType: 'USER_PROMOTED_TO_ADMIN',
      targetId: uid,
      summary: `Synchronized server-side SUPER_ADMIN custom claims and directory record for owner (${resolvedEmail || uid})`,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    ok: true,
    uid,
    email: resolvedEmail || OWNER_ADMIN_EMAIL,
    role: 'SUPER_ADMIN',
  };
});

function assertAuthenticatedMember(request: {
  auth?: { uid: string; token: Record<string, unknown> };
}): string {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError(
      'unauthenticated',
      'Authentication is required to submit or process investment requests.'
    );
  }
  const firebaseMeta = request.auth.token?.firebase as Record<string, unknown> | undefined;
  if (firebaseMeta?.sign_in_provider === 'anonymous') {
    throw new HttpsError(
      'permission-denied',
      'Anonymous sessions cannot submit or activate investments. Please sign in to a verified member account.'
    );
  }
  return request.auth.uid;
}

function assertValidCallableInvestmentInput(data: unknown): {
  planId: string;
  idempotencyKey: string;
  investmentAmountInr?: unknown;
  expectedPlanPriceInr?: unknown;
  expectedCoinCost?: unknown;
  paymentTxId: string;
  depositId: string;
} {
  const tamperCheck = detectTamperedServerFields(data);
  if (!tamperCheck.ok) {
    throw new HttpsError('permission-denied', tamperCheck.message);
  }

  const record = (data || {}) as Record<string, unknown>;
  const planId = sanitizeId(record.planId);
  const acceptedTerms = record.acceptedTerms === true;
  const rawIdempotency = sanitizeId(record.idempotencyKey);
  const idempotencyKey =
    rawIdempotency && rawIdempotency.length >= 4
      ? rawIdempotency.slice(0, 128)
      : makeId('idem').slice(0, 128);

  if (!planId || planId.length > 64) {
    throw new HttpsError('invalid-argument', 'A valid investment plan ID is required.');
  }
  if (!acceptedTerms) {
    throw new HttpsError(
      'invalid-argument',
      'You must accept the Plan Terms and Conditions before submitting an investment request.'
    );
  }

  return {
    planId,
    idempotencyKey,
    investmentAmountInr: record.investmentAmountInr,
    expectedPlanPriceInr: record.expectedPlanPriceInr,
    expectedCoinCost: record.expectedCoinCost,
    paymentTxId: sanitizeId(record.paymentTxId),
    depositId: sanitizeId(record.depositId),
  };
}

async function createOrReusePendingRequestTx(params: {
  uid: string;
  planId: string;
  idempotencyKey: string;
  investmentAmountInr?: unknown;
  expectedPlanPriceInr?: unknown;
  expectedCoinCost?: unknown;
}): Promise<{
  requestId: string;
  investmentRequest: Record<string, unknown>;
  deduplicated: boolean;
}> {
  const {
    uid,
    planId,
    idempotencyKey,
    investmentAmountInr,
    expectedPlanPriceInr,
    expectedCoinCost,
  } = params;
  const requestId = makeId('invreq');
  const reqLockId = buildDeterministicLockId('req', uid, idempotencyKey);
  const activityLogId = makeId('ulog');

  const userRef = db.collection('users').doc(uid);
  const settingsRef = db.collection('platformSettings').doc('global');
  const planRef = db.collection('productPlans').doc(planId);
  const lockRef = db.collection('investmentRequestLocks').doc(reqLockId);
  const invReqRef = db.collection('investmentRequests').doc(requestId);
  const activityRef = db.collection('userActivityLogs').doc(activityLogId);

  return db.runTransaction(async (tx) => {
    const [userSnap, settingsSnap, livePlanSnap, lockSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(settingsRef),
      tx.get(planRef),
      tx.get(lockRef),
    ]);

    if (lockSnap.exists) {
      const existingId = String(lockSnap.data()?.requestId || '');
      if (existingId) {
        const lockedReqSnap = await tx.get(db.collection('investmentRequests').doc(existingId));
        if (lockedReqSnap.exists) {
          const data = lockedReqSnap.data()!;
          const createdIso = data.createdAt?.toDate
            ? data.createdAt.toDate().toISOString()
            : new Date().toISOString();
          const updatedIso = data.updatedAt?.toDate
            ? data.updatedAt.toDate().toISOString()
            : createdIso;
          return {
            requestId: existingId,
            investmentRequest: {
              ...data,
              createdAt: createdIso,
              updatedAt: updatedIso,
            },
            deduplicated: true,
          };
        }
      }
      throw new HttpsError(
        'already-exists',
        'Duplicate investment request blocked by idempotency lock.'
      );
    }

    const complianceGate = evaluateServerComplianceGate(
      settingsSnap.exists ? (settingsSnap.data() as Record<string, unknown>) : null
    );
    if (!complianceGate.ok) {
      throw new HttpsError('failed-precondition', complianceGate.message);
    }

    if (!userSnap.exists) {
      throw new HttpsError('failed-precondition', 'Verified member profile not found.');
    }
    const userData = userSnap.data()!;
    const userId = String(userData.userId || '');
    if (userData.status !== 'ACTIVE' || !/^NX[0-9]{6,10}$/.test(userId)) {
      throw new HttpsError(
        'permission-denied',
        'Only active member accounts with a verified NX User ID can submit investment requests.'
      );
    }

    const planResolution = resolveAuthoritativePlanSpec(
      planId,
      livePlanSnap.exists ? (livePlanSnap.data() as Record<string, unknown>) : null,
      investmentAmountInr
    );
    if (!planResolution.ok) {
      throw new HttpsError(planResolution.code, planResolution.message);
    }
    const authoritativePlan = planResolution.plan;

    const amountCheck = validatePlanAmountsMatch({
      plan: authoritativePlan,
      expectedPlanPriceInr,
      expectedCoinCost,
    });
    if (!amountCheck.ok) {
      throw new HttpsError('invalid-argument', amountCheck.message);
    }

    const pendingDoc = buildPendingInvestmentRequestDoc({
      requestId,
      uid,
      userId,
      plan: authoritativePlan,
      idempotencyKey,
    });

    const nowIso = new Date().toISOString();

    tx.set(invReqRef, {
      ...pendingDoc,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.set(lockRef, {
      lockId: reqLockId,
      uid,
      userId,
      requestId,
      planId: authoritativePlan.planId,
      idempotencyKey,
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(activityRef, {
      logId: activityLogId,
      uid,
      category: 'PLAN_CHANGE',
      action: 'PLAN_INVESTMENT_REQUESTED',
      details:
        `Created investment request ${requestId} for ${authoritativePlan.productName} (${authoritativePlan.coinCost} Coins) [PENDING_VERIFICATION]`.slice(
          0,
          300
        ),
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      requestId,
      investmentRequest: {
        ...pendingDoc,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      deduplicated: false,
    };
  });
}

async function executePlanActivationTransaction(params: {
  uid: string;
  planId: string;
  requestId: string;
  idempotencyKey: string;
  paymentTxId?: string;
  depositId?: string;
  investmentAmountInr?: unknown;
  expectedPlanPriceInr?: unknown;
  expectedCoinCost?: unknown;
}) {
  const {
    uid,
    planId,
    requestId,
    idempotencyKey,
    paymentTxId,
    depositId,
    investmentAmountInr,
    expectedPlanPriceInr,
    expectedCoinCost,
  } = params;

  const lockId = buildDeterministicLockId('inv', uid, idempotencyKey);
  const userPlanId = makeId('uplan');
  const coinTxId = `ptx_${userPlanId}`;
  const activityLogId = makeId('ulog');

  const userRef = db.collection('users').doc(uid);
  const settingsRef = db.collection('platformSettings').doc('global');
  const walletRef = db.collection('coinWallets').doc(uid);
  const planRef = db.collection('productPlans').doc(planId);
  const invReqRef = db.collection('investmentRequests').doc(requestId);
  const lockRef = db.collection('investmentLocks').doc(lockId);
  const userPlanRef = db.collection('userPlans').doc(userPlanId);
  const coinTxRef = db.collection('coinTransactions').doc(coinTxId);
  const activityRef = db.collection('userActivityLogs').doc(activityLogId);
  const payTxRef = paymentTxId ? db.collection('paymentTransactions').doc(paymentTxId) : null;
  const depositRef = depositId ? db.collection('depositRequests').doc(depositId) : null;

  let outcomeError: HttpsError | null = null;

  const txResult = await db.runTransaction(async (tx) => {
    const [
      userSnap,
      settingsSnap,
      walletSnap,
      livePlanSnap,
      invReqSnap,
      lockSnap,
      payTxSnap,
      depositSnap,
    ] = await Promise.all([
      tx.get(userRef),
      tx.get(settingsRef),
      tx.get(walletRef),
      tx.get(planRef),
      tx.get(invReqRef),
      tx.get(lockRef),
      payTxRef ? tx.get(payTxRef) : Promise.resolve(null),
      depositRef ? tx.get(depositRef) : Promise.resolve(null),
    ]);

    if (!userSnap.exists) {
      throw new HttpsError('failed-precondition', 'Verified member profile not found.');
    }
    const userData = userSnap.data()!;
    const userId = String(userData.userId || '');
    if (userData.status !== 'ACTIVE' || !/^NX[0-9]{6,10}$/.test(userId)) {
      throw new HttpsError(
        'permission-denied',
        'Only active member accounts with a verified NX User ID can activate plans.'
      );
    }

    // Duplicate protection via deterministic investmentLocks doc
    if (lockSnap.exists) {
      const locked = lockSnap.data()!;
      const existingPlanSnap = locked.userPlanId
        ? await tx.get(db.collection('userPlans').doc(String(locked.userPlanId)))
        : null;
      if (existingPlanSnap?.exists) {
        const pd = existingPlanSnap.data()!;
        return {
          userPlan: {
            ...pd,
            createdAt: pd.createdAt?.toDate
              ? pd.createdAt.toDate().toISOString()
              : new Date().toISOString(),
          },
          coinTransactionId: String(locked.coinTransactionId || ''),
          newAvailableCoins: Number(walletSnap.data()?.availableCoins || 0),
          requestId: String(locked.requestId || requestId),
          status: 'ACTIVATED' as const,
          deduplicated: true,
        };
      }
      throw new HttpsError(
        'already-exists',
        'Duplicate investment transaction blocked by idempotency lock.'
      );
    }

    const complianceGate = evaluateServerComplianceGate(
      settingsSnap.exists ? (settingsSnap.data() as Record<string, unknown>) : null
    );
    if (!complianceGate.ok) {
      throw new HttpsError('failed-precondition', complianceGate.message);
    }

    let requestBoundAmount: unknown = investmentAmountInr;
    if (invReqSnap.exists) {
      const reqData = invReqSnap.data()!;
      if (reqData.uid !== uid) {
        throw new HttpsError('permission-denied', 'Investment request ownership mismatch.');
      }
      if (reqData.planId && String(reqData.planId) !== planId) {
        throw new HttpsError('invalid-argument', 'Investment request plan mismatch.');
      }
      if (reqData.status === 'ACTIVATED') {
        throw new HttpsError('already-exists', 'This investment request is already activated.');
      }
      if (reqData.status === 'REJECTED' || reqData.status === 'FAILED') {
        throw new HttpsError(
          'failed-precondition',
          `Investment request ${requestId} is in terminal status ${String(reqData.status)} and cannot be processed.`
        );
      }
      if (typeof reqData.planPriceInr === 'number' && Number.isInteger(reqData.planPriceInr)) {
        requestBoundAmount = reqData.planPriceInr;
      }
    }

    // Optional explicit payment proof verification when caller passes a paymentTxId or depositId
    if (payTxSnap) {
      if (
        !payTxSnap.exists ||
        payTxSnap.data()?.uid !== uid ||
        payTxSnap.data()?.status !== 'CREDITED'
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Payment transaction has not been verified and credited on the backend.'
        );
      }
    }
    if (depositSnap) {
      if (
        !depositSnap.exists ||
        depositSnap.data()?.uid !== uid ||
        depositSnap.data()?.status !== 'APPROVED'
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Deposit order has not been approved by payment verification yet.'
        );
      }
    }

    // Resolve authoritative plan terms strictly on the server
    const planResolution = resolveAuthoritativePlanSpec(
      planId,
      livePlanSnap.exists ? (livePlanSnap.data() as Record<string, unknown>) : null,
      requestBoundAmount
    );
    if (!planResolution.ok) {
      throw new HttpsError(planResolution.code, planResolution.message);
    }
    const planSpec: BuiltInPlanSpec = planResolution.plan;

    const amountCheck = validatePlanAmountsMatch({
      plan: planSpec,
      expectedPlanPriceInr,
      expectedCoinCost,
    });
    if (!amountCheck.ok) {
      throw new HttpsError('invalid-argument', amountCheck.message);
    }

    if (!walletSnap.exists) {
      throw new HttpsError('failed-precondition', 'Your wallet record is still initializing.');
    }

    const walletData = walletSnap.data()!;
    const prevAvailable = Math.max(0, Math.round(Number(walletData.availableCoins || 0)));
    const prevUsed = Math.max(0, Math.round(Number(walletData.coinsUsedForPlans || 0)));

    if (prevAvailable < planSpec.coinCost) {
      const shortfall = planSpec.coinCost - prevAvailable;
      const failReason = `Insufficient verified coin balance. Need ${shortfall} more Coins via verified UPI deposit.`;

      if (invReqSnap.exists) {
        tx.update(invReqRef, {
          status: 'FAILED',
          paymentStatus: 'INSUFFICIENT_BALANCE',
          failureReason: failReason.slice(0, 300),
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        tx.set(invReqRef, {
          ...buildPendingInvestmentRequestDoc({
            requestId,
            uid,
            userId,
            plan: planSpec,
            idempotencyKey,
          }),
          status: 'FAILED',
          paymentStatus: 'INSUFFICIENT_BALANCE',
          failureReason: failReason.slice(0, 300),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      outcomeError = new HttpsError('failed-precondition', failReason);
      return null;
    }

    const nextAvailable = prevAvailable - planSpec.coinCost;
    const nextUsed = prevUsed + planSpec.coinCost;
    const nowMs = Date.now();
    const startIso = new Date(nowMs).toISOString();
    const endIso = new Date(nowMs + planSpec.durationDays * 86400000).toISOString();
    const nextRewardIso = new Date(nowMs + 86400000).toISOString();

    tx.update(walletRef, {
      availableCoins: nextAvailable,
      coinsUsedForPlans: nextUsed,
      lastPlanRef: userPlanId,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const userPlanPayload = {
      userPlanId,
      uid,
      userId,
      planId: planSpec.planId,
      productName: planSpec.productName.slice(0, 120),
      imageUrl: planSpec.imageUrl.slice(0, 500),
      coinCost: planSpec.coinCost,
      durationDays: planSpec.durationDays,
      totalRewardEntitlement: planSpec.totalRewardEntitlement,
      collectedReward: 0,
      remainingReward: planSpec.totalRewardEntitlement,
      daysCompleted: 0,
      remainingDays: planSpec.durationDays,
      startDate: startIso,
      endDate: endIso,
      nextRewardEligibilityTime: nextRewardIso,
      status: 'ACTIVE',
      createdAt: FieldValue.serverTimestamp(),
    };

    tx.set(userPlanRef, userPlanPayload);

    tx.set(coinTxRef, {
      transactionId: coinTxId,
      uid,
      userId,
      type: 'PLAN_INVESTMENT',
      assetType: 'COINS',
      amount: -planSpec.coinCost,
      previousBalance: prevAvailable,
      newBalance: nextAvailable,
      referenceId: userPlanId,
      idempotencyKey,
      status: 'COMPLETED',
      description:
        `Activated ${planSpec.productName} (${planSpec.durationDays}d · ${planSpec.coinCost} Coins)`.slice(
          0,
          300
        ),
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(lockRef, {
      lockId,
      uid,
      userId,
      requestId,
      userPlanId,
      coinTransactionId: coinTxId,
      idempotencyKey,
      createdAt: FieldValue.serverTimestamp(),
    });

    if (invReqSnap.exists) {
      tx.update(invReqRef, {
        status: 'ACTIVATED',
        paymentStatus: 'VERIFIED',
        activatedUserPlanId: userPlanId,
        coinTransactionId: coinTxId,
        verifiedByUid: uid,
        activatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      tx.set(invReqRef, {
        requestId,
        uid,
        userId,
        planId: planSpec.planId,
        productName: planSpec.productName.slice(0, 120),
        planPriceInr: planSpec.planPriceInr,
        coinCost: planSpec.coinCost,
        durationDays: planSpec.durationDays,
        totalRewardEntitlement: planSpec.totalRewardEntitlement,
        acceptedTerms: true,
        idempotencyKey,
        status: 'ACTIVATED',
        paymentStatus: 'VERIFIED',
        activatedUserPlanId: userPlanId,
        coinTransactionId: coinTxId,
        verifiedByUid: uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        activatedAt: FieldValue.serverTimestamp(),
      });
    }

    tx.set(activityRef, {
      logId: activityLogId,
      uid,
      category: 'PLAN_CHANGE',
      action: 'PLAN_ACTIVATED',
      details:
        `Backend verified & activated ${planSpec.productName} (${planSpec.planId}) for ${planSpec.coinCost} Coins -> ref ${userPlanId}`.slice(
          0,
          300
        ),
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      userPlan: {
        ...userPlanPayload,
        createdAt: startIso,
      },
      coinTransactionId: coinTxId,
      newAvailableCoins: nextAvailable,
      requestId,
      status: 'ACTIVATED' as const,
      deduplicated: false,
    };
  });

  if (outcomeError) {
    throw outcomeError;
  }

  return txResult;
}

/**
 * Unified server-governed investment request validation & processing endpoint.
 * Rejects any client-supplied financial/status overrides, creates/reuses an idempotent
 * server-controlled PENDING_VERIFICATION request, verifies active NX account & wallet
 * balance, atomically debits coins, activates userPlans, transitions investmentRequests
 * to ACTIVATED (triggering email notification), and returns the authoritative record.
 */
export const processInvestmentRequest = onCall(async (request) => {
  const uid = assertAuthenticatedMember(request);
  const input = assertValidCallableInvestmentInput(request.data);
  const existingRequestId = sanitizeId((request.data as Record<string, unknown>)?.requestId);

  let requestId = existingRequestId;
  if (requestId) {
    const existingSnap = await db.collection('investmentRequests').doc(requestId).get();
    if (!existingSnap.exists) {
      throw new HttpsError('not-found', 'Referenced investment request was not found.');
    }
    if (existingSnap.data()?.uid !== uid) {
      throw new HttpsError('permission-denied', 'Investment request ownership mismatch.');
    }
  } else {
    const created = await createOrReusePendingRequestTx({
      uid,
      planId: input.planId,
      idempotencyKey: input.idempotencyKey,
      investmentAmountInr: input.investmentAmountInr,
      expectedPlanPriceInr: input.expectedPlanPriceInr,
      expectedCoinCost: input.expectedCoinCost,
    });
    requestId = created.requestId;
  }

  return executePlanActivationTransaction({
    uid,
    planId: input.planId,
    requestId,
    idempotencyKey: input.idempotencyKey,
    paymentTxId: input.paymentTxId,
    depositId: input.depositId,
    investmentAmountInr: input.investmentAmountInr,
    expectedPlanPriceInr: input.expectedPlanPriceInr,
    expectedCoinCost: input.expectedCoinCost,
  });
});

/**
 * Server-governed investment request creation.
 * Rejects tampered financial fields, verifies Firebase Auth UID and active NX member profile,
 * resolves authoritative plan specs & pricing, enforces idempotency locks, and creates
 * `investmentRequests/{requestId}` strictly in PENDING_VERIFICATION / PENDING.
 */
export const createInvestmentRequest = onCall(async (request) => {
  const uid = assertAuthenticatedMember(request);
  const input = assertValidCallableInvestmentInput(request.data);

  return createOrReusePendingRequestTx({
    uid,
    planId: input.planId,
    idempotencyKey: input.idempotencyKey,
    investmentAmountInr: input.investmentAmountInr,
    expectedPlanPriceInr: input.expectedPlanPriceInr,
    expectedCoinCost: input.expectedCoinCost,
  });
});

/**
 * Backend-verified plan investment activation.
 * Verifies user authentication, active account status, authoritative plan terms,
 * atomic idempotency lock (preventing duplicate investments), and sufficient verified
 * coin balance before debiting coinWallets and activating userPlans.
 */
export const investInPlan = onCall(async (request) => {
  const uid = assertAuthenticatedMember(request);
  const input = assertValidCallableInvestmentInput(request.data);
  const requestId = sanitizeId((request.data as Record<string, unknown>)?.requestId) || makeId('invreq');

  return executePlanActivationTransaction({
    uid,
    planId: input.planId,
    requestId,
    idempotencyKey: input.idempotencyKey,
    paymentTxId: input.paymentTxId,
    depositId: input.depositId,
    investmentAmountInr: input.investmentAmountInr,
    expectedPlanPriceInr: input.expectedPlanPriceInr,
    expectedCoinCost: input.expectedCoinCost,
  });
});

/**
 * Admin callable to create or update an investment plan with server-validated
 * economics (Min/Max INR, Duration, Expected Return %, Daily Reward %, Total Payout, Daily Earnings).
 */
export const adminSaveInvestmentPlan = onCall(async (request) => {
  const actor = await assertAdminCaller(request);
  const raw = (request.data || {}) as Record<string, unknown>;

  const rawPlanId = sanitizeId(raw.planId);
  const planId = rawPlanId && rawPlanId.length <= 64 ? rawPlanId : makeId('plan').slice(0, 64);
  const productName = String(raw.productName || '').trim().slice(0, 120);
  const category = String(raw.category || 'Structured Plan').trim().slice(0, 60);
  const description = String(raw.description || '').trim().slice(0, 600);
  const termsAndConditions = String(raw.termsAndConditions || '').trim().slice(0, 1000);
  const imageUrl = String(raw.imageUrl || '').trim().slice(0, 500);
  const isActive = raw.isActive !== false;

  const minCoins = Math.round(Number(raw.minCoins ?? raw.planPriceInr ?? 0));
  const maxCoins = Math.round(Number(raw.maxCoins ?? minCoins));
  const durationDays = Math.round(Number(raw.durationDays ?? 0));
  const rawReturnPct = Number(raw.expectedReturnPercent ?? 0);

  if (productName.length < 2) {
    throw new HttpsError('invalid-argument', 'Plan name must be at least 2 characters.');
  }
  if (description.length < 4) {
    throw new HttpsError('invalid-argument', 'Plan description is required.');
  }
  if (!Number.isInteger(minCoins) || minCoins < 1 || minCoins > 100000000) {
    throw new HttpsError(
      'invalid-argument',
      'Minimum investment must be a whole INR amount between ₹1 and ₹10,00,00,000.'
    );
  }
  if (!Number.isInteger(maxCoins) || maxCoins < minCoins || maxCoins > 100000000) {
    throw new HttpsError(
      'invalid-argument',
      'Maximum investment must be greater than or equal to the minimum investment.'
    );
  }
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365) {
    throw new HttpsError('invalid-argument', 'Investment duration must be between 1 and 365 days.');
  }
  if (!Number.isFinite(rawReturnPct) || rawReturnPct < 0 || rawReturnPct > 1000) {
    throw new HttpsError('invalid-argument', 'Expected return (%) must be between 0 and 1000.');
  }

  const expectedReturnPercent = Math.round(rawReturnPct * 100) / 100;
  const totalCoinReward = Math.max(
    minCoins,
    Math.round(minCoins * (1 + expectedReturnPercent / 100))
  );
  const dailyRewardPercent = Math.round((expectedReturnPercent / durationDays) * 100) / 100;
  const dailyCoinRewardPreview =
    Math.round(((totalCoinReward - minCoins) / durationDays) * 100) / 100;

  const planRef = db.collection('productPlans').doc(planId);
  const logRef = db.collection('adminActivityLogs').doc();

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(planRef);
    tx.set(
      planRef,
      {
        planId,
        productName,
        category,
        description,
        imageUrl,
        planPriceInr: minCoins,
        coinDeductionAmount: minCoins,
        minCoins,
        maxCoins,
        durationDays,
        expectedReturnPercent,
        dailyRewardPercent,
        totalCoinReward,
        dailyCoinRewardPreview,
        termsAndConditions:
          termsAndConditions ||
          'Returns are indicative estimates only and depend on underlying asset performance. Early exits or withdrawals follow platform settlement schedules and applicable gateway/statutory fees.',
        isActive,
        createdAt: existing.exists
          ? existing.data()?.createdAt || FieldValue.serverTimestamp()
          : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: actor.uid,
      },
      { merge: true }
    );

    tx.set(logRef, {
      logId: logRef.id,
      actorUid: actor.uid,
      actorEmail: actor.email || OWNER_ADMIN_EMAIL,
      actorRole: actor.role,
      actionType: existing.exists ? 'PLAN_UPDATED' : 'PLAN_CREATED',
      targetId: planId,
      summary: `${existing.exists ? 'Updated' : 'Created'} investment plan ${productName} (₹${minCoins}–₹${maxCoins}, ${durationDays}d, ${expectedReturnPercent}% est. return)`.slice(
        0,
        300
      ),
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    ok: true,
    planId,
    totalCoinReward,
    dailyCoinRewardPreview,
    expectedReturnPercent,
  };
});

/**
 * Admin callable to activate or deactivate an investment plan.
 */
export const adminToggleInvestmentPlanStatus = onCall(async (request) => {
  const actor = await assertAdminCaller(request);
  const planId = sanitizeId(request.data?.planId);
  const nextActive = Boolean(request.data?.isActive);

  if (!planId) {
    throw new HttpsError('invalid-argument', 'Valid planId is required.');
  }

  const planRef = db.collection('productPlans').doc(planId);
  const logRef = db.collection('adminActivityLogs').doc();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(planRef);
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Investment plan not found.');
    }
    tx.update(planRef, {
      isActive: nextActive,
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: actor.uid,
    });
    tx.set(logRef, {
      logId: logRef.id,
      actorUid: actor.uid,
      actorEmail: actor.email || OWNER_ADMIN_EMAIL,
      actorRole: actor.role,
      actionType: 'PLAN_UPDATED',
      targetId: planId,
      summary: `${nextActive ? 'Activated' : 'Deactivated'} plan ${String(
        snap.data()?.productName || planId
      )}`.slice(0, 300),
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return { ok: true, planId, isActive: nextActive };
});

/**
 * Admin callable to delete an investment plan ONLY when it has zero active investments
 * and zero pending verification requests. Otherwise forces deactivation instead.
 */
export const adminDeleteInvestmentPlan = onCall(async (request) => {
  const actor = await assertAdminCaller(request);
  const planId = sanitizeId(request.data?.planId);

  if (!planId) {
    throw new HttpsError('invalid-argument', 'Valid planId is required.');
  }

  const [activePlansSnap, pendingReqSnap] = await Promise.all([
    db
      .collection('userPlans')
      .where('planId', '==', planId)
      .where('status', '==', 'ACTIVE')
      .limit(1)
      .get(),
    db
      .collection('investmentRequests')
      .where('planId', '==', planId)
      .where('status', '==', 'PENDING_VERIFICATION')
      .limit(1)
      .get(),
  ]);

  if (!activePlansSnap.empty || !pendingReqSnap.empty) {
    throw new HttpsError(
      'failed-precondition',
      'This plan has active user investments or pending verification requests and cannot be deleted. Deactivate the plan instead to stop new enrollments.'
    );
  }

  const planRef = db.collection('productPlans').doc(planId);
  const snap = await planRef.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Investment plan not found.');
  }

  const planName = String(snap.data()?.productName || planId);
  const batch = db.batch();
  const logRef = db.collection('adminActivityLogs').doc();
  batch.delete(planRef);
  batch.set(logRef, {
    logId: logRef.id,
    actorUid: actor.uid,
    actorEmail: actor.email || OWNER_ADMIN_EMAIL,
    actorRole: actor.role,
    actionType: 'PLAN_DELETED',
    targetId: planId,
    summary: `Deleted investment plan ${planName} (${planId}) with 0 active investments`.slice(
      0,
      300
    ),
    createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();

  return { ok: true, planId };
});

/**
 * Backend-governed member withdrawal request with atomic INR wallet deduction,
 * payoutsEnabled check, verified payout destination ownership check, and idempotency lock.
 */
export const submitWalletWithdrawalFn = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication is required.');
  }

  const uid = request.auth.uid;
  const amountInr = Math.round(Number(request.data?.amountInr || 0));
  const payoutMethodId = sanitizeId(request.data?.payoutMethodId);
  const idempotencyKey =
    sanitizeId(request.data?.idempotencyKey) || `${uid}_${Date.now()}`;

  if (!payoutMethodId) {
    throw new HttpsError('invalid-argument', 'Valid verified payout method ID is required.');
  }
  if (!Number.isFinite(amountInr) || amountInr < 100 || amountInr > 500000) {
    throw new HttpsError(
      'invalid-argument',
      'Withdrawal amount must be a whole INR amount between ₹100 and ₹5,00,000.'
    );
  }

  const withdrawalId = makeId('wd');
  const coinTxId = `wtx_${withdrawalId}`;
  const lockId = sanitizeId(`wd_${uid}_${idempotencyKey}`).slice(0, 128);
  const activityLogId = makeId('ulog');

  const userRef = db.collection('users').doc(uid);
  const walletRef = db.collection('coinWallets').doc(uid);
  const settingsRef = db.collection('platformSettings').doc('global');
  const methodRef = db.collection('userPayoutMethods').doc(payoutMethodId);
  const lockRef = db.collection('withdrawalLocks').doc(lockId);
  const withdrawalRef = db.collection('withdrawalRequests').doc(withdrawalId);
  const txRef = db.collection('coinTransactions').doc(coinTxId);
  const activityRef = db.collection('userActivityLogs').doc(activityLogId);

  return db.runTransaction(async (tx) => {
    const [userSnap, walletSnap, settingsSnap, methodSnap, lockSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(walletRef),
      tx.get(settingsRef),
      tx.get(methodRef),
      tx.get(lockRef),
    ]);

    if (lockSnap.exists) {
      throw new HttpsError(
        'already-exists',
        'Duplicate withdrawal request blocked by idempotency lock.'
      );
    }

    if (!userSnap.exists || userSnap.data()?.status !== 'ACTIVE') {
      throw new HttpsError(
        'permission-denied',
        'Only active member accounts can initiate withdrawals.'
      );
    }
    const userId = String(userSnap.data()?.userId || '');
    if (!/^NX[0-9]{6,10}$/.test(userId)) {
      throw new HttpsError('failed-precondition', 'Verified NEXORA User ID is required.');
    }

    if (!settingsSnap.exists || settingsSnap.data()?.payoutsEnabled !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Real-money withdrawals are currently disabled pending regulatory and payment channel activation.'
      );
    }

    if (!methodSnap.exists || methodSnap.data()?.uid !== uid) {
      throw new HttpsError('not-found', 'Selected payout destination was not found.');
    }
    const methodData = methodSnap.data()!;
    if (methodData.verificationStatus !== 'VERIFIED') {
      throw new HttpsError(
        'failed-precondition',
        'Selected payout method must pass ownership verification before withdrawals are enabled.'
      );
    }

    if (!walletSnap.exists) {
      throw new HttpsError('failed-precondition', 'Your wallet record is still initializing.');
    }

    const prevEligibleInr = Math.max(
      0,
      Math.round(Number(walletSnap.data()?.withdrawableBalanceInr || 0))
    );
    if (amountInr > prevEligibleInr) {
      throw new HttpsError(
        'failed-precondition',
        `Requested ₹${amountInr.toLocaleString('en-IN')} exceeds your eligible INR balance (₹${prevEligibleInr.toLocaleString('en-IN')}).`
      );
    }

    const methodType = methodData.methodType === 'BANK_ACCOUNT' ? 'BANK_ACCOUNT' : 'UPI';
    const label = String(methodData.label || 'Payout').slice(0, 60);
    const destinationMasked =
      methodType === 'UPI'
        ? `${String(methodData.upiProvider || 'UPI')} · ${maskUpi(String(methodData.upiId || ''))}`
        : `${String(methodData.bankName || 'Bank')} · ${String(
            methodData.accountNumberMasked || `•••• ${String(methodData.accountLast4 || '')}`
          )} (${String(methodData.ifscCode || '')})`;

    const nextEligibleInr = prevEligibleInr - amountInr;

    tx.update(walletRef, {
      withdrawableBalanceInr: nextEligibleInr,
      lastWithdrawalRef: withdrawalId,
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.set(withdrawalRef, {
      withdrawalId,
      uid,
      userId,
      amountInr,
      payoutMethodId,
      payoutMethodType: methodType,
      payoutLabel: label,
      payoutDestinationMasked: destinationMasked.slice(0, 120),
      idempotencyKey,
      status: 'PENDING',
      remarks: `Submitted to verified ${methodType === 'UPI' ? 'UPI' : 'Bank Account'} (${label})`.slice(
        0,
        300
      ),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.set(txRef, {
      transactionId: coinTxId,
      uid,
      userId,
      type: 'WITHDRAWAL_REQUEST',
      assetType: 'INR',
      amount: -amountInr,
      previousBalance: prevEligibleInr,
      newBalance: nextEligibleInr,
      referenceId: withdrawalId,
      idempotencyKey,
      status: 'PENDING',
      description: `INR Withdrawal ₹${amountInr.toLocaleString('en-IN')} to ${destinationMasked}`.slice(
        0,
        300
      ),
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(lockRef, {
      lockId,
      uid,
      withdrawalId,
      amountInr,
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(activityRef, {
      logId: activityLogId,
      uid,
      category: 'WALLET',
      action: 'INR_WITHDRAWAL_REQUESTED',
      details:
        `Requested ₹${amountInr.toLocaleString('en-IN')} withdrawal (${withdrawalId}) to ${destinationMasked}`.slice(
          0,
          300
        ),
      createdAt: FieldValue.serverTimestamp(),
    });

    return { withdrawalId, amountInr };
  });
});

/**
 * Admin callable to approve or reject a deposit request with backend atomic
 * paymentCreditLocks enforcement and coinWallets crediting.
 */
export const adminVerifyDepositAndCredit = onCall(async (request) => {
  const actor = await assertAdminCaller(request);

  const depositId = sanitizeId(request.data?.depositId);
  const decision = String(request.data?.decision || '').toUpperCase();
  const rejectionReason = String(request.data?.rejectionReason || '').trim().slice(0, 300);
  const rawProof = request.data?.settlementProof;

  if (!depositId || (decision !== 'APPROVED' && decision !== 'REJECTED')) {
    throw new HttpsError(
      'invalid-argument',
      'depositId and decision (APPROVED or REJECTED) are required.'
    );
  }

  if (decision === 'REJECTED' && rejectionReason.length > 0 && rejectionReason.length < 3) {
    throw new HttpsError(
      'invalid-argument',
      'Rejection reason must be at least 3 characters long.'
    );
  }

  const settlementProof: Partial<DepositSettlementProofInput> | null =
    typeof rawProof === 'object' && rawProof !== null
      ? {
          verificationChannel:
            rawProof.verificationChannel === 'BANK_STATEMENT' ||
            rawProof.verificationChannel === 'GATEWAY_SETTLEMENT'
              ? rawProof.verificationChannel
              : undefined,
          externalTransactionId:
            typeof rawProof.externalTransactionId === 'string'
              ? rawProof.externalTransactionId
              : undefined,
          settlementReference:
            typeof rawProof.settlementReference === 'string'
              ? rawProof.settlementReference
              : undefined,
          reconciledAmountInr:
            typeof rawProof.reconciledAmountInr === 'number'
              ? rawProof.reconciledAmountInr
              : Number(rawProof.reconciledAmountInr),
        }
      : null;

  const { paymentTxId, creditLockId, idempotencyKey } =
    buildCanonicalDepositTxIds(depositId);

  const depositRef = db.collection('depositRequests').doc(depositId);
  const payTxRef = db.collection('paymentTransactions').doc(paymentTxId);
  const depLockRef = db.collection('paymentCreditLocks').doc(creditLockId);
  const adminLogRef = db.collection('adminActivityLogs').doc();

  const summaryInfo = await db.runTransaction(async (tx) => {
    const [depSnap, payTxSnap] = await Promise.all([tx.get(depositRef), tx.get(payTxRef)]);
    if (!depSnap.exists) {
      throw new HttpsError('not-found', 'Deposit request not found.');
    }

    const depData = depSnap.data()!;
    const currentStatus = String(depData.status || '');
    if (currentStatus === 'APPROVED' || currentStatus === 'REJECTED') {
      throw new HttpsError('failed-precondition', `Deposit already finalized (${currentStatus}).`);
    }

    const targetUid = sanitizeId(depData.uid);
    const targetUserId = String(depData.userId || '').trim();
    if (!targetUid || !/^NX[0-9]{6,10}$/.test(targetUserId)) {
      throw new HttpsError(
        'failed-precondition',
        'Deposit record is missing a valid member UID or NX User ID.'
      );
    }

    const cleanUtr = normalizeUtrRef(depData.utrNumber);
    const utrLockId = cleanUtr ? `lock_utr_${cleanUtr}`.slice(0, 128) : '';
    const verifiedAmountInr = Math.max(0, Math.round(Number(depData.amountInr || 0)));
    const baseCoins = verifiedAmountInr;
    const rawBonus =
      depData.packageId &&
      typeof depData.bonusCoins === 'number' &&
      Number.isInteger(depData.bonusCoins) &&
      depData.bonusCoins >= 0 &&
      depData.bonusCoins <= verifiedAmountInr
        ? depData.bonusCoins
        : 0;
    const totalCoins = baseCoins + rawBonus;

    if (decision === 'REJECTED') {
      const failReason = rejectionReason || 'Rejected by administrator';
      tx.update(depositRef, {
        status: 'REJECTED',
        rejectionReason: failReason,
        verifiedAt: FieldValue.serverTimestamp(),
        verifiedByAdminUid: actor.uid,
      });

      if (payTxSnap.exists) {
        const payStatus = payTxSnap.data()?.status;
        if (payStatus !== 'CREDITED' && payStatus !== 'REJECTED') {
          tx.update(payTxRef, {
            status: 'REJECTED',
            failureReason: failReason,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      } else {
        tx.set(payTxRef, {
          paymentTxId,
          depositId,
          uid: targetUid,
          userId: targetUserId,
          provider: 'UPI_GATEWAY',
          ...(cleanUtr ? { utrReference: cleanUtr } : {}),
          amountInr: verifiedAmountInr,
          coinsToCredit: totalCoins,
          ...(depData.packageId
            ? {
                packageId: String(depData.packageId),
                bonusCoins: rawBonus,
              }
            : {}),
          currency: 'INR',
          idempotencyKey,
          creditLockId,
          ...(utrLockId ? { utrLockId } : {}),
          verificationMethod: 'ADMIN_SETTLEMENT',
          webhookVerificationStatus: 'NOT_RECEIVED',
          status: 'REJECTED',
          failureReason: failReason,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }

      tx.set(adminLogRef, {
        logId: adminLogRef.id,
        actorUid: actor.uid,
        actorEmail: actor.email || 'admin@nexorainvest.example',
        actorRole: actor.role,
        actionType: 'DEPOSIT_REVIEWED',
        targetId: depositId,
        summary: `REJECTED deposit ${depositId} (${targetUserId}, ${totalCoins} Coins): ${failReason}`.slice(
          0,
          300
        ),
        createdAt: FieldValue.serverTimestamp(),
      });

      return { targetUserId, coins: totalCoins };
    }

    let plan;
    try {
      plan = validateDepositApprovalRequirements({
        deposit: {
          depositId,
          uid: targetUid,
          userId: targetUserId,
          amountInr: verifiedAmountInr,
          coinsRequested: Number(depData.coinsRequested || totalCoins),
          packageId: depData.packageId ? String(depData.packageId) : undefined,
          bonusCoins: typeof depData.bonusCoins === 'number' ? depData.bonusCoins : undefined,
          utrNumber: cleanUtr || undefined,
          screenshotUrl: depData.screenshotUrl ? String(depData.screenshotUrl) : undefined,
          status: currentStatus,
        },
        settlementProof,
        existingGatewayVerification: payTxSnap.exists
          ? {
              webhookVerificationStatus: String(payTxSnap.data()?.webhookVerificationStatus || ''),
              gatewayPaymentId: payTxSnap.data()?.gatewayPaymentId
                ? String(payTxSnap.data()?.gatewayPaymentId)
                : undefined,
              gatewayOrderId: payTxSnap.data()?.gatewayOrderId
                ? String(payTxSnap.data()?.gatewayOrderId)
                : undefined,
              amountInr: Number(payTxSnap.data()?.amountInr || 0),
              status: String(payTxSnap.data()?.status || ''),
            }
          : null,
      });
    } catch (validationErr) {
      if (validationErr instanceof DepositVerificationError) {
        throw new HttpsError(validationErr.code, validationErr.message);
      }
      throw validationErr;
    }

    const utrLockRef = plan.utrLockId
      ? db.collection('paymentCreditLocks').doc(plan.utrLockId)
      : null;
    const extLockRef = db.collection('paymentCreditLocks').doc(plan.externalLockId);
    const walletRef = db.collection('coinWallets').doc(plan.targetUid);
    const txRef = db.collection('coinTransactions').doc(plan.coinTxId);

    const [depLockSnap, utrLockSnap, extLockSnap, coinTxSnap, walletSnap] = await Promise.all([
      tx.get(depLockRef),
      utrLockRef ? tx.get(utrLockRef) : Promise.resolve(null),
      tx.get(extLockRef),
      tx.get(txRef),
      tx.get(walletRef),
    ]);

    if (
      depLockSnap.exists ||
      utrLockSnap?.exists ||
      extLockSnap.exists ||
      coinTxSnap.exists ||
      (payTxSnap.exists && payTxSnap.data()?.status === 'CREDITED')
    ) {
      throw new HttpsError(
        'already-exists',
        'Duplicate coin credit blocked: an immutable credit lock already exists for this deposit, UTR, or bank/gateway transaction reference.'
      );
    }

    if (!walletSnap.exists) {
      throw new HttpsError('failed-precondition', 'Member coin wallet does not exist yet.');
    }

    const prev = Number(walletSnap.data()?.availableCoins || 0);
    const purchasedPrev = Number(walletSnap.data()?.purchasedCoins || 0);
    const earnedPrev = Number(walletSnap.data()?.earnedCoins || 0);
    const next = prev + plan.totalCoins;

    tx.update(depositRef, {
      status: 'APPROVED',
      rejectionReason: '',
      verifiedAt: FieldValue.serverTimestamp(),
      verifiedByAdminUid: actor.uid,
      verificationChannel: plan.verificationChannel,
      externalTransactionId: plan.externalTransactionId,
      settlementReference: plan.settlementReference,
      reconciledAmountInr: plan.reconciledAmountInr,
    });

    tx.update(walletRef, {
      availableCoins: next,
      purchasedCoins: purchasedPrev + plan.baseCoins,
      earnedCoins: earnedPrev + plan.bonusCoins,
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.set(txRef, {
      transactionId: plan.coinTxId,
      uid: plan.targetUid,
      userId: plan.targetUserId,
      type: 'COIN_PURCHASE',
      amount: plan.totalCoins,
      previousBalance: prev,
      newBalance: next,
      referenceId: plan.externalTransactionId || plan.cleanUtr || plan.depositId,
      idempotencyKey: plan.idempotencyKey,
      status: 'COMPLETED',
      description:
        plan.bonusCoins > 0
          ? `Approved INR ₹${plan.verifiedAmountInr} deposit (+${plan.bonusCoins} Package Bonus Coins) [${plan.verificationChannel}: ${plan.externalTransactionId}]`
          : `Approved INR ₹${plan.verifiedAmountInr} deposit [${plan.verificationChannel}: ${plan.externalTransactionId}]`,
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(depLockRef, {
      lockId: plan.creditLockId,
      lockScope: 'DEPOSIT_ORDER',
      paymentTxId: plan.paymentTxId,
      depositId: plan.depositId,
      uid: plan.targetUid,
      userId: plan.targetUserId,
      coinsCredited: plan.totalCoins,
      coinTransactionId: plan.coinTxId,
      createdByUid: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(extLockRef, {
      lockId: plan.externalLockId,
      lockScope: 'GATEWAY_PAYMENT',
      paymentTxId: plan.paymentTxId,
      depositId: plan.depositId,
      uid: plan.targetUid,
      userId: plan.targetUserId,
      coinsCredited: plan.totalCoins,
      coinTransactionId: plan.coinTxId,
      createdByUid: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
    });

    if (utrLockRef && plan.utrLockId) {
      tx.set(utrLockRef, {
        lockId: plan.utrLockId,
        lockScope: 'UTR_REFERENCE',
        paymentTxId: plan.paymentTxId,
        depositId: plan.depositId,
        uid: plan.targetUid,
        userId: plan.targetUserId,
        coinsCredited: plan.totalCoins,
        coinTransactionId: plan.coinTxId,
        createdByUid: actor.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    if (payTxSnap.exists) {
      const payStatus = payTxSnap.data()?.status;
      if (payStatus !== 'CREDITED' && payStatus !== 'REJECTED') {
        tx.update(payTxRef, {
          ...(plan.utrLockId ? { utrLockId: plan.utrLockId } : {}),
          gatewayPaymentId: plan.externalTransactionId.slice(0, 128),
          gatewayOrderId: plan.settlementReference.slice(0, 128),
          verificationMethod: plan.verificationMethod,
          webhookVerificationStatus: plan.webhookVerificationStatus,
          status: 'CREDITED',
          coinTransactionId: plan.coinTxId,
          updatedAt: FieldValue.serverTimestamp(),
          creditedAt: FieldValue.serverTimestamp(),
        });
      }
    } else {
      tx.set(payTxRef, {
        paymentTxId: plan.paymentTxId,
        depositId: plan.depositId,
        uid: plan.targetUid,
        userId: plan.targetUserId,
        provider: 'UPI_GATEWAY',
        gatewayOrderId: plan.settlementReference.slice(0, 128),
        gatewayPaymentId: plan.externalTransactionId.slice(0, 128),
        ...(plan.cleanUtr ? { utrReference: plan.cleanUtr } : {}),
        amountInr: plan.verifiedAmountInr,
        coinsToCredit: plan.totalCoins,
        ...(depData.packageId
          ? {
              packageId: String(depData.packageId),
              bonusCoins: plan.bonusCoins,
            }
          : {}),
        currency: 'INR',
        idempotencyKey: plan.idempotencyKey,
        creditLockId: plan.creditLockId,
        ...(plan.utrLockId ? { utrLockId: plan.utrLockId } : {}),
        verificationMethod: plan.verificationMethod,
        webhookVerificationStatus: plan.webhookVerificationStatus,
        status: 'CREDITED',
        coinTransactionId: plan.coinTxId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        creditedAt: FieldValue.serverTimestamp(),
      });
    }

    tx.set(adminLogRef, {
      logId: adminLogRef.id,
      actorUid: actor.uid,
      actorEmail: actor.email || 'admin@nexorainvest.example',
      actorRole: actor.role,
      actionType: 'DEPOSIT_REVIEWED',
      targetId: plan.depositId,
      summary: `APPROVED deposit ${plan.depositId} (${plan.targetUserId}, ${plan.totalCoins} Coins) via ${plan.verificationChannel} (${plan.externalTransactionId})`.slice(
        0,
        300
      ),
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      targetUserId: plan.targetUserId,
      coins: plan.totalCoins,
      coinTxId: plan.coinTxId,
      externalTransactionId: plan.externalTransactionId,
    };
  });

  return {
    ok: true,
    depositId,
    decision,
    coinsCredited: decision === 'APPROVED' ? summaryInfo.coins : 0,
    coinTransactionId: 'coinTxId' in summaryInfo ? summaryInfo.coinTxId : undefined,
    externalTransactionId:
      'externalTransactionId' in summaryInfo ? summaryInfo.externalTransactionId : undefined,
  };
});

/**
 * Admin callable to transition withdrawal statuses and atomically refund
 * Eligible INR balance on REJECTED without modifying Coin balances.
 */
export const adminReviewWithdrawalFn = onCall(async (request) => {
  const actor = await assertAdminCaller(request);

  const withdrawalId = sanitizeId(request.data?.withdrawalId);
  const nextStatus = String(request.data?.nextStatus || '').toUpperCase();
  const remarks = String(request.data?.remarks || '').trim().slice(0, 300);

  if (
    !withdrawalId ||
    !['PROCESSING', 'APPROVED', 'COMPLETED', 'PAID', 'REJECTED'].includes(nextStatus)
  ) {
    throw new HttpsError('invalid-argument', 'Valid withdrawalId and nextStatus are required.');
  }

  const wdRef = db.collection('withdrawalRequests').doc(withdrawalId);
  const refundTxId = `wref_${withdrawalId}`;
  const txRef = db.collection('coinTransactions').doc(refundTxId);

  const summary = await db.runTransaction(async (tx) => {
    const wdSnap = await tx.get(wdRef);
    if (!wdSnap.exists) {
      throw new HttpsError('not-found', 'Withdrawal request not found.');
    }

    const wdData = wdSnap.data()!;
    const curr = String(wdData.status || '');
    if (curr === 'COMPLETED' || curr === 'PAID' || curr === 'REJECTED') {
      throw new HttpsError('failed-precondition', `Withdrawal already finalized (${curr}).`);
    }

    const targetUid = sanitizeId(wdData.uid);
    const targetUserId = String(wdData.userId || '').trim();
    if (!targetUid || !targetUserId) {
      throw new HttpsError(
        'failed-precondition',
        'Withdrawal record is missing a valid member UID or User ID.'
      );
    }
    const amountInr = Math.max(0, Math.round(Number(wdData.amountInr || 0)));
    const walletRef = db.collection('coinWallets').doc(targetUid);

    const [walletSnap, refundTxSnap] = await Promise.all([
      tx.get(walletRef),
      nextStatus === 'REJECTED' ? tx.get(txRef) : Promise.resolve(null),
    ]);

    const isCompletion = nextStatus === 'COMPLETED' || nextStatus === 'PAID';
    tx.update(wdRef, {
      status: nextStatus,
      remarks: (remarks || `Processed (${nextStatus}) by ${actor.email || actor.uid}`).slice(0, 300),
      updatedAt: FieldValue.serverTimestamp(),
      ...(isCompletion ? { paidAt: FieldValue.serverTimestamp() } : {}),
    });

    if (nextStatus === 'REJECTED' && walletSnap.exists && !refundTxSnap?.exists) {
      const prevInr = Number(walletSnap.data()?.withdrawableBalanceInr || 0);
      const nextInr = prevInr + amountInr;
      tx.update(walletRef, {
        withdrawableBalanceInr: nextInr,
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(txRef, {
        transactionId: refundTxId,
        uid: targetUid,
        userId: targetUserId,
        type: 'WITHDRAWAL_REFUND',
        assetType: 'INR',
        amount: amountInr,
        previousBalance: prevInr,
        newBalance: nextInr,
        referenceId: withdrawalId,
        idempotencyKey: `${withdrawalId}_refund`,
        status: 'COMPLETED',
        description: `Refunded rejected withdrawal ₹${amountInr.toLocaleString('en-IN')} to Eligible INR Balance`,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    return { targetUserId, amountInr };
  });

  const logRef = db.collection('adminActivityLogs').doc();
  await logRef.set({
    logId: logRef.id,
    actorUid: actor.uid,
    actorEmail: actor.email || 'admin@nexorainvest.example',
    actorRole: actor.role,
    actionType: 'WITHDRAWAL_REVIEWED',
    targetId: withdrawalId,
    summary: `Marked withdrawal ${withdrawalId} (${summary.targetUserId}, ₹${summary.amountInr}) as ${nextStatus}`,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { ok: true, withdrawalId, nextStatus };
});

async function enqueueActivationEmailIfTransitioned(params: {
  sourceCollection: 'userPlans' | 'investmentRequests';
  docId: string;
  beforeData: Record<string, unknown> | undefined;
  afterData: Record<string, unknown> | undefined;
}): Promise<void> {
  if (!params.beforeData || !params.afterData) {
    return;
  }

  if (!isPendingToActiveTransition(params.beforeData.status, params.afterData.status)) {
    return;
  }

  const uid = String(params.afterData.uid || '').trim();
  if (!uid) {
    logger.warn('Skipping activation email: missing uid on investment document.', {
      sourceCollection: params.sourceCollection,
      docId: params.docId,
    });
    return;
  }

  const userSnap = await db.collection('users').doc(uid).get();
  const userData = userSnap.exists ? userSnap.data() : undefined;

  let recipientEmail = isValidEmailAddress(userData?.email) ? userData!.email.trim() : '';
  let fullName = typeof userData?.fullName === 'string' ? userData.fullName : '';
  const userId = String(userData?.userId || params.afterData.userId || '').trim();

  if (!recipientEmail) {
    try {
      const authRecord = await admin.auth().getUser(uid);
      if (isValidEmailAddress(authRecord.email)) {
        recipientEmail = authRecord.email.trim();
      }
      if (!fullName && authRecord.displayName) {
        fullName = authRecord.displayName;
      }
    } catch (authErr) {
      logger.warn('Unable to look up Firebase Auth user for activation email.', {
        uid,
        error: String(authErr),
      });
    }
  }

  if (!isValidEmailAddress(recipientEmail)) {
    logger.info('No verified email on profile; skipping Trigger Email notification.', {
      uid,
      sourceCollection: params.sourceCollection,
      docId: params.docId,
    });
    return;
  }

  const referenceId = String(
    params.afterData.activatedUserPlanId || params.afterData.userPlanId || params.docId
  ).trim();
  const planId = String(params.afterData.planId || '').trim();
  const productName = String(params.afterData.productName || 'Structured Plan').trim();
  const mailDocId = buildMailDocumentId(params.afterData, params.docId);

  const emailDoc = buildPlanActivationEmailPayload({
    toEmail: recipientEmail,
    fullName,
    userId,
    productName,
    planId,
    referenceId,
    coinCost: Number(params.afterData.coinCost || 0),
    durationDays: Number(params.afterData.durationDays || 0),
    totalRewardEntitlement: Number(params.afterData.totalRewardEntitlement || 0),
    startDate:
      typeof params.afterData.startDate === 'string' ? params.afterData.startDate : undefined,
    endDate: typeof params.afterData.endDate === 'string' ? params.afterData.endDate : undefined,
  });

  try {
    await db
      .collection(MAIL_COLLECTION)
      .doc(mailDocId)
      .create({
        ...emailDoc,
        uid,
        userId,
        planId,
        referenceId,
        sourceCollection: params.sourceCollection,
        createdAt: FieldValue.serverTimestamp(),
      });

    logger.info('Queued plan activation email for Firebase Trigger Email extension.', {
      uid,
      mailDocId,
      mailCollection: MAIL_COLLECTION,
      sourceCollection: params.sourceCollection,
      referenceId,
    });
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? (err as { code: unknown }).code
        : undefined;
    // Firestore ALREADY_EXISTS (6): notification was already queued for this plan activation
    if (code === 6 || code === 'already-exists') {
      logger.info('Activation email already queued; skipping duplicate delivery.', {
        mailDocId,
        referenceId,
      });
      return;
    }
    throw err;
  }

  const logId = makeId('ulog');
  await db
    .collection('userActivityLogs')
    .doc(logId)
    .set({
      logId,
      uid,
      category: 'PLAN_CHANGE',
      action: 'PLAN_ACTIVATION_EMAIL_QUEUED',
      details: `Queued activation notification email for ${productName} (${referenceId}) -> ${mailDocId}`.slice(
        0,
        300
      ),
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch(() => undefined);
}

/**
 * Automated Firebase Extension ("Trigger Email from Firestore") dispatcher.
 * Fires whenever a `userPlans/{userPlanId}` document transitions from
 * 'pending' / 'PENDING' / 'PENDING_VERIFICATION' to 'active' / 'ACTIVE' / 'ACTIVATED'.
 */
export const notifyUserOnUserPlanActivated = onDocumentUpdated(
  {
    document: 'userPlans/{userPlanId}',
    database: DATABASE_ID,
  },
  async (event) => {
    if (!event.data) return;
    await enqueueActivationEmailIfTransitioned({
      sourceCollection: 'userPlans',
      docId: event.params.userPlanId,
      beforeData: event.data.before.data(),
      afterData: event.data.after.data(),
    });
  }
);

/**
 * Automated Firebase Extension ("Trigger Email from Firestore") dispatcher.
 * Fires whenever an `investmentRequests/{requestId}` document transitions from
 * 'PENDING_VERIFICATION' / 'pending' to 'ACTIVATED' / 'active'.
 */
export const notifyUserOnInvestmentRequestActivated = onDocumentUpdated(
  {
    document: 'investmentRequests/{requestId}',
    database: DATABASE_ID,
  },
  async (event) => {
    if (!event.data) return;
    await enqueueActivationEmailIfTransitioned({
      sourceCollection: 'investmentRequests',
      docId: event.params.requestId,
      beforeData: event.data.before.data(),
      afterData: event.data.after.data(),
    });
  }
);

