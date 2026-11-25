import { doc, getDoc, serverTimestamp } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { auth, db } from '../firebase/client';
import { ProductPlan } from '../types/domain';
import {
  buildExpectedInvestmentRequestPayload,
  buildInvestmentRequestWriteAttemptLogEntry,
  diagnoseInvestmentRequestRules,
  DiagnosticLogger,
  InvestmentRequestAuthContext,
  InvestmentRequestRuleDiagnosticReport,
  InvestmentRequestWriteAttemptLogEntry,
  logInvestmentRequestRuleEvaluation,
  RuleDiagnosticOperation,
} from '../utils/investmentRulesDiagnostic';

export interface LiveInvestmentDiagnosticParams {
  plan: Pick<
    ProductPlan,
    | 'planId'
    | 'productName'
    | 'planPriceInr'
    | 'coinDeductionAmount'
    | 'durationDays'
    | 'totalCoinReward'
  >;
  operation?: RuleDiagnosticOperation;
  requestId?: string;
  uid?: string;
  userId?: string;
  acceptedTerms?: boolean;
  idempotencyKey?: string;
  payloadOverride?: Record<string, unknown>;
}

export interface LiveInvestmentDiagnosticResult {
  report: InvestmentRequestRuleDiagnosticReport;
  evaluatedPayload: Record<string, unknown>;
  liveContext: {
    projectId: string;
    databaseId: string;
    authUid: string | null;
    authEmail: string | null;
    emailVerified: boolean;
    signInProvider: string | null;
    userProfileExists: boolean;
    userProfileStatus: string | null;
    userProfileNxId: string | null;
    productPlanExists: boolean;
    productPlanIsActive: boolean | null;
    existingRequestExists: boolean;
    adminUserExists: boolean;
    readErrors: Record<string, string>;
  };
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function resolveCurrentAuthContext(): Promise<InvestmentRequestAuthContext> {
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
      // Keep providerData fallback if token claim inspection fails
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

async function fetchLiveRulePrerequisiteDocs(params: {
  targetProfileUid: string;
  planId: string;
  requestId: string;
  checkExistingRequestDoc: boolean;
  adminUid: string | null;
}) {
  const readErrors: Record<string, string> = {};
  let userProfileDoc: Record<string, unknown> | null = null;
  let productPlanDoc: Record<string, unknown> | null = null;
  let existingRequestDoc: Record<string, unknown> | null = null;
  let adminUserDoc: Record<string, unknown> | null = null;
  let platformSettingsDoc: Record<string, unknown> | null = null;

  await Promise.all([
    params.targetProfileUid
      ? getDoc(doc(db, 'users', params.targetProfileUid))
          .then((snap) => {
            userProfileDoc = snap.exists() ? snap.data() : null;
          })
          .catch((err) => {
            readErrors[`users/${params.targetProfileUid}`] = getErrorMessage(err);
          })
      : Promise.resolve(),

    params.planId
      ? getDoc(doc(db, 'productPlans', params.planId))
          .then((snap) => {
            productPlanDoc = snap.exists() ? snap.data() : null;
          })
          .catch((err) => {
            readErrors[`productPlans/${params.planId}`] = getErrorMessage(err);
          })
      : Promise.resolve(),

    params.checkExistingRequestDoc && params.requestId
      ? getDoc(doc(db, 'investmentRequests', params.requestId))
          .then((snap) => {
            existingRequestDoc = snap.exists() ? snap.data() : null;
          })
          .catch((err) => {
            readErrors[`investmentRequests/${params.requestId}`] = getErrorMessage(err);
          })
      : Promise.resolve(),

    params.adminUid
      ? getDoc(doc(db, 'adminUsers', params.adminUid))
          .then((snap) => {
            adminUserDoc = snap.exists() ? snap.data() : null;
          })
          .catch((err) => {
            readErrors[`adminUsers/${params.adminUid}`] = getErrorMessage(err);
          })
      : Promise.resolve(),

    getDoc(doc(db, 'platformSettings', 'global'))
      .then((snap) => {
        platformSettingsDoc = snap.exists() ? snap.data() : null;
      })
      .catch((err) => {
        readErrors['platformSettings/global'] = getErrorMessage(err);
      }),
  ]);

  return {
    userProfileDoc,
    productPlanDoc,
    existingRequestDoc,
    adminUserDoc,
    platformSettingsDoc,
    readErrors,
  };
}

/**
 * Strictly read-only live diagnostic utility for `investmentRequests/{requestId}`.
 * Reads current Firebase Auth state plus `users/{uid}`, `productPlans/{planId}`,
 * `adminUsers/{uid}`, and `investmentRequests/{requestId}` from the configured
 * Firestore database (`ai-studio-nexorainvest-c25f96bd-2963-4ef8-b030-e5a6fe625870`),
 * then identifies which exact Firestore Security Rule condition(s) allow or deny the write.
 *
 * Performs ZERO writes and never modifies user wallets, requests, or payment records.
 */
export async function inspectLiveInvestmentRequestRules(
  params: LiveInvestmentDiagnosticParams
): Promise<LiveInvestmentDiagnosticResult> {
  const authContext = await resolveCurrentAuthContext();
  const effectiveUid = (params.uid ?? authContext.uid ?? '').trim();
  const requestId =
    (params.requestId || `diag_invreq_${Date.now()}`).trim();
  const operation: RuleDiagnosticOperation = params.operation ?? 'create';
  const targetProfileUid = authContext.uid || effectiveUid;

  const {
    userProfileDoc,
    productPlanDoc,
    existingRequestDoc,
    adminUserDoc,
    platformSettingsDoc,
    readErrors,
  } = await fetchLiveRulePrerequisiteDocs({
    targetProfileUid,
    planId: params.plan.planId,
    requestId,
    checkExistingRequestDoc: Boolean(requestId),
    adminUid: authContext.uid,
  });

  const resolvedUserId =
    params.userId ??
    (typeof userProfileDoc?.['userId'] === 'string'
      ? userProfileDoc['userId']
      : '');

  const evaluatedPayload =
    params.payloadOverride ??
    buildExpectedInvestmentRequestPayload({
      requestId,
      uid: effectiveUid,
      userId: resolvedUserId,
      plan: params.plan,
      acceptedTerms: params.acceptedTerms ?? true,
      idempotencyKey: params.idempotencyKey,
      createdAtSentinel: serverTimestamp(),
      updatedAtSentinel: serverTimestamp(),
    });

  const report = diagnoseInvestmentRequestRules({
    operation,
    requestId,
    auth: authContext,
    incomingData: evaluatedPayload,
    existingRequestDoc,
    userProfileDoc,
    productPlanDoc,
    adminUserDoc,
    platformSettingsDoc,
    databaseId: firebaseConfig.firestoreDatabaseId,
  });

  return {
    report,
    evaluatedPayload,
    liveContext: {
      projectId: firebaseConfig.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId,
      authUid: authContext.uid,
      authEmail: authContext.email ?? null,
      emailVerified: Boolean(authContext.emailVerified),
      signInProvider: authContext.signInProvider ?? null,
      userProfileExists: Boolean(userProfileDoc),
      userProfileStatus:
        typeof userProfileDoc?.['status'] === 'string'
          ? userProfileDoc['status']
          : null,
      userProfileNxId:
        typeof userProfileDoc?.['userId'] === 'string'
          ? userProfileDoc['userId']
          : null,
      productPlanExists: Boolean(productPlanDoc),
      productPlanIsActive:
        typeof productPlanDoc?.['isActive'] === 'boolean'
          ? productPlanDoc['isActive']
          : null,
      existingRequestExists: Boolean(existingRequestDoc),
      adminUserExists: Boolean(adminUserDoc),
      readErrors,
    },
  };
}

export interface DiagnoseWriteAttemptParams {
  operation?: RuleDiagnosticOperation;
  requestId: string;
  attemptedPayload: Record<string, unknown>;
  uid?: string;
  planId?: string;
  error?: unknown;
  logger?: DiagnosticLogger;
}

/**
 * Evaluates and logs the exact Firestore security rule result for an attempted
 * `investmentRequests/{requestId}` write, capturing the exact permission check
 * failure (or deployment drift) against live auth and Firestore state.
 */
export async function diagnoseAndLogInvestmentRequestWriteAttempt(
  params: DiagnoseWriteAttemptParams
): Promise<InvestmentRequestWriteAttemptLogEntry> {
  const operation: RuleDiagnosticOperation = params.operation ?? 'create';
  const authContext = await resolveCurrentAuthContext();
  const payloadPlanId =
    typeof params.attemptedPayload.planId === 'string'
      ? params.attemptedPayload.planId
      : '';
  const planId = (params.planId || payloadPlanId).trim();
  const payloadUid =
    typeof params.attemptedPayload.uid === 'string' ? params.attemptedPayload.uid : '';
  const targetProfileUid = (authContext.uid || params.uid || payloadUid).trim();

  // Only check pre-existing doc when diagnosing a failed create or any update
  // (a succeeded create naturally wrote the document at `requestId`).
  const checkExistingRequestDoc =
    operation !== 'create' || params.error !== undefined;

  const {
    userProfileDoc,
    productPlanDoc,
    existingRequestDoc,
    adminUserDoc,
    platformSettingsDoc,
    readErrors,
  } = await fetchLiveRulePrerequisiteDocs({
    targetProfileUid,
    planId,
    requestId: params.requestId,
    checkExistingRequestDoc,
    adminUid: authContext.uid,
  });

  const report = diagnoseInvestmentRequestRules({
    operation,
    requestId: params.requestId,
    auth: authContext,
    incomingData: params.attemptedPayload,
    existingRequestDoc,
    userProfileDoc,
    productPlanDoc,
    adminUserDoc,
    platformSettingsDoc,
    databaseId: firebaseConfig.firestoreDatabaseId,
  });

  const entry = buildInvestmentRequestWriteAttemptLogEntry({
    report,
    error: params.error,
    readErrors,
  });

  return logInvestmentRequestRuleEvaluation(entry, params.logger);
}

/**
 * Executes an `investmentRequests/{requestId}` write operation and logs the
 * specific Firestore security rule evaluation result on completion or failure.
 * Rethrows the original write error untouched when Firestore denies the write.
 */
export async function attemptLoggedInvestmentRequestWrite<T>(params: {
  operation?: RuleDiagnosticOperation;
  requestId: string;
  payload: Record<string, unknown>;
  uid?: string;
  planId?: string;
  logger?: DiagnosticLogger;
  executeWrite: () => Promise<T>;
}): Promise<{
  result: T;
  diagnosticLog: InvestmentRequestWriteAttemptLogEntry | null;
}> {
  try {
    const result = await params.executeWrite();
    let diagnosticLog: InvestmentRequestWriteAttemptLogEntry | null = null;
    try {
      diagnosticLog = await diagnoseAndLogInvestmentRequestWriteAttempt({
        operation: params.operation ?? 'create',
        requestId: params.requestId,
        attemptedPayload: params.payload,
        uid: params.uid,
        planId: params.planId,
        logger: params.logger,
      });
    } catch {
      // Never fail a succeeded write because of read-only diagnostic logging
    }
    return { result, diagnosticLog };
  } catch (writeErr) {
    try {
      await diagnoseAndLogInvestmentRequestWriteAttempt({
        operation: params.operation ?? 'create',
        requestId: params.requestId,
        attemptedPayload: params.payload,
        uid: params.uid,
        planId: params.planId,
        error: writeErr,
        logger: params.logger,
      });
    } catch {
      // Never mask the underlying Firestore error if diagnostic inspection throws
    }
    throw writeErr;
  }
}
