/**
 * Trusted server-side Firebase Admin SDK setup script for the NEXORA INVEST
 * project owner Admin account.
 *
 * Project ID : nexora-invest-e4399
 * Database ID: ai-studio-nexorainvest-c25f96bd-2963-4ef8-b030-e5a6fe625870
 * Owner Email: saini.lalit278@gmail.com
 *
 * Security guarantees:
 * - Uses Application Default Credentials (never commits or requests service account JSON keys).
 * - Never hardcodes or generates fake passwords.
 * - Verifies the account matches saini.lalit278@gmail.com before assigning SUPER_ADMIN claims.
 *
 * Usage (from repository root after `gcloud auth application-default login` as project owner):
 *   node functions/scripts/setupOwnerAdmin.mjs
 *   node functions/scripts/setupOwnerAdmin.mjs --create   # Creates passwordless Auth account if missing
 */

import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'nexora-invest-e4399';
const DATABASE_ID = 'ai-studio-nexorainvest-c25f96bd-2963-4ef8-b030-e5a6fe625870';
const OWNER_ADMIN_EMAIL = 'saini.lalit278@gmail.com';

const shouldCreateIfMissing = process.argv.includes('--create');

async function main() {
  const app = getApps().length ? getApps()[0] : initializeApp({ projectId: PROJECT_ID });
  const auth = getAuth(app);
  const db = getFirestore(app, DATABASE_ID);

  let userRecord = null;
  try {
    userRecord = await auth.getUserByEmail(OWNER_ADMIN_EMAIL);
  } catch (err) {
    const code = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : '';
    if (code !== 'auth/user-not-found') {
      throw err;
    }
  }

  if (!userRecord) {
    if (!shouldCreateIfMissing) {
      console.error(
        `Firebase Auth user "${OWNER_ADMIN_EMAIL}" does not exist yet in project "${PROJECT_ID}".\n` +
          `Create the user in Firebase Console (Authentication -> Users -> Add user) or re-run with --create:\n` +
          `  node functions/scripts/setupOwnerAdmin.mjs --create\n` +
          `Then set a real password via the app's Reset Password flow (/reset-password).`
      );
      process.exitCode = 2;
      return;
    }

    // Create passwordless Firebase Auth record (no fake/hardcoded password).
    // The owner sets their own password securely via Firebase Password Reset email.
    userRecord = await auth.createUser({
      email: OWNER_ADMIN_EMAIL,
      emailVerified: true,
      displayName: 'NEXORA Owner Super Admin',
      disabled: false,
    });
    console.log(`Created Firebase Auth user (passwordless) for ${OWNER_ADMIN_EMAIL}: UID=${userRecord.uid}`);
  } else if (!userRecord.emailVerified) {
    userRecord = await auth.updateUser(userRecord.uid, { emailVerified: true });
    console.log(`Marked ${OWNER_ADMIN_EMAIL} emailVerified=true for UID=${userRecord.uid}`);
  }

  if ((userRecord.email || '').trim().toLowerCase() !== OWNER_ADMIN_EMAIL) {
    throw new Error(`Refusing to assign SUPER_ADMIN: resolved email mismatch.`);
  }

  const nextClaims = {
    ...(userRecord.customClaims || {}),
    role: 'SUPER_ADMIN',
    super_admin: true,
    admin: true,
  };
  await auth.setCustomUserClaims(userRecord.uid, nextClaims);

  const adminRef = db.collection('adminUsers').doc(userRecord.uid);
  const userRef = db.collection('users').doc(userRecord.uid);
  const logRef = db.collection('adminActivityLogs').doc();

  await db.runTransaction(async (tx) => {
    const [adminSnap, userSnap] = await Promise.all([tx.get(adminRef), tx.get(userRef)]);

    tx.set(
      adminRef,
      {
        uid: userRecord.uid,
        email: OWNER_ADMIN_EMAIL,
        displayName: (userRecord.displayName || 'NEXORA Owner Super Admin').slice(0, 80),
        role: 'SUPER_ADMIN',
        active: true,
        createdByUid: userRecord.uid,
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
          emailVerified: true,
          status: 'ACTIVE',
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    tx.set(logRef, {
      logId: logRef.id,
      actorUid: userRecord.uid,
      actorEmail: OWNER_ADMIN_EMAIL,
      actorRole: 'SUPER_ADMIN',
      actionType: 'USER_PROMOTED_TO_ADMIN',
      targetId: userRecord.uid,
      summary: `Admin SDK assigned SUPER_ADMIN custom claims and adminUsers record for ${OWNER_ADMIN_EMAIL}`,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  console.log(
    JSON.stringify(
      {
        status: 'OK',
        projectId: PROJECT_ID,
        databaseId: DATABASE_ID,
        uid: userRecord.uid,
        email: OWNER_ADMIN_EMAIL,
        role: 'SUPER_ADMIN',
        claimsAssigned: ['role=SUPER_ADMIN', 'super_admin=true', 'admin=true'],
        nextStep:
          'Set or reset your password via /reset-password?email=saini.lalit278@gmail.com&from=admin, then sign in at /admin/login.',
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error('setupOwnerAdmin failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
