/**
 * TEMPORARY DIAGNOSTIC UTILITY SCRIPT — debugPermissions.ts
 *
 * Attempts a write operation to `investmentRequests/{requestId}` on Firebase project
 * `nexora-invest-e4399` (database `ai-studio-nexorainvest-c25f96bd-2963-4ef8-b030-e5a6fe625870`)
 * inside a `try / catch` block, logs the full `FirebaseError` (`code`, `message`,
 * `name`, `customData`), and cross-references `diagnoseInvestmentRequestRules` to
 * pinpoint the exact Firestore security rule condition causing the permission failure.
 *
 * Safe to run: never modifies wallet balances, payment records, or existing user data.
 * Remove this temporary script once debugging is complete.
 */

import path from 'node:path';
import { deleteApp, FirebaseError, getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  doc,
  Firestore,
  getDoc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
  terminate,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { ILLUSTRATIVE_PLANS } from '../src/data/catalogPreview';
import {
  buildExpectedInvestmentRequestPayload,
  diagnoseInvestmentRequestRules,
  extractFirestoreWriteErrorDetails,
  InvestmentRequestAuthContext,
  InvestmentRequestRuleDiagnosticReport,
} from '../src/utils/investmentRulesDiagnostic';

export enum DebugOperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface DebugPermissionsOptions {
  requestId?: string;
  uid?: string;
  userId?: string;
  planId?: string;
  email?: string;
  password?: string;
  payloadOverrides?: Record<string, unknown>;
}

export interface DebugFirebaseErrorSnapshot {
  isFirebaseError: boolean;
  name: string;
  code: string | null;
  message: string;
  customData?: Record<string, unknown>;
  stack?: string;
}

export interface DebugPermissionsResult {
  attemptedAt: string;
  projectId: string;
  databaseId: string;
  operationType: DebugOperationType;
  documentPath: string;
  authContext: InvestmentRequestAuthContext;
  attemptedPayload: Record<string, unknown>;
  writeSucceeded: boolean;
  firebaseError: DebugFirebaseErrorSnapshot | null;
  ruleEvaluation: InvestmentRequestRuleDiagnosticReport;
  prerequisiteReadNotes: Record<string, string>;
}

export interface DebugPermissionsDependencies {
  db?: Firestore;
  auth?: Auth;
  writeFn?: (documentPath: string, payload: Record<string, unknown>) => Promise<void>;
  readDocFn?: (collectionName: string, docId: string) => Promise<Record<string, unknown> | null>;
  checkConnectionFn?: () => Promise<void>;
  logger?: Pick<Console, 'log' | 'error' | 'warn'>;
}

function getFirebaseClientInstances(): {
  app: ReturnType<typeof initializeApp>;
  db: Firestore;
  auth: Auth;
  createdApp: boolean;
} {
  const existingApp = getApps()[0];
  const app = existingApp ?? initializeApp(firebaseConfig);
  const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  const auth = getAuth(app);
  return { app, db, auth, createdApp: !existingApp };
}

export function serializeFirebaseError(err: unknown): DebugFirebaseErrorSnapshot {
  if (err instanceof FirebaseError) {
    return {
      isFirebaseError: true,
      name: err.name,
      code: err.code,
      message: err.message,
      customData: err.customData as Record<string, unknown> | undefined,
      stack: err.stack,
    };
  }

  const extracted = extractFirestoreWriteErrorDetails(err);
  if (err instanceof Error) {
    return {
      isFirebaseError: false,
      name: err.name,
      code: extracted.code,
      message: err.message,
      stack: err.stack,
    };
  }

  return {
    isFirebaseError: false,
    name: 'UnknownError',
    code: extracted.code,
    message: String(err),
  };
}

export function parseDebugPermissionsCliArgs(argv: string[]): DebugPermissionsOptions {
  const opts: DebugPermissionsOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--request-id' && argv[i + 1]) {
      opts.requestId = argv[++i];
    } else if (arg === '--uid' && argv[i + 1]) {
      opts.uid = argv[++i];
    } else if (arg === '--user-id' && argv[i + 1]) {
      opts.userId = argv[++i];
    } else if (arg === '--plan-id' && argv[i + 1]) {
      opts.planId = argv[++i];
    } else if (arg === '--email' && argv[i + 1]) {
      opts.email = argv[++i];
    } else if (arg === '--password' && argv[i + 1]) {
      opts.password = argv[++i];
    }
  }
  return opts;
}

export async function debugInvestmentRequestsWritePermissions(
  options: DebugPermissionsOptions = {},
  deps: DebugPermissionsDependencies = {}
): Promise<DebugPermissionsResult> {
  const logger = deps.logger ?? console;
  const projectId = firebaseConfig.projectId;
  const databaseId = firebaseConfig.firestoreDatabaseId;
  const instances =
    deps.db && deps.auth
      ? { app: null, db: deps.db, auth: deps.auth, createdApp: false }
      : getFirebaseClientInstances();
  const { db, auth } = instances;

  const email = options.email ?? process.env.DEBUG_FIREBASE_EMAIL;
  const password = options.password ?? process.env.DEBUG_FIREBASE_PASSWORD;
  let signedInTemporarily = false;

  if (email && password && !deps.writeFn) {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      signedInTemporarily = true;
    } catch (authErr) {
      const authSnapshot = serializeFirebaseError(authErr);
      logger.error('[debugPermissions] Optional sign-in failed:', {
        code: authSnapshot.code,
        message: authSnapshot.message,
      });
    }
  }

  try {
    // Connection check per Firebase SDK error-handling guidelines
    if (deps.checkConnectionFn) {
      await deps.checkConnectionFn();
    } else {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (connErr) {
        if (connErr instanceof Error && connErr.message.includes('the client is offline')) {
          logger.error('[debugPermissions] Firestore client is offline. Check Firebase config.');
        }
      }
    }

    const currentUser = auth.currentUser;
    let signInProvider: string | null =
      currentUser?.providerData?.[0]?.providerId ?? null;
    if (currentUser) {
      try {
        const tokenResult = await currentUser.getIdTokenResult();
        if (tokenResult.signInProvider) {
          signInProvider = tokenResult.signInProvider;
        }
      } catch {
        // Keep providerData fallback
      }
    }

    const authContext: InvestmentRequestAuthContext = {
      isAuthenticated: Boolean(currentUser),
      uid: currentUser?.uid ?? null,
      email: currentUser?.email ?? null,
      emailVerified: Boolean(currentUser?.emailVerified),
      signInProvider,
      isAnonymous: Boolean(currentUser?.isAnonymous),
    };

    const requestId =
      options.requestId?.trim() ||
      `debug_perm_invreq_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const documentPath = `investmentRequests/${requestId}`;

    const selectedPlan =
      ILLUSTRATIVE_PLANS.find((p) => p.planId === options.planId) ?? ILLUSTRATIVE_PLANS[0];

    const effectiveUid = options.uid?.trim() || authContext.uid || 'debug_unauthenticated_uid';
    const effectiveUserId = options.userId?.trim() || 'NX100001';

    const attemptedPayload: Record<string, unknown> = {
      ...buildExpectedInvestmentRequestPayload({
        requestId,
        uid: effectiveUid,
        userId: effectiveUserId,
        plan: selectedPlan,
        acceptedTerms: true,
        idempotencyKey: `idem_${requestId}`,
        createdAtSentinel: serverTimestamp(),
        updatedAtSentinel: serverTimestamp(),
      }),
      ...(options.payloadOverrides ?? {}),
    };

    const prerequisiteReadNotes: Record<string, string> = {};
    const readDoc =
      deps.readDocFn ??
      (async (collectionName: string, docId: string) => {
        const snap = await getDoc(doc(db, collectionName, docId));
        return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
      });

    let userProfileDoc: Record<string, unknown> | null = null;
    let productPlanDoc: Record<string, unknown> | null = null;
    let existingRequestDoc: Record<string, unknown> | null = null;

    await Promise.all([
      authContext.uid
        ? readDoc('users', authContext.uid)
            .then((data) => {
              userProfileDoc = data;
            })
            .catch((err) => {
              const snap = serializeFirebaseError(err);
              prerequisiteReadNotes[`users/${authContext.uid}`] =
                `${snap.code || snap.name}: ${snap.message}`;
            })
        : Promise.resolve().then(() => {
            prerequisiteReadNotes['users/<uid>'] = 'Skipped (no active authenticated user)';
          }),

      readDoc('productPlans', selectedPlan.planId)
        .then((data) => {
          productPlanDoc = data;
        })
        .catch((err) => {
          const snap = serializeFirebaseError(err);
          prerequisiteReadNotes[`productPlans/${selectedPlan.planId}`] =
            `${snap.code || snap.name}: ${snap.message}`;
        }),

      readDoc('investmentRequests', requestId)
        .then((data) => {
          existingRequestDoc = data;
        })
        .catch((err) => {
          const snap = serializeFirebaseError(err);
          prerequisiteReadNotes[documentPath] = `${snap.code || snap.name}: ${snap.message}`;
        }),
    ]);

    logger.log(`[debugPermissions] Project: ${projectId} | Database: ${databaseId}`);
    logger.log(`[debugPermissions] Attempting Firestore setDoc on: ${documentPath}`);
    logger.log(`[debugPermissions] Auth state:`, authContext);

    let writeSucceeded = false;
    let firebaseError: DebugFirebaseErrorSnapshot | null = null;

    try {
      if (deps.writeFn) {
        await deps.writeFn(documentPath, attemptedPayload);
      } else {
        await setDoc(doc(db, 'investmentRequests', requestId), attemptedPayload);
      }
      writeSucceeded = true;
      logger.log(
        `[debugPermissions] Write SUCCEEDED on ${documentPath} (all live Firestore rules passed).`
      );
    } catch (error: unknown) {
      firebaseError = serializeFirebaseError(error);

      logger.error('[debugPermissions] Write FAILED — Detailed FirebaseError caught:', {
        name: firebaseError.name,
        code: firebaseError.code,
        message: firebaseError.message,
        customData: firebaseError.customData,
        isFirebaseError: firebaseError.isFirebaseError,
        operationType: DebugOperationType.CREATE,
        path: documentPath,
        authInfo: {
          uid: authContext.uid,
          email: authContext.email,
          emailVerified: authContext.emailVerified,
          isAnonymous: authContext.isAnonymous,
          signInProvider: authContext.signInProvider,
        },
        rawError: error,
      });
    }

    const ruleEvaluation = diagnoseInvestmentRequestRules({
      operation: 'create',
      requestId,
      auth: authContext,
      incomingData: attemptedPayload,
      existingRequestDoc,
      userProfileDoc,
      productPlanDoc,
      databaseId,
    });

    if (!writeSucceeded) {
      if (ruleEvaluation.firstDenyingCondition) {
        logger.error('[debugPermissions] Pinpointed failing Firestore security rule condition:', {
          conditionId: ruleEvaluation.firstDenyingCondition.id,
          firestoreRulesLocation: ruleEvaluation.firstDenyingCondition.firestoreRulesLocation,
          ruleExpression: ruleEvaluation.firstDenyingCondition.ruleExpression,
          expected: ruleEvaluation.firstDenyingCondition.expected,
          actual: ruleEvaluation.firstDenyingCondition.actual,
          reason: ruleEvaluation.firstDenyingCondition.reason,
          remediation: ruleEvaluation.firstDenyingCondition.remediation,
          totalFailedConditions: ruleEvaluation.failedConditions.length,
        });
      } else {
        logger.warn('[debugPermissions] Local rule evaluation passed — possible deployment drift:', {
          summary: ruleEvaluation.summary,
          deploymentDriftNote: ruleEvaluation.deploymentDriftNote,
        });
      }
    }

    return {
      attemptedAt: new Date().toISOString(),
      projectId,
      databaseId,
      operationType: DebugOperationType.CREATE,
      documentPath,
      authContext,
      attemptedPayload,
      writeSucceeded,
      firebaseError,
      ruleEvaluation,
      prerequisiteReadNotes,
    };
  } finally {
    if (signedInTemporarily && !deps.writeFn) {
      await signOut(auth).catch(() => undefined);
    }
    if (!deps.db) {
      await terminate(db).catch(() => undefined);
      if (instances.createdApp && instances.app) {
        await deleteApp(instances.app).catch(() => undefined);
      }
    }
  }
}

async function main(): Promise<void> {
  const options = parseDebugPermissionsCliArgs(process.argv.slice(2));
  const result = await debugInvestmentRequestsWritePermissions(options);
  console.log('\n[debugPermissions] Summary JSON:');
  console.log(
    JSON.stringify(
      {
        attemptedAt: result.attemptedAt,
        projectId: result.projectId,
        databaseId: result.databaseId,
        documentPath: result.documentPath,
        writeSucceeded: result.writeSucceeded,
        firebaseError: result.firebaseError
          ? {
              name: result.firebaseError.name,
              code: result.firebaseError.code,
              message: result.firebaseError.message,
              customData: result.firebaseError.customData,
            }
          : null,
        pinpointedRuleFailure: result.ruleEvaluation.firstDenyingCondition,
        failedConditionIds: result.ruleEvaluation.failedConditions.map((c) => c.id),
        prerequisiteReadNotes: result.prerequisiteReadNotes,
      },
      null,
      2
    )
  );
}

const isEntryModule =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  path.resolve(process.argv[1]).endsWith('debugPermissions.ts');

if (isEntryModule) {
  void main().catch((err) => {
    console.error('[debugPermissions] Unhandled error:', err);
    process.exitCode = 1;
  });
}
