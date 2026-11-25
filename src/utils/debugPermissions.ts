import { FirebaseError } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import {
  doc,
  type Firestore,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { ILLUSTRATIVE_PLANS } from '../data/catalogPreview';
import { ProductPlan } from '../types/domain';
import {
  buildExpectedInvestmentRequestPayload,
  diagnoseInvestmentRequestRules,
  DiagnosticConditionResult,
  extractFirestoreWriteErrorDetails,
  InvestmentRequestAuthContext,
  InvestmentRequestRuleDiagnosticReport,
} from './investmentRulesDiagnostic';

export interface FirestoreDetailedError {
  isFirebaseError: boolean;
  name: string;
  code: string | null;
  message: string;
  customData?: Record<string, unknown>;
}

export interface CheckInvestmentWritePermissionsOptions {
  /** Plan to build the dry-run payload from (defaults to PLAN_LAPTOP_100). */
  plan?: Pick<
    ProductPlan,
    | 'planId'
    | 'productName'
    | 'planPriceInr'
    | 'coinDeductionAmount'
    | 'durationDays'
    | 'totalCoinReward'
  >;
  /** Custom document ID for the dry-run write (defaults to a dryrun_invreq_* ID). */
  requestId?: string;
  /** Optional UID override for payload simulation (defaults to current auth UID). */
  uid?: string;
  /** Optional NX User ID override (defaults to users/{uid}.userId or 'NX100001'). */
  userId?: string;
  acceptedTerms?: boolean;
  idempotencyKey?: string;
  /** Optional field overrides to test specific schema/validation rule failures. */
  payloadOverrides?: Record<string, unknown>;
  /**
   * When true (default), avoids committing a permanent document into `investmentRequests`
   * if all local rules pass (since `allow delete: if false` prevents client cleanup),
   * while still executing the real Firestore `setDoc` when a failure is expected or
   * when `forceLiveWrite` is enabled.
   */
  dryRun?: boolean;
  /**
   * Set to true to execute `setDoc` against Firestore even if all local rules pass
   * (useful for confirming whether deployed rules match local `firestore.rules`).
   */
  forceLiveWrite?: boolean;
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export interface CheckInvestmentWritePermissionsDependencies {
  db?: Firestore;
  auth?: Auth;
  readDocFn?: (
    collectionName: string,
    docId: string
  ) => Promise<Record<string, unknown> | null>;
  writeDocFn?: (
    documentPath: string,
    payload: Record<string, unknown>
  ) => Promise<void>;
}

export type PermissionCheckStatus =
  | 'DRY_RUN_ALLOWED'
  | 'LIVE_WRITE_SUCCEEDED'
  | 'PERMISSION_DENIED'
  | 'WRITE_FAILED';

export interface CheckInvestmentWritePermissionsResult {
  checkedAt: string;
  status: PermissionCheckStatus;
  dryRun: boolean;
  projectId: string;
  databaseId: string;
  documentPath: string;
  authContext: InvestmentRequestAuthContext;
  attemptedPayload: Record<string, unknown>;
  liveWriteAttempted: boolean;
  firestoreError: FirestoreDetailedError | null;
  failedRule: DiagnosticConditionResult | null;
  failedConditions: DiagnosticConditionResult[];
  actionableFeedback: string[];
  report: InvestmentRequestRuleDiagnosticReport;
  prerequisiteReadErrors: Record<string, string>;
}

function serializeError(err: unknown): FirestoreDetailedError {
  if (err instanceof FirebaseError) {
    return {
      isFirebaseError: true,
      name: err.name,
      code: err.code,
      message: err.message,
      customData: err.customData as Record<string, unknown> | undefined,
    };
  }

  const extracted = extractFirestoreWriteErrorDetails(err);
  if (err instanceof Error) {
    return {
      isFirebaseError: false,
      name: err.name,
      code: extracted.code,
      message: err.message,
    };
  }

  return {
    isFirebaseError: false,
    name: 'UnknownError',
    code: extracted.code,
    message: String(err),
  };
}

async function resolveClients(
  deps: CheckInvestmentWritePermissionsDependencies
): Promise<{ db: Firestore; auth: Auth }> {
  if (deps.db && deps.auth) {
    return { db: deps.db, auth: deps.auth };
  }
  const client = await import('../firebase/client');
  return {
    db: deps.db ?? client.db,
    auth: deps.auth ?? client.auth,
  };
}

async function getCurrentAuthContext(
  auth: Auth
): Promise<InvestmentRequestAuthContext> {
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
      // Keep providerData fallback if token inspection is unavailable
    }
  }

  return {
    isAuthenticated: Boolean(currentUser),
    uid: currentUser?.uid ?? null,
    email: currentUser?.email ?? null,
    emailVerified: Boolean(currentUser?.emailVerified),
    signInProvider,
    isAnonymous: Boolean(currentUser?.isAnonymous),
  };
}

function buildActionableFeedback(params: {
  report: InvestmentRequestRuleDiagnosticReport;
  firestoreError: FirestoreDetailedError | null;
  readErrors: Record<string, string>;
  databaseId: string;
}): string[] {
  const feedback: string[] = [];

  if (params.report.failedConditions.length > 0) {
    for (const condition of params.report.failedConditions) {
      feedback.push(
        `[${condition.id}] (${condition.firestoreRulesLocation}) ${condition.reason} Action: ${condition.remediation}`
      );
    }
  } else if (
    params.firestoreError &&
    params.firestoreError.code?.includes('permission-denied')
  ) {
    feedback.push(
      `Local firestore.rules checks all passed, yet Firestore database '${params.databaseId}' returned '${params.firestoreError.code}': ${params.firestoreError.message}. Action: Deploy updated firestore.rules to project '${firebaseConfig.projectId}' (database '${params.databaseId}') and confirm auth token claims.`
    );
  } else if (params.firestoreError) {
    feedback.push(
      `Firestore rejected the write with code '${params.firestoreError.code || 'unknown'}': ${params.firestoreError.message}. Action: Verify Firebase configuration, network connectivity, and Firestore database ID '${params.databaseId}'.`
    );
  } else {
    feedback.push(
      `All ${params.report.passedConditions.length} investmentRequests create conditions passed for project '${firebaseConfig.projectId}' (${params.databaseId}).`
    );
  }

  for (const [docPath, errMsg] of Object.entries(params.readErrors)) {
    feedback.push(
      `Prerequisite read for '${docPath}' failed (${errMsg}). Verify read permissions or sign-in state before writing.`
    );
  }

  return feedback;
}

/**
 * Attempts a dry-run write to `investmentRequests/{requestId}`, logs the detailed
 * Firestore error code and message if rejected, and provides actionable feedback
 * pinpointing the exact Firestore Security Rule condition that failed.
 */
export async function checkInvestmentWritePermissions(
  options: CheckInvestmentWritePermissionsOptions = {},
  deps: CheckInvestmentWritePermissionsDependencies = {}
): Promise<CheckInvestmentWritePermissionsResult> {
  const logger = options.logger ?? console;
  const dryRun = options.dryRun ?? true;
  const forceLiveWrite = options.forceLiveWrite ?? false;
  const projectId = firebaseConfig.projectId;
  const databaseId = firebaseConfig.firestoreDatabaseId;

  const { db, auth } = await resolveClients(deps);
  const authContext = await getCurrentAuthContext(auth);

  const selectedPlan = options.plan ?? ILLUSTRATIVE_PLANS[0];
  const requestId =
    options.requestId?.trim() ||
    `dryrun_invreq_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const documentPath = `investmentRequests/${requestId}`;

  const readDoc =
    deps.readDocFn ??
    (async (collectionName: string, docId: string) => {
      const snap = await getDoc(doc(db, collectionName, docId));
      return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
    });

  const prerequisiteReadErrors: Record<string, string> = {};
  let userProfileDoc: Record<string, unknown> | null = null;
  let productPlanDoc: Record<string, unknown> | null = null;
  let existingRequestDoc: Record<string, unknown> | null = null;

  const targetUid = (options.uid ?? authContext.uid ?? '').trim();

  await Promise.all([
    targetUid
      ? readDoc('users', targetUid)
          .then((data) => {
            userProfileDoc = data;
          })
          .catch((err) => {
            const snap = serializeError(err);
            prerequisiteReadErrors[`users/${targetUid}`] =
              `${snap.code || snap.name}: ${snap.message}`;
          })
      : Promise.resolve(),

    readDoc('productPlans', selectedPlan.planId)
      .then((data) => {
        productPlanDoc = data;
      })
      .catch((err) => {
        const snap = serializeError(err);
        prerequisiteReadErrors[`productPlans/${selectedPlan.planId}`] =
          `${snap.code || snap.name}: ${snap.message}`;
      }),

    readDoc('investmentRequests', requestId)
      .then((data) => {
        existingRequestDoc = data;
      })
      .catch((err) => {
        const snap = serializeError(err);
        prerequisiteReadErrors[documentPath] =
          `${snap.code || snap.name}: ${snap.message}`;
      }),
  ]);

  const resolvedUserId =
    options.userId?.trim() ||
    (typeof userProfileDoc?.['userId'] === 'string'
      ? userProfileDoc['userId']
      : 'NX100001');

  const attemptedPayload: Record<string, unknown> = {
    ...buildExpectedInvestmentRequestPayload({
      requestId,
      uid: targetUid || 'unauthenticated_dry_run_uid',
      userId: resolvedUserId,
      plan: selectedPlan,
      acceptedTerms: options.acceptedTerms ?? true,
      idempotencyKey: options.idempotencyKey ?? `idem_${requestId}`,
      createdAtSentinel: serverTimestamp(),
      updatedAtSentinel: serverTimestamp(),
    }),
    ...(options.payloadOverrides ?? {}),
  };

  const report = diagnoseInvestmentRequestRules({
    operation: 'create',
    requestId,
    auth: authContext,
    incomingData: attemptedPayload,
    existingRequestDoc,
    userProfileDoc,
    productPlanDoc,
    databaseId,
  });

  // In dry-run mode, always execute the live write when a rule failure is predicted
  // (Firestore rejects it safely without creating any record, giving us the real
  // FirebaseError code/message), and only commit when valid if `forceLiveWrite` is true
  // or `dryRun` is false (because `allow delete: if false` prevents client cleanup).
  const shouldAttemptLiveWrite = !dryRun || forceLiveWrite || !report.allowed;

  let liveWriteAttempted = false;
  let liveWriteSucceeded = false;
  let firestoreError: FirestoreDetailedError | null = null;

  if (shouldAttemptLiveWrite) {
    liveWriteAttempted = true;
    try {
      if (deps.writeDocFn) {
        await deps.writeDocFn(documentPath, attemptedPayload);
      } else {
        await setDoc(doc(db, 'investmentRequests', requestId), attemptedPayload);
      }
      liveWriteSucceeded = true;
    } catch (error: unknown) {
      firestoreError = serializeError(error);
      logger.error('[checkInvestmentWritePermissions] Firestore write rejected:', {
        code: firestoreError.code,
        message: firestoreError.message,
        name: firestoreError.name,
        customData: firestoreError.customData,
        path: documentPath,
        projectId,
        databaseId,
        authUid: authContext.uid,
      });
    }
  } else {
    logger.log(
      '[checkInvestmentWritePermissions] Dry-run skipped persistent commit because all local rules passed (pass { forceLiveWrite: true } to execute against live rules):',
      {
        path: documentPath,
        projectId,
        databaseId,
        authUid: authContext.uid,
      }
    );
  }

  const actionableFeedback = buildActionableFeedback({
    report,
    firestoreError,
    readErrors: prerequisiteReadErrors,
    databaseId,
  });

  const failedRule = report.firstDenyingCondition;

  if (failedRule || firestoreError) {
    logger.error('[checkInvestmentWritePermissions] Actionable permission feedback:', {
      failedRuleId: failedRule?.id ?? null,
      firestoreRulesLocation: failedRule?.firestoreRulesLocation ?? null,
      ruleExpression: failedRule?.ruleExpression ?? null,
      firestoreErrorCode: firestoreError?.code ?? null,
      firestoreErrorMessage: firestoreError?.message ?? null,
      actionableFeedback,
    });
  }

  let status: PermissionCheckStatus;
  if (firestoreError) {
    status = firestoreError.code?.includes('permission-denied')
      ? 'PERMISSION_DENIED'
      : 'WRITE_FAILED';
  } else if (!report.allowed) {
    status = 'PERMISSION_DENIED';
  } else if (liveWriteSucceeded) {
    status = 'LIVE_WRITE_SUCCEEDED';
  } else {
    status = 'DRY_RUN_ALLOWED';
  }

  return {
    checkedAt: new Date().toISOString(),
    status,
    dryRun,
    projectId,
    databaseId,
    documentPath,
    authContext,
    attemptedPayload,
    liveWriteAttempted,
    firestoreError,
    failedRule,
    failedConditions: report.failedConditions,
    actionableFeedback,
    report,
    prerequisiteReadErrors,
  };
}
