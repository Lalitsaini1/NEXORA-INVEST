import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import firebaseConfig from '../../firebase-applet-config.json';

if (!admin.apps.length) {
  admin.initializeApp({ projectId: firebaseConfig.projectId });
}

const db = admin.firestore(
  firebaseConfig.firestoreDatabaseId || '(default)'
);

const SUPER_ADMIN_UID = 'wZQCw7fXrWQCn5HqdSjS6RQHVyi1';
const SUPER_ADMIN_EMAILS = new Set([
  'saini.lalit278@gmail.com',
  'sainil.lalit278@gmail.com',
]);

async function assertSuperAdminCaller(request: {
  auth?: { uid: string; token: Record<string, unknown> };
}) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication is required.');
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
    .toLowerCase();
  const mobile = String(request.auth.token.phone_number || request.data?.mobile || '').trim();

  if (fullName.length < 2 || fullName.length > 80) {
    throw new HttpsError('invalid-argument', 'Full name must be between 2 and 80 characters.');
  }

  const userRef = db.collection('users').doc(uid);
  const walletRef = db.collection('coinWallets').doc(uid);
  const counterRef = db.collection('counters').doc('userIds');

  const result = await db.runTransaction(async (tx) => {
    const existing = await tx.get(userRef);
    if (existing.exists) {
      return existing.data();
    }

    const counterSnap = await tx.get(counterRef);
    const nextNum = counterSnap.exists ? Number(counterSnap.data()?.nextNumber || 100001) : 100001;
    const assignedUserId = `NX${nextNum}`;

    tx.set(
      counterRef,
      {
        nextNumber: nextNum + 1,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

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
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    tx.set(userRef, profile);
    tx.set(walletRef, {
      uid,
      userId: assignedUserId,
      availableCoins: 0,
      purchasedCoins: 0,
      earnedCoins: 0,
      coinsUsedForPlans: 0,
      pendingTransactionCoins: 0,
      withdrawableBalanceInr: 0,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

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
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await batch.commit();
  return { ok: true, targetUid, role: nextRole };
});
