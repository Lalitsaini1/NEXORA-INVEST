import { SUPER_ADMIN_EMAILS, SUPER_ADMIN_UID } from '../config/constants';
import { ProductPlan } from '../types/domain';

export const DEFAULT_DIAGNOSTIC_DATABASE_ID =
  'ai-studio-nexorainvest-5bfd69ce-b6b9-406b-b8b5-777b72b7226f';

export type RuleDiagnosticOperation = 'create' | 'update' | 'delete';

export interface DiagnosticConditionResult {
  id: string;
  ruleExpression: string;
  firestoreRulesLocation: string;
  passed: boolean;
  expected: string;
  actual: string;
  reason: string;
  remediation: string;
}

export interface InvestmentRequestAuthContext {
  isAuthenticated: boolean;
  uid: string | null;
  email?: string | null;
  emailVerified?: boolean;
  signInProvider?: string | null;
  isAnonymous?: boolean;
}

export interface InvestmentRequestRuleEvalInput {
  operation?: RuleDiagnosticOperation;
  requestId: string;
  auth: InvestmentRequestAuthContext;
  incomingData: Record<string, unknown>;
  existingRequestDoc?: Record<string, unknown> | null;
  userProfileDoc?: Record<string, unknown> | null;
  productPlanDoc?: Record<string, unknown> | null;
  adminUserDoc?: Record<string, unknown> | null;
  databaseId?: string;
}

export interface InvestmentRequestRuleDiagnosticReport {
  allowed: boolean;
  operation: RuleDiagnosticOperation;
  databaseId: string;
  collectionPath: string;
  firstDenyingCondition: DiagnosticConditionResult | null;
  failedConditions: DiagnosticConditionResult[];
  passedConditions: DiagnosticConditionResult[];
  summary: string;
  deploymentDriftNote: string;
}

export const INVESTMENT_REQUEST_REQUIRED_KEYS = [
  'requestId',
  'uid',
  'userId',
  'planId',
  'productName',
  'planPriceInr',
  'coinCost',
  'durationDays',
  'totalRewardEntitlement',
  'acceptedTerms',
  'idempotencyKey',
  'status',
  'paymentStatus',
  'createdAt',
  'updatedAt',
] as const;

export const INVESTMENT_REQUEST_ALLOWED_KEYS = [
  'requestId',
  'uid',
  'userId',
  'planId',
  'productName',
  'planPriceInr',
  'coinCost',
  'durationDays',
  'totalRewardEntitlement',
  'acceptedTerms',
  'idempotencyKey',
  'status',
  'paymentStatus',
  'activatedUserPlanId',
  'coinTransactionId',
  'verifiedByUid',
  'failureReason',
  'createdAt',
  'updatedAt',
  'activatedAt',
] as const;

export const INVESTMENT_REQUEST_FORBIDDEN_CREATE_KEYS = [
  'activatedUserPlanId',
  'coinTransactionId',
  'verifiedByUid',
  'failureReason',
  'activatedAt',
] as const;

export const INVESTMENT_REQUEST_ALLOWED_STATUSES = [
  'PENDING_VERIFICATION',
  'ACTIVATED',
  'REJECTED',
  'FAILED',
] as const;

export const INVESTMENT_REQUEST_ALLOWED_PAYMENT_STATUSES = [
  'PENDING',
  'VERIFIED',
  'INSUFFICIENT_BALANCE',
  'FAILED',
] as const;

export interface BuiltInCatalogRuleSpec {
  planId: string;
  productName: string;
  planPriceInr: number;
  coinCost: number;
  durationDays: number;
  totalRewardEntitlement: number;
}

/**
 * Exact mirror of the built-in catalog fallback in `firestore.rules:288-291`.
 */
export const BUILT_IN_CATALOG_PLAN_SPECS: readonly BuiltInCatalogRuleSpec[] = [
  {
    planId: 'PLAN_LAPTOP_100',
    productName: 'Laptop Plan',
    planPriceInr: 100,
    coinCost: 100,
    durationDays: 7,
    totalRewardEntitlement: 188,
  },
  {
    planId: 'PLAN_MACHINERY_500',
    productName: 'Machinery Plan',
    planPriceInr: 500,
    coinCost: 500,
    durationDays: 14,
    totalRewardEntitlement: 650,
  },
  {
    planId: 'PLAN_SERVER_1000',
    productName: 'Compute Node Plan',
    planPriceInr: 1000,
    coinCost: 1000,
    durationDays: 21,
    totalRewardEntitlement: 1320,
  },
  {
    planId: 'PLAN_ENERGY_5000',
    productName: 'Grid Storage Plan',
    planPriceInr: 5000,
    coinCost: 5000,
    durationDays: 30,
    totalRewardEntitlement: 6600,
  },
];

const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const NX_USER_ID_PATTERN = /^NX[0-9]{6,10}$/;

function isValidRulesId(value: unknown, maxLen = 128): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= maxLen &&
    ID_PATTERN.test(value)
  );
}

function isRulesInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

function formatActual(value: unknown): string {
  if (value === undefined) return 'undefined (missing)';
  if (value === null) return 'null';
  if (isServerTimestampSentinel(value)) return 'serverTimestamp() sentinel';
  if (isTimestampInstance(value)) return `Timestamp(${safeSerialize(value)})`;
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return safeSerialize(value);
}

function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function isServerTimestampSentinel(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record._methodName === 'serverTimestamp') return true;
  if (record.__type === 'serverTimestamp') return true;
  if (
    typeof (value as { toJSON?: unknown }).toJSON === 'function' &&
    record.constructor?.name === 'FieldValue'
  ) {
    return true;
  }
  return false;
}

export function isTimestampInstance(value: unknown): boolean {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return true;
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.toDate === 'function') return true;
  if (typeof record.seconds === 'number' && typeof record.nanoseconds === 'number') {
    return true;
  }
  return false;
}

export function isValidTimestampField(value: unknown): boolean {
  return isServerTimestampSentinel(value) || isTimestampInstance(value);
}

function timestampsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isServerTimestampSentinel(a) && isServerTimestampSentinel(b)) return true;
  const aMs = extractTimestampMs(a);
  const bMs = extractTimestampMs(b);
  return aMs !== null && bMs !== null && aMs === bMs;
}

function extractTimestampMs(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.toMillis === 'function') {
    const ms = (record.toMillis as () => unknown)();
    return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
  }
  if (typeof record.toDate === 'function') {
    const d = (record.toDate as () => unknown)();
    if (d instanceof Date && !Number.isNaN(d.getTime())) return d.getTime();
  }
  if (typeof record.seconds === 'number' && typeof record.nanoseconds === 'number') {
    return record.seconds * 1000 + Math.floor(record.nanoseconds / 1_000_000);
  }
  return null;
}

function checkSignedIn(auth: InvestmentRequestAuthContext): boolean {
  return Boolean(
    auth.isAuthenticated &&
      auth.uid &&
      !auth.isAnonymous &&
      auth.signInProvider !== 'anonymous'
  );
}

function checkIsAdmin(
  auth: InvestmentRequestAuthContext,
  adminUserDoc: Record<string, unknown> | null | undefined
): boolean {
  if (!checkSignedIn(auth) || !auth.uid) return false;
  const normalizedEmail = (auth.email || '').trim().toLowerCase();
  const isHardcodedSuperAdmin =
    auth.uid === SUPER_ADMIN_UID ||
    (auth.emailVerified === true &&
      SUPER_ADMIN_EMAILS.some((email) => email.toLowerCase() === normalizedEmail));
  if (isHardcodedSuperAdmin) return true;

  if (!adminUserDoc) return false;
  if (adminUserDoc.active !== true) return false;
  if (!('role' in adminUserDoc)) return true;
  return adminUserDoc.role === 'ADMIN' || adminUserDoc.role === 'SUPER_ADMIN';
}

/**
 * Constructs the exact `investmentRequests/{requestId}` document payload sent by
 * `planService.ts` during rule-validated `FIRESTORE_RULES_FALLBACK` creation.
 */
export function buildExpectedInvestmentRequestPayload(params: {
  requestId: string;
  uid: string;
  userId: string;
  plan: Pick<
    ProductPlan,
    | 'planId'
    | 'productName'
    | 'planPriceInr'
    | 'coinDeductionAmount'
    | 'durationDays'
    | 'totalCoinReward'
  >;
  acceptedTerms: boolean;
  idempotencyKey?: string;
  createdAtSentinel?: unknown;
  updatedAtSentinel?: unknown;
}): Record<string, unknown> {
  const cleanUid = params.uid.trim();
  const cleanUserId = params.userId.trim();
  const rawKey = params.idempotencyKey || `${cleanUid}_${params.requestId}`;
  const idempotencyKey =
    rawKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128) || `${cleanUid}_${params.requestId}`;

  return {
    requestId: params.requestId,
    uid: cleanUid,
    userId: cleanUserId,
    planId: params.plan.planId,
    productName: params.plan.productName.slice(0, 120),
    planPriceInr: Math.max(1, Math.round(params.plan.planPriceInr)),
    coinCost: Math.max(1, Math.round(params.plan.coinDeductionAmount)),
    durationDays: Math.max(1, Math.round(params.plan.durationDays)),
    totalRewardEntitlement: Math.max(0, Math.round(params.plan.totalCoinReward)),
    acceptedTerms: params.acceptedTerms,
    idempotencyKey,
    status: 'PENDING_VERIFICATION',
    paymentStatus: 'PENDING',
    createdAt: params.createdAtSentinel ?? { _methodName: 'serverTimestamp' },
    updatedAt: params.updatedAtSentinel ?? { _methodName: 'serverTimestamp' },
  };
}

/**
 * Exhaustively evaluates every condition in `/firestore.rules` for
 * `match /investmentRequests/{requestId}` (`create`, `update`, or `delete`)
 * so callers can identify the exact clause(s) denying write access.
 */
export function diagnoseInvestmentRequestRules(
  input: InvestmentRequestRuleEvalInput
): InvestmentRequestRuleDiagnosticReport {
  const operation: RuleDiagnosticOperation = input.operation ?? 'create';
  const databaseId = input.databaseId || DEFAULT_DIAGNOSTIC_DATABASE_ID;
  const collectionPath = `investmentRequests/${input.requestId || '<empty>'}`;
  const incoming = input.incomingData || {};
  const results: DiagnosticConditionResult[] = [];

  const pushResult = (item: DiagnosticConditionResult) => {
    results.push(item);
  };

  if (operation === 'delete') {
    pushResult({
      id: 'delete_unconditionally_denied',
      ruleExpression: 'allow delete: if false;',
      firestoreRulesLocation: 'firestore.rules:1068',
      passed: false,
      expected: 'Deletes are never permitted on investmentRequests',
      actual: `Attempted delete on ${collectionPath}`,
      reason: 'All delete operations on /investmentRequests/{requestId} are unconditionally denied.',
      remediation:
        'Mark requests as REJECTED or FAILED via authorized backend update instead of deleting records.',
    });

    const failed = results.filter((r) => !r.passed);
    return {
      allowed: false,
      operation,
      databaseId,
      collectionPath,
      firstDenyingCondition: failed[0] ?? null,
      failedConditions: failed,
      passedConditions: [],
      summary: `DENIED (delete on ${collectionPath}): ${failed[0].reason}`,
      deploymentDriftNote: '',
    };
  }

  // 1. isSignedIn()
  const signedIn = checkSignedIn(input.auth);
  pushResult({
    id: 'isSignedIn',
    ruleExpression:
      "request.auth != null && request.auth.token.firebase.sign_in_provider != 'anonymous'",
    firestoreRulesLocation: 'firestore.rules:22-24, 1037/1058',
    passed: signedIn,
    expected: 'Non-anonymous authenticated Firebase user (uid present)',
    actual: !input.auth.isAuthenticated
      ? 'Unauthenticated (request.auth == null)'
      : input.auth.isAnonymous || input.auth.signInProvider === 'anonymous'
        ? `Anonymous session (provider=${input.auth.signInProvider || 'anonymous'})`
        : `Authenticated uid=${input.auth.uid}, provider=${input.auth.signInProvider || 'unknown'}`,
    reason: !input.auth.isAuthenticated
      ? 'No active Firebase Authentication session (request.auth is null).'
      : input.auth.isAnonymous || input.auth.signInProvider === 'anonymous'
        ? 'Anonymous Firebase sessions are rejected by isSignedIn().'
        : 'Authenticated non-anonymous Firebase session is present.',
    remediation: 'Sign in with a verified email/password or phone OTP Firebase account before submitting.',
  });

  // 2. isValidId(requestId)
  const validPathId = isValidRulesId(input.requestId, 128);
  pushResult({
    id: 'path_isValidId',
    ruleExpression: 'isValidId(requestId)',
    firestoreRulesLocation: 'firestore.rules:10-12, 1038/1059',
    passed: validPathId,
    expected: 'String length 1..128 matching ^[a-zA-Z0-9_\\-]+$',
    actual: formatActual(input.requestId),
    reason: validPathId
      ? 'Document path requestId satisfies isValidId().'
      : `Document path requestId (${formatActual(input.requestId)}) is empty, > 128 chars, or contains disallowed characters.`,
    remediation: 'Generate document IDs using only alphanumeric characters, underscores, and hyphens (1-128 chars).',
  });

  // 3. isAdmin() for update
  if (operation === 'update') {
    const adminAllowed = checkIsAdmin(input.auth, input.adminUserDoc);
    pushResult({
      id: 'update_isAdmin',
      ruleExpression: 'isAdmin()',
      firestoreRulesLocation: 'firestore.rules:39-49, 1060',
      passed: adminAllowed,
      expected: 'Super Admin UID/verified email or active adminUsers/{uid} record',
      actual: adminAllowed
        ? `Authorized admin uid=${input.auth.uid}`
        : `Non-admin uid=${input.auth.uid || 'null'}, adminUserDoc=${input.adminUserDoc ? safeSerialize(input.adminUserDoc) : 'missing'}`,
      reason: adminAllowed
        ? 'Caller satisfies isAdmin().'
        : 'Only authorized admins (or backend Cloud Functions) can update investmentRequests.',
      remediation:
        'Route updates through backend Cloud Functions or sign in with an active adminUsers/{uid} account.',
    });

    const requestExists = Boolean(input.existingRequestDoc);
    pushResult({
      id: 'update_existing_doc_exists',
      ruleExpression: 'existing() != null',
      firestoreRulesLocation: 'firestore.rules:18-20, 1062-1065',
      passed: requestExists,
      expected: `Existing document at ${collectionPath}`,
      actual: requestExists ? 'Document exists' : 'Document does not exist',
      reason: requestExists
        ? 'Target investmentRequests document exists for update.'
        : 'Update rules inspect existing() fields, which fails if the document does not exist.',
      remediation: 'Verify the investmentRequests document exists before performing an update.',
    });
  }

  // 4. isValidInvestmentRequest(incoming()) granular checks (firestore.rules:296-356)
  const incomingKeys = Object.keys(incoming).filter((k) => incoming[k] !== undefined);
  const undefinedKeys = Object.keys(incoming).filter((k) => incoming[k] === undefined);

  const missingRequiredKeys = INVESTMENT_REQUEST_REQUIRED_KEYS.filter(
    (key) => !incomingKeys.includes(key)
  );
  pushResult({
    id: 'schema_required_keys',
    ruleExpression: 'data.keys().hasAll([...15 required fields...])',
    firestoreRulesLocation: 'firestore.rules:297-313',
    passed: missingRequiredKeys.length === 0,
    expected: `All 15 required keys present (${INVESTMENT_REQUEST_REQUIRED_KEYS.join(', ')})`,
    actual:
      missingRequiredKeys.length === 0
        ? 'All 15 required keys present'
        : `Missing keys: ${missingRequiredKeys.join(', ')}`,
    reason:
      missingRequiredKeys.length === 0
        ? 'All required fields in isValidInvestmentRequest() are present.'
        : `Payload is missing required field(s): ${missingRequiredKeys.join(', ')}.`,
    remediation: 'Include every required field in the investmentRequests payload.',
  });

  const extraDisallowedKeys = incomingKeys.filter(
    (key) =>
      !(INVESTMENT_REQUEST_ALLOWED_KEYS as readonly string[]).includes(key)
  );
  pushResult({
    id: 'schema_allowed_keys_only',
    ruleExpression: 'data.keys().hasOnly([...20 allowed fields...])',
    firestoreRulesLocation: 'firestore.rules:314-335',
    passed: extraDisallowedKeys.length === 0 && undefinedKeys.length === 0,
    expected: 'Only the 20 allowed InvestmentRequest fields with non-undefined values',
    actual:
      extraDisallowedKeys.length === 0 && undefinedKeys.length === 0
        ? 'No extra or undefined keys'
        : `Extra: [${extraDisallowedKeys.join(', ')}]; Undefined: [${undefinedKeys.join(', ')}]`,
    reason:
      extraDisallowedKeys.length === 0 && undefinedKeys.length === 0
        ? 'Payload contains only whitelisted keys.'
        : `Payload has disallowed key(s) (${extraDisallowedKeys.join(', ') || 'none'}) or undefined key(s) (${undefinedKeys.join(', ') || 'none'}).`,
    remediation: 'Remove any unrecognized or undefined properties from the payload.',
  });

  const fieldChecks: Array<{
    id: string;
    ruleExpression: string;
    location: string;
    passed: boolean;
    expected: string;
    actual: string;
    remediation: string;
  }> = [
    {
      id: 'schema_requestId',
      ruleExpression: 'isValidId(data.requestId)',
      location: 'firestore.rules:336',
      passed: isValidRulesId(incoming.requestId, 128),
      expected: 'String (1..128) matching ^[a-zA-Z0-9_\\-]+$',
      actual: formatActual(incoming.requestId),
      remediation: 'Set data.requestId to a valid alphanumeric/underscore/hyphen ID.',
    },
    {
      id: 'schema_uid',
      ruleExpression: 'isValidId(data.uid)',
      location: 'firestore.rules:337',
      passed: isValidRulesId(incoming.uid, 128),
      expected: 'String (1..128) matching ^[a-zA-Z0-9_\\-]+$',
      actual: formatActual(incoming.uid),
      remediation: 'Set data.uid to the authenticated Firebase UID.',
    },
    {
      id: 'schema_userId',
      ruleExpression:
        "data.userId is string && data.userId.size() >= 8 && data.userId.size() <= 16 && data.userId.matches('^NX[0-9]{6,10}$')",
      location: 'firestore.rules:338',
      passed:
        typeof incoming.userId === 'string' &&
        incoming.userId.length >= 8 &&
        incoming.userId.length <= 16 &&
        NX_USER_ID_PATTERN.test(incoming.userId),
      expected: 'String length 8..16 matching ^NX[0-9]{6,10}$',
      actual: formatActual(incoming.userId),
      remediation: 'Ensure the member profile has a valid NX-prefixed User ID (e.g. NX100001).',
    },
    {
      id: 'schema_planId',
      ruleExpression: 'isValidId(data.planId) && data.planId.size() <= 64',
      location: 'firestore.rules:339',
      passed: isValidRulesId(incoming.planId, 64),
      expected: 'String (1..64) matching ^[a-zA-Z0-9_\\-]+$',
      actual: formatActual(incoming.planId),
      remediation: 'Provide a valid planId (max 64 chars, alphanumeric/underscore/hyphen).',
    },
    {
      id: 'schema_productName',
      ruleExpression: 'data.productName is string && data.productName.size() >= 2 && data.productName.size() <= 120',
      location: 'firestore.rules:340',
      passed:
        typeof incoming.productName === 'string' &&
        incoming.productName.length >= 2 &&
        incoming.productName.length <= 120,
      expected: 'String of length 2..120',
      actual: formatActual(incoming.productName),
      remediation: 'Ensure productName is a string between 2 and 120 characters.',
    },
    {
      id: 'schema_planPriceInr',
      ruleExpression: 'data.planPriceInr is int && data.planPriceInr >= 1 && data.planPriceInr <= 100000000',
      location: 'firestore.rules:341',
      passed:
        isRulesInt(incoming.planPriceInr) &&
        incoming.planPriceInr >= 1 &&
        incoming.planPriceInr <= 100000000,
      expected: 'Integer between 1 and 100000000',
      actual: formatActual(incoming.planPriceInr),
      remediation: 'Pass planPriceInr as a positive whole integer (no decimals/strings).',
    },
    {
      id: 'schema_coinCost',
      ruleExpression: 'data.coinCost is int && data.coinCost >= 1 && data.coinCost <= 100000000',
      location: 'firestore.rules:342',
      passed:
        isRulesInt(incoming.coinCost) &&
        incoming.coinCost >= 1 &&
        incoming.coinCost <= 100000000,
      expected: 'Integer between 1 and 100000000',
      actual: formatActual(incoming.coinCost),
      remediation: 'Pass coinCost as a positive whole integer (no decimals/strings).',
    },
    {
      id: 'schema_durationDays',
      ruleExpression: 'data.durationDays is int && data.durationDays >= 1 && data.durationDays <= 365',
      location: 'firestore.rules:343',
      passed:
        isRulesInt(incoming.durationDays) &&
        incoming.durationDays >= 1 &&
        incoming.durationDays <= 365,
      expected: 'Integer between 1 and 365',
      actual: formatActual(incoming.durationDays),
      remediation: 'Pass durationDays as a whole integer between 1 and 365.',
    },
    {
      id: 'schema_totalRewardEntitlement',
      ruleExpression: 'data.totalRewardEntitlement is int && data.totalRewardEntitlement >= 0',
      location: 'firestore.rules:344',
      passed:
        isRulesInt(incoming.totalRewardEntitlement) &&
        incoming.totalRewardEntitlement >= 0,
      expected: 'Integer >= 0',
      actual: formatActual(incoming.totalRewardEntitlement),
      remediation: 'Pass totalRewardEntitlement as a non-negative whole integer.',
    },
    {
      id: 'schema_acceptedTerms_type',
      ruleExpression: 'data.acceptedTerms is bool',
      location: 'firestore.rules:345',
      passed: typeof incoming.acceptedTerms === 'boolean',
      expected: 'boolean',
      actual: formatActual(incoming.acceptedTerms),
      remediation: 'Set acceptedTerms to a boolean value.',
    },
    {
      id: 'schema_idempotencyKey',
      ruleExpression:
        "data.idempotencyKey is string && data.idempotencyKey.size() >= 4 && data.idempotencyKey.size() <= 128 && data.idempotencyKey.matches('^[a-zA-Z0-9_\\-]+$')",
      location: 'firestore.rules:346',
      passed:
        typeof incoming.idempotencyKey === 'string' &&
        incoming.idempotencyKey.length >= 4 &&
        incoming.idempotencyKey.length <= 128 &&
        ID_PATTERN.test(incoming.idempotencyKey),
      expected: 'String (4..128) matching ^[a-zA-Z0-9_\\-]+$',
      actual: formatActual(incoming.idempotencyKey),
      remediation: 'Sanitize idempotencyKey to 4-128 chars matching ^[a-zA-Z0-9_-]+$.',
    },
    {
      id: 'schema_status_enum',
      ruleExpression:
        "data.status in ['PENDING_VERIFICATION', 'ACTIVATED', 'REJECTED', 'FAILED']",
      location: 'firestore.rules:347',
      passed:
        typeof incoming.status === 'string' &&
        (INVESTMENT_REQUEST_ALLOWED_STATUSES as readonly string[]).includes(incoming.status),
      expected: INVESTMENT_REQUEST_ALLOWED_STATUSES.join(' | '),
      actual: formatActual(incoming.status),
      remediation: 'Use a valid InvestmentRequest status enum value.',
    },
    {
      id: 'schema_paymentStatus_enum',
      ruleExpression:
        "data.paymentStatus in ['PENDING', 'VERIFIED', 'INSUFFICIENT_BALANCE', 'FAILED']",
      location: 'firestore.rules:348',
      passed:
        typeof incoming.paymentStatus === 'string' &&
        (INVESTMENT_REQUEST_ALLOWED_PAYMENT_STATUSES as readonly string[]).includes(
          incoming.paymentStatus
        ),
      expected: INVESTMENT_REQUEST_ALLOWED_PAYMENT_STATUSES.join(' | '),
      actual: formatActual(incoming.paymentStatus),
      remediation: 'Use a valid InvestmentRequest paymentStatus enum value.',
    },
    {
      id: 'schema_optional_activatedUserPlanId',
      ruleExpression: "!('activatedUserPlanId' in data) || isValidId(data.activatedUserPlanId)",
      location: 'firestore.rules:349',
      passed:
        !('activatedUserPlanId' in incoming) ||
        incoming.activatedUserPlanId === undefined ||
        isValidRulesId(incoming.activatedUserPlanId, 128),
      expected: 'Absent or valid ID string (1..128)',
      actual:
        'activatedUserPlanId' in incoming ? formatActual(incoming.activatedUserPlanId) : 'absent',
      remediation: 'Omit activatedUserPlanId on create or provide a valid ID on admin update.',
    },
    {
      id: 'schema_optional_coinTransactionId',
      ruleExpression: "!('coinTransactionId' in data) || isValidId(data.coinTransactionId)",
      location: 'firestore.rules:350',
      passed:
        !('coinTransactionId' in incoming) ||
        incoming.coinTransactionId === undefined ||
        isValidRulesId(incoming.coinTransactionId, 128),
      expected: 'Absent or valid ID string (1..128)',
      actual:
        'coinTransactionId' in incoming ? formatActual(incoming.coinTransactionId) : 'absent',
      remediation: 'Omit coinTransactionId on create or provide a valid ID on admin update.',
    },
    {
      id: 'schema_optional_verifiedByUid',
      ruleExpression: "!('verifiedByUid' in data) || isValidId(data.verifiedByUid)",
      location: 'firestore.rules:351',
      passed:
        !('verifiedByUid' in incoming) ||
        incoming.verifiedByUid === undefined ||
        isValidRulesId(incoming.verifiedByUid, 128),
      expected: 'Absent or valid ID string (1..128)',
      actual: 'verifiedByUid' in incoming ? formatActual(incoming.verifiedByUid) : 'absent',
      remediation: 'Omit verifiedByUid on create or provide a valid UID on admin update.',
    },
    {
      id: 'schema_optional_failureReason',
      ruleExpression:
        "!('failureReason' in data) || (data.failureReason is string && data.failureReason.size() <= 300)",
      location: 'firestore.rules:352',
      passed:
        !('failureReason' in incoming) ||
        incoming.failureReason === undefined ||
        (typeof incoming.failureReason === 'string' && incoming.failureReason.length <= 300),
      expected: 'Absent or string length <= 300',
      actual: 'failureReason' in incoming ? formatActual(incoming.failureReason) : 'absent',
      remediation: 'Omit failureReason on create or keep it a string <= 300 characters.',
    },
    {
      id: 'schema_createdAt_is_timestamp',
      ruleExpression: 'data.createdAt is timestamp',
      location: 'firestore.rules:353',
      passed: isValidTimestampField(incoming.createdAt),
      expected: 'Firestore Timestamp / serverTimestamp() sentinel',
      actual: formatActual(incoming.createdAt),
      remediation: 'Use serverTimestamp() (on create) or preserve existing Timestamp (on update).',
    },
    {
      id: 'schema_updatedAt_is_timestamp',
      ruleExpression: 'data.updatedAt is timestamp',
      location: 'firestore.rules:354',
      passed: isValidTimestampField(incoming.updatedAt),
      expected: 'Firestore Timestamp / serverTimestamp() sentinel',
      actual: formatActual(incoming.updatedAt),
      remediation: 'Set updatedAt to serverTimestamp().',
    },
    {
      id: 'schema_optional_activatedAt',
      ruleExpression: "!('activatedAt' in data) || data.activatedAt is timestamp",
      location: 'firestore.rules:355',
      passed:
        !('activatedAt' in incoming) ||
        incoming.activatedAt === undefined ||
        isValidTimestampField(incoming.activatedAt),
      expected: 'Absent or Firestore Timestamp',
      actual: 'activatedAt' in incoming ? formatActual(incoming.activatedAt) : 'absent',
      remediation: 'Omit activatedAt on create or set to a valid Timestamp on admin update.',
    },
  ];

  for (const check of fieldChecks) {
    pushResult({
      id: check.id,
      ruleExpression: check.ruleExpression,
      firestoreRulesLocation: check.location,
      passed: check.passed,
      expected: check.expected,
      actual: check.actual,
      reason: check.passed
        ? `${check.id} passed.`
        : `${check.id} failed: expected ${check.expected}, got ${check.actual}.`,
      remediation: check.remediation,
    });
  }

  if (operation === 'create') {
    // 5. Path / owner / initial state invariants (firestore.rules:1040-1049)
    const reqIdMatchesPath = incoming.requestId === input.requestId;
    pushResult({
      id: 'create_requestId_matches_path',
      ruleExpression: 'incoming().requestId == requestId',
      firestoreRulesLocation: 'firestore.rules:1040',
      passed: reqIdMatchesPath,
      expected: formatActual(input.requestId),
      actual: formatActual(incoming.requestId),
      reason: reqIdMatchesPath
        ? 'incoming().requestId matches document path ID.'
        : `incoming().requestId (${formatActual(incoming.requestId)}) does not match path requestId (${formatActual(input.requestId)}).`,
      remediation: 'Ensure the payload requestId field equals the Firestore document ID.',
    });

    const uidMatchesAuth = Boolean(input.auth.uid && incoming.uid === input.auth.uid);
    pushResult({
      id: 'create_uid_matches_auth',
      ruleExpression: 'incoming().uid == request.auth.uid',
      firestoreRulesLocation: 'firestore.rules:1041',
      passed: uidMatchesAuth,
      expected: formatActual(input.auth.uid),
      actual: formatActual(incoming.uid),
      reason: uidMatchesAuth
        ? 'incoming().uid matches request.auth.uid.'
        : `incoming().uid (${formatActual(incoming.uid)}) does not match authenticated uid (${formatActual(input.auth.uid)}).`,
      remediation: 'Set payload.uid strictly to auth.currentUser.uid.',
    });

    const statusIsPending = incoming.status === 'PENDING_VERIFICATION';
    pushResult({
      id: 'create_status_pending_verification',
      ruleExpression: "incoming().status == 'PENDING_VERIFICATION'",
      firestoreRulesLocation: 'firestore.rules:1042',
      passed: statusIsPending,
      expected: "'PENDING_VERIFICATION'",
      actual: formatActual(incoming.status),
      reason: statusIsPending
        ? 'Initial status is PENDING_VERIFICATION.'
        : `Client creates must use status='PENDING_VERIFICATION', got ${formatActual(incoming.status)}.`,
      remediation: "Set status to 'PENDING_VERIFICATION'; only backend/admin may activate.",
    });

    const paymentStatusIsPending = incoming.paymentStatus === 'PENDING';
    pushResult({
      id: 'create_paymentStatus_pending',
      ruleExpression: "incoming().paymentStatus == 'PENDING'",
      firestoreRulesLocation: 'firestore.rules:1043',
      passed: paymentStatusIsPending,
      expected: "'PENDING'",
      actual: formatActual(incoming.paymentStatus),
      reason: paymentStatusIsPending
        ? 'Initial paymentStatus is PENDING.'
        : `Client creates must use paymentStatus='PENDING', got ${formatActual(incoming.paymentStatus)}.`,
      remediation: "Set paymentStatus to 'PENDING'; verification happens server-side.",
    });

    const acceptedTermsTrue = incoming.acceptedTerms === true;
    pushResult({
      id: 'create_acceptedTerms_true',
      ruleExpression: 'incoming().acceptedTerms == true',
      firestoreRulesLocation: 'firestore.rules:1044',
      passed: acceptedTermsTrue,
      expected: 'true',
      actual: formatActual(incoming.acceptedTerms),
      reason: acceptedTermsTrue
        ? 'Terms & conditions acceptance flag is true.'
        : `incoming().acceptedTerms must be boolean true, got ${formatActual(incoming.acceptedTerms)}.`,
      remediation: 'Require the user to accept Terms and Conditions before submitting.',
    });

    for (const forbiddenKey of INVESTMENT_REQUEST_FORBIDDEN_CREATE_KEYS) {
      const present = forbiddenKey in incoming && incoming[forbiddenKey] !== undefined;
      pushResult({
        id: `create_absent_${forbiddenKey}`,
        ruleExpression: `!('${forbiddenKey}' in incoming())`,
        firestoreRulesLocation: 'firestore.rules:1045-1049',
        passed: !present,
        expected: `Field '${forbiddenKey}' omitted from create payload`,
        actual: present ? `${forbiddenKey}=${formatActual(incoming[forbiddenKey])}` : 'absent',
        reason: !present
          ? `Server-owned field '${forbiddenKey}' is absent.`
          : `Client create payload includes forbidden server-owned field '${forbiddenKey}'.`,
        remediation: `Remove '${forbiddenKey}' from client create writes; only server/admin can populate it.`,
      });
    }

    // 6. Server timestamps on create (firestore.rules:1050-1051)
    const createdAtIsServerTime = isServerTimestampSentinel(incoming.createdAt);
    pushResult({
      id: 'create_createdAt_server_time',
      ruleExpression: 'incoming().createdAt == request.time',
      firestoreRulesLocation: 'firestore.rules:1050',
      passed: createdAtIsServerTime,
      expected: 'serverTimestamp() sentinel matching request.time',
      actual: formatActual(incoming.createdAt),
      reason: createdAtIsServerTime
        ? 'createdAt uses serverTimestamp().'
        : 'createdAt is not a serverTimestamp() sentinel and will fail incoming().createdAt == request.time.',
      remediation: 'Use Firebase serverTimestamp() for createdAt instead of client Date/Timestamp.',
    });

    const updatedAtIsServerTime = isServerTimestampSentinel(incoming.updatedAt);
    pushResult({
      id: 'create_updatedAt_server_time',
      ruleExpression: 'incoming().updatedAt == request.time',
      firestoreRulesLocation: 'firestore.rules:1051',
      passed: updatedAtIsServerTime,
      expected: 'serverTimestamp() sentinel matching request.time',
      actual: formatActual(incoming.updatedAt),
      reason: updatedAtIsServerTime
        ? 'updatedAt uses serverTimestamp().'
        : 'updatedAt is not a serverTimestamp() sentinel and will fail incoming().updatedAt == request.time.',
      remediation: 'Use Firebase serverTimestamp() for updatedAt instead of client Date/Timestamp.',
    });

    // 7. !exists(investmentRequests/{requestId}) (firestore.rules:1052)
    const docDoesNotExist = !input.existingRequestDoc;
    pushResult({
      id: 'create_doc_not_already_exists',
      ruleExpression: `!(exists(/databases/$(database)/documents/investmentRequests/${input.requestId}))`,
      firestoreRulesLocation: 'firestore.rules:1052',
      passed: docDoesNotExist,
      expected: 'No pre-existing document with the same requestId',
      actual: docDoesNotExist
        ? 'Document does not exist yet'
        : `Existing document found (status=${formatActual(input.existingRequestDoc?.status)})`,
      reason: docDoesNotExist
        ? 'Document ID is unused.'
        : 'A document already exists at this requestId; create cannot overwrite existing investmentRequests.',
      remediation: 'Generate a fresh unique requestId for each new investment request.',
    });

    // 8. Member profile existence, ACTIVE status, and NX userId parity (firestore.rules:1053-1055)
    const userDocExists = Boolean(input.userProfileDoc);
    pushResult({
      id: 'create_user_profile_exists',
      ruleExpression: 'exists(/databases/$(database)/documents/users/$(request.auth.uid))',
      firestoreRulesLocation: 'firestore.rules:1053',
      passed: userDocExists,
      expected: `users/${input.auth.uid || '<uid>'} document exists in database ${databaseId}`,
      actual: userDocExists
        ? `users/${input.auth.uid} exists`
        : `users/${input.auth.uid || '<uid>'} NOT FOUND`,
      reason: userDocExists
        ? 'Authenticated member profile exists in Firestore.'
        : `No user profile document exists at users/${input.auth.uid || '<uid>'} in database '${databaseId}'.`,
      remediation:
        'Complete user profile provisioning in users/{uid} (with NX User ID and ACTIVE status) before creating investmentRequests.',
    });

    const userStatusActive = input.userProfileDoc?.status === 'ACTIVE';
    pushResult({
      id: 'create_user_status_active',
      ruleExpression: "get(/databases/$(database)/documents/users/$(request.auth.uid)).data.status == 'ACTIVE'",
      firestoreRulesLocation: 'firestore.rules:1054',
      passed: userStatusActive,
      expected: "users/{uid}.status == 'ACTIVE'",
      actual: input.userProfileDoc
        ? `users/{uid}.status = ${formatActual(input.userProfileDoc.status)}`
        : 'users/{uid} missing (cannot read status)',
      reason: userStatusActive
        ? "Member account status is 'ACTIVE'."
        : `Member account status is ${input.userProfileDoc ? formatActual(input.userProfileDoc.status) : 'missing'} instead of 'ACTIVE'.`,
      remediation: "Ensure the user's Firestore profile status is 'ACTIVE' (not SUSPENDED or PENDING_VERIFICATION).",
    });

    const profileUserId = input.userProfileDoc?.userId;
    const userIdMatchesProfile = Boolean(
      input.userProfileDoc &&
        typeof incoming.userId === 'string' &&
        incoming.userId === profileUserId
    );
    pushResult({
      id: 'create_userId_matches_profile',
      ruleExpression:
        'incoming().userId == get(/databases/$(database)/documents/users/$(request.auth.uid)).data.userId',
      firestoreRulesLocation: 'firestore.rules:1055',
      passed: userIdMatchesProfile,
      expected: input.userProfileDoc
        ? `incoming().userId == ${formatActual(profileUserId)}`
        : 'users/{uid}.userId available and matching incoming().userId',
      actual: `incoming().userId=${formatActual(incoming.userId)}, users/{uid}.userId=${formatActual(profileUserId)}`,
      reason: userIdMatchesProfile
        ? 'incoming().userId matches users/{uid}.userId.'
        : `incoming().userId (${formatActual(incoming.userId)}) does not match users/{uid}.userId (${formatActual(profileUserId)}).`,
      remediation: 'Pass the exact permanent NX User ID stored in users/{uid}.userId.',
    });

    // 9. isMatchingActiveCatalogOrPublishedPlan(incoming()) (firestore.rules:276-294, 1056)
    evaluateCatalogOrPublishedPlanCondition(incoming, input.productPlanDoc, pushResult);
  } else {
    // operation === 'update' invariants (firestore.rules:1062-1066)
    const existing = input.existingRequestDoc || {};
    const immutableFields: Array<{
      id: string;
      field: string;
      location: string;
    }> = [
      { id: 'update_immutable_requestId', field: 'requestId', location: 'firestore.rules:1062' },
      { id: 'update_immutable_uid', field: 'uid', location: 'firestore.rules:1063' },
      { id: 'update_immutable_userId', field: 'userId', location: 'firestore.rules:1064' },
    ];

    for (const item of immutableFields) {
      const same = Boolean(input.existingRequestDoc) && incoming[item.field] === existing[item.field];
      pushResult({
        id: item.id,
        ruleExpression: `incoming().${item.field} == existing().${item.field}`,
        firestoreRulesLocation: item.location,
        passed: same,
        expected: formatActual(existing[item.field]),
        actual: formatActual(incoming[item.field]),
        reason: same
          ? `${item.field} preserved.`
          : `Immutable field '${item.field}' changed from ${formatActual(existing[item.field])} to ${formatActual(incoming[item.field])}.`,
        remediation: `Keep '${item.field}' identical to the existing document on updates.`,
      });
    }

    const createdAtPreserved =
      Boolean(input.existingRequestDoc) &&
      timestampsEqual(incoming.createdAt, existing.createdAt);
    pushResult({
      id: 'update_immutable_createdAt',
      ruleExpression: 'incoming().createdAt == existing().createdAt',
      firestoreRulesLocation: 'firestore.rules:1065',
      passed: createdAtPreserved,
      expected: formatActual(existing.createdAt),
      actual: formatActual(incoming.createdAt),
      reason: createdAtPreserved
        ? 'createdAt timestamp preserved.'
        : 'createdAt must remain unchanged on update (do not pass serverTimestamp() for createdAt during update).',
      remediation: 'Keep incoming.createdAt equal to existing().createdAt during updates.',
    });

    const updatedAtIsServerTime = isServerTimestampSentinel(incoming.updatedAt);
    pushResult({
      id: 'update_updatedAt_server_time',
      ruleExpression: 'incoming().updatedAt == request.time',
      firestoreRulesLocation: 'firestore.rules:1066',
      passed: updatedAtIsServerTime,
      expected: 'serverTimestamp() sentinel matching request.time',
      actual: formatActual(incoming.updatedAt),
      reason: updatedAtIsServerTime
        ? 'updatedAt uses serverTimestamp().'
        : 'updatedAt must be set to serverTimestamp() on update.',
      remediation: 'Set updatedAt: serverTimestamp() on every update.',
    });
  }

  const failedConditions = results.filter((r) => !r.passed);
  const passedConditions = results.filter((r) => r.passed);
  const allowed = failedConditions.length === 0;
  const firstDenyingCondition = failedConditions[0] ?? null;

  const summary = allowed
    ? `ALLOWED (${operation} on ${collectionPath}): All ${passedConditions.length} local Firestore security rule conditions passed.`
    : `DENIED (${operation} on ${collectionPath}): ${failedConditions.length} condition(s) failed. Primary blocker [${firstDenyingCondition.id}]: ${firstDenyingCondition.reason}`;

  const deploymentDriftNote = allowed
    ? `All conditions in local firestore.rules passed for ${operation} on ${collectionPath}. If Firestore database '${databaseId}' still rejects this write with 'permission-denied' / 'Missing or insufficient permissions', the rules currently deployed to Firebase are out of sync with local firestore.rules (or Cloud Functions processInvestmentRequest / createInvestmentRequest are not deployed and returned 404).`
    : '';

  return {
    allowed,
    operation,
    databaseId,
    collectionPath,
    firstDenyingCondition,
    failedConditions,
    passedConditions,
    summary,
    deploymentDriftNote,
  };
}

function evaluateCatalogOrPublishedPlanCondition(
  incoming: Record<string, unknown>,
  productPlanDoc: Record<string, unknown> | null | undefined,
  pushResult: (item: DiagnosticConditionResult) => void
): void {
  const planId = typeof incoming.planId === 'string' ? incoming.planId : '';

  if (productPlanDoc) {
    const diffs: string[] = [];
    if (productPlanDoc.isActive !== true) {
      diffs.push(`productPlans/${planId}.isActive=${formatActual(productPlanDoc.isActive)} (expected true)`);
    }
    if (incoming.productName !== productPlanDoc.productName) {
      diffs.push(
        `productName: payload=${formatActual(incoming.productName)} vs productPlans=${formatActual(productPlanDoc.productName)}`
      );
    }
    if (incoming.planPriceInr !== productPlanDoc.planPriceInr) {
      diffs.push(
        `planPriceInr: payload=${formatActual(incoming.planPriceInr)} vs productPlans=${formatActual(productPlanDoc.planPriceInr)}`
      );
    }
    if (incoming.coinCost !== productPlanDoc.coinDeductionAmount) {
      diffs.push(
        `coinCost: payload=${formatActual(incoming.coinCost)} vs productPlans.coinDeductionAmount=${formatActual(productPlanDoc.coinDeductionAmount)}`
      );
    }
    if (incoming.durationDays !== productPlanDoc.durationDays) {
      diffs.push(
        `durationDays: payload=${formatActual(incoming.durationDays)} vs productPlans=${formatActual(productPlanDoc.durationDays)}`
      );
    }
    if (incoming.totalRewardEntitlement !== productPlanDoc.totalCoinReward) {
      diffs.push(
        `totalRewardEntitlement: payload=${formatActual(incoming.totalRewardEntitlement)} vs productPlans.totalCoinReward=${formatActual(productPlanDoc.totalCoinReward)}`
      );
    }

    const passed = diffs.length === 0;
    pushResult({
      id: 'create_matches_published_productPlan',
      ruleExpression: 'isMatchingActiveCatalogOrPublishedPlan(incoming()) [published productPlans branch]',
      firestoreRulesLocation: 'firestore.rules:277-285, 1056',
      passed,
      expected: `Active productPlans/${planId} with exact matching productName, planPriceInr, coinDeductionAmount, durationDays, and totalCoinReward`,
      actual: passed ? `Exact match with active productPlans/${planId}` : diffs.join('; '),
      reason: passed
        ? `Payload exactly matches active Firestore productPlans/${planId}.`
        : `Payload does not match active Firestore productPlans/${planId}: ${diffs.join('; ')}.`,
      remediation:
        'Refresh productPlans/{planId} from Firestore (do not fall back to stale client state) and ensure the plan isActive == true.',
    });
    return;
  }

  // Branch B: !exists(productPlans/{planId}) — must match one of the 4 hardcoded catalog plans
  const catalogSpec = BUILT_IN_CATALOG_PLAN_SPECS.find((spec) => spec.planId === planId);
  if (!catalogSpec) {
    pushResult({
      id: 'create_matches_catalog_or_published_plan',
      ruleExpression: 'isMatchingActiveCatalogOrPublishedPlan(incoming()) [built-in catalog branch]',
      firestoreRulesLocation: 'firestore.rules:285-293, 1056',
      passed: false,
      expected: `Published active productPlans/${planId || '<planId>'} doc OR one of built-in planIds (${BUILT_IN_CATALOG_PLAN_SPECS.map((s) => s.planId).join(', ')})`,
      actual: `productPlans/${planId || '<empty>'} does not exist and planId is not a built-in catalog plan`,
      reason: `productPlans/${planId || '<empty>'} was not found in Firestore and '${planId}' is not one of the 4 built-in catalog plans allowed as fallback.`,
      remediation:
        'Publish this custom plan in Firestore /productPlans/{planId} with isActive=true, or select one of the built-in catalog plans.',
    });
    return;
  }

  const diffs: string[] = [];
  if (incoming.productName !== catalogSpec.productName) {
    diffs.push(
      `productName: payload=${formatActual(incoming.productName)} vs catalog=${formatActual(catalogSpec.productName)}`
    );
  }
  if (incoming.planPriceInr !== catalogSpec.planPriceInr) {
    diffs.push(
      `planPriceInr: payload=${formatActual(incoming.planPriceInr)} vs catalog=${catalogSpec.planPriceInr}`
    );
  }
  if (incoming.coinCost !== catalogSpec.coinCost) {
    diffs.push(
      `coinCost: payload=${formatActual(incoming.coinCost)} vs catalog=${catalogSpec.coinCost}`
    );
  }
  if (incoming.durationDays !== catalogSpec.durationDays) {
    diffs.push(
      `durationDays: payload=${formatActual(incoming.durationDays)} vs catalog=${catalogSpec.durationDays}`
    );
  }
  if (incoming.totalRewardEntitlement !== catalogSpec.totalRewardEntitlement) {
    diffs.push(
      `totalRewardEntitlement: payload=${formatActual(incoming.totalRewardEntitlement)} vs catalog=${catalogSpec.totalRewardEntitlement}`
    );
  }

  const passed = diffs.length === 0;
  pushResult({
    id: 'create_matches_catalog_or_published_plan',
    ruleExpression: 'isMatchingActiveCatalogOrPublishedPlan(incoming()) [built-in catalog branch]',
    firestoreRulesLocation: 'firestore.rules:285-293, 1056',
    passed,
    expected: `Exact built-in spec for ${catalogSpec.planId}: ${safeSerialize(catalogSpec)}`,
    actual: passed ? `Exact match with built-in ${catalogSpec.planId}` : diffs.join('; '),
    reason: passed
      ? `Payload exactly matches built-in catalog fallback for ${catalogSpec.planId}.`
      : `productPlans/${catalogSpec.planId} is missing and payload drifted from built-in catalog rule values: ${diffs.join('; ')}.`,
    remediation:
      'Align payload fields with the built-in catalog values or publish the authoritative plan document in Firestore /productPlans/{planId}.',
  });
}
