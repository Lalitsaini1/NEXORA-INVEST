import { doc, getDoc, serverTimestamp } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { auth, db } from '../firebase/client';
import { ProductPlan } from '../types/domain';
import {
  buildExpectedInvestmentRequestPayload,
  diagnoseInvestmentRequestRules,
  InvestmentRequestAuthContext,
  InvestmentRequestRuleDiagnosticReport,
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

/**
 * Strictly read-only live diagnostic utility for `investmentRequests/{requestId}`.
 * Reads current Firebase Auth state plus `users/{uid}`, `productPlans/{planId}`,
 * `adminUsers/{uid}`, and `investmentRequests/{requestId}` from the configured
 * Firestore database (`ai-studio-nexorainvest-5bfd69ce-b6b9-406b-b8b5-777b72b7226f`),
 * then identifies which exact Firestore Security Rule condition(s) allow or deny the write.
 *
 * Performs ZERO writes and never modifies user wallets, requests, or payment records.
 */
export async function inspectLiveInvestmentRequestRules(
  params: LiveInvestmentDiagnosticParams
): Promise<LiveInvestmentDiagnosticResult> {
  const currentUser = auth.currentUser;
  const effectiveUid = (params.uid ?? currentUser?.uid ?? '').trim();
  const requestId =
    (params.requestId || `diag_invreq_${Date.now()}`).trim();
  const operation: RuleDiagnosticOperation = params.operation ?? 'create';

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

  const authContext: InvestmentRequestAuthContext = {
    isAuthenticated: Boolean(currentUser),
    uid: currentUser?.uid ?? null,
    email: currentUser?.email ?? null,
    emailVerified: Boolean(currentUser?.emailVerified),
    signInProvider,
    isAnonymous: Boolean(currentUser?.isAnonymous),
  };

  const readErrors: Record<string, string> = {};
  let userProfileDoc: Record<string, unknown> | null = null;
  let productPlanDoc: Record<string, unknown> | null = null;
  let existingRequestDoc: Record<string, unknown> | null = null;
  let adminUserDoc: Record<string, unknown> | null = null;

  const targetProfileUid = currentUser?.uid || effectiveUid;

  await Promise.all([
    targetProfileUid
      ? getDoc(doc(db, 'users', targetProfileUid))
          .then((snap) => {
            userProfileDoc = snap.exists() ? snap.data() : null;
          })
          .catch((err) => {
            readErrors[`users/${targetProfileUid}`] = getErrorMessage(err);
          })
      : Promise.resolve(),

    params.plan.planId
      ? getDoc(doc(db, 'productPlans', params.plan.planId))
          .then((snap) => {
            productPlanDoc = snap.exists() ? snap.data() : null;
          })
          .catch((err) => {
            readErrors[`productPlans/${params.plan.planId}`] = getErrorMessage(err);
          })
      : Promise.resolve(),

    requestId
      ? getDoc(doc(db, 'investmentRequests', requestId))
          .then((snap) => {
            existingRequestDoc = snap.exists() ? snap.data() : null;
          })
          .catch((err) => {
            readErrors[`investmentRequests/${requestId}`] = getErrorMessage(err);
          })
      : Promise.resolve(),

    currentUser?.uid
      ? getDoc(doc(db, 'adminUsers', currentUser.uid))
          .then((snap) => {
            adminUserDoc = snap.exists() ? snap.data() : null;
          })
          .catch((err) => {
            readErrors[`adminUsers/${currentUser.uid}`] = getErrorMessage(err);
          })
      : Promise.resolve(),
  ]);

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
    databaseId: firebaseConfig.firestoreDatabaseId,
  });

  return {
    report,
    evaluatedPayload,
    liveContext: {
      projectId: firebaseConfig.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId,
      authUid: currentUser?.uid ?? null,
      authEmail: currentUser?.email ?? null,
      emailVerified: Boolean(currentUser?.emailVerified),
      signInProvider,
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
