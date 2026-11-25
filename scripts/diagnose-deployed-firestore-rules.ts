import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serverTimestamp } from 'firebase/firestore';
import { ILLUSTRATIVE_PLANS } from '../src/data/catalogPreview';
import {
  buildExpectedInvestmentRequestPayload,
  diagnoseInvestmentRequestRules,
  InvestmentRequestAuthContext,
  InvestmentRequestRuleDiagnosticReport,
} from '../src/utils/investmentRulesDiagnostic';

export const TARGET_PROJECT_ID = 'nexora-invest-e4399';
export const TARGET_PROJECT_NUMBER = '687715631087';
export const DEFAULT_FIRESTORE_DATABASE_ID =
  'ai-studio-nexorainvest-c25f96bd-2963-4ef8-b030-e5a6fe625870';

export interface CliOptions {
  projectId: string;
  databaseId: string;
  localRulesPath: string;
  json: boolean;
  summaryOnly: boolean;
  localOnly: boolean;
  requireLive: boolean;
}

export interface AccessTokenResolution {
  token: string | null;
  source: string;
  notes: string[];
}

export interface FirebaseRuleFile {
  name: string;
  content: string;
}

export interface DeployedRulesFetchResult {
  fetchedLive: boolean;
  projectId: string;
  databaseId: string;
  tokenSource: string;
  releaseName: string | null;
  rulesetName: string | null;
  rulesetCreateTime: string | null;
  rulesContent: string | null;
  rulesSourceLabel: 'LIVE_DEPLOYED' | 'LOCAL_FALLBACK';
  localRulesSha256: string | null;
  deployedRulesSha256: string | null;
  matchesLocalRules: boolean | null;
  errorStatus: number | null;
  errorMessage: string | null;
  authDiagnostics: string[];
}

export interface RulesBlockExtraction {
  investmentRequestsMatchBlock: string | null;
  allowCreateExpression: string | null;
  allowCreateClauses: string[];
  helperFunctions: Record<string, string | null>;
}

export interface MockEvaluationScenarioResult {
  name: string;
  description: string;
  report: InvestmentRequestRuleDiagnosticReport;
}

export interface DiagnosticScriptOutput {
  generatedAt: string;
  projectId: string;
  projectNumber: string;
  databaseId: string;
  deployedRules: DeployedRulesFetchResult;
  extractedRules: RulesBlockExtraction;
  mockAuthenticatedRequest: {
    auth: InvestmentRequestAuthContext;
    userProfileDoc: Record<string, unknown>;
    productPlanDoc: Record<string, unknown>;
    requestId: string;
    payload: Record<string, unknown>;
  };
  primaryEvaluation: InvestmentRequestRuleDiagnosticReport;
  clauseChecklist: Array<{
    clause: string;
    presentInInspectedRules: boolean;
    conditionIds: string[];
    passed: boolean;
  }>;
  negativeDiagnosticScenarios: MockEvaluationScenarioResult[];
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function loadDefaultDatabaseIdFromAppletConfig(cwd = process.cwd()): string {
  const configPath = path.resolve(cwd, 'firebase-applet-config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as { firestoreDatabaseId?: string };
    if (
      typeof parsed.firestoreDatabaseId === 'string' &&
      parsed.firestoreDatabaseId.trim().length > 0
    ) {
      return parsed.firestoreDatabaseId.trim();
    }
  } catch {
    // Fall back to known provisioned database ID
  }
  return DEFAULT_FIRESTORE_DATABASE_ID;
}

export function parseCliArgs(argv: string[], cwd = process.cwd()): CliOptions {
  let projectId = TARGET_PROJECT_ID;
  let databaseId = loadDefaultDatabaseIdFromAppletConfig(cwd);
  let localRulesPath = path.resolve(cwd, 'firestore.rules');
  let json = false;
  let summaryOnly = false;
  let localOnly = false;
  let requireLive = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project' && argv[i + 1]) {
      projectId = argv[++i];
    } else if (arg === '--database' && argv[i + 1]) {
      databaseId = argv[++i];
    } else if (arg === '--rules-file' && argv[i + 1]) {
      localRulesPath = path.resolve(cwd, argv[++i]);
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--summary-only') {
      summaryOnly = true;
    } else if (arg === '--local-only') {
      localOnly = true;
    } else if (arg === '--require-live') {
      requireLive = true;
    }
  }

  return {
    projectId,
    databaseId,
    localRulesPath,
    json,
    summaryOnly,
    localOnly,
    requireLive,
  };
}

export async function resolveGoogleAccessToken(
  options: { timeoutMs?: number } = {}
): Promise<AccessTokenResolution> {
  const notes: string[] = [];
  const timeoutMs = options.timeoutMs ?? 2000;

  const envToken =
    process.env.FIREBASE_RULES_ACCESS_TOKEN ||
    process.env.GOOGLE_OAUTH_ACCESS_TOKEN ||
    process.env.ACCESS_TOKEN;
  if (envToken && envToken.trim().length > 0) {
    return {
      token: envToken.trim(),
      source: 'env:FIREBASE_RULES_ACCESS_TOKEN/GOOGLE_OAUTH_ACCESS_TOKEN',
      notes,
    };
  }
  notes.push('No FIREBASE_RULES_ACCESS_TOKEN or GOOGLE_OAUTH_ACCESS_TOKEN env var set.');

  // Check Firebase CLI cached OAuth tokens (~/.config/configstore/firebase-tools.json)
  const firebaseToolsPath = path.join(
    os.homedir(),
    '.config',
    'configstore',
    'firebase-tools.json'
  );
  try {
    if (fs.existsSync(firebaseToolsPath)) {
      const raw = fs.readFileSync(firebaseToolsPath, 'utf8');
      const parsed = JSON.parse(raw) as {
        tokens?: { access_token?: string; expires_at?: number };
        user?: { email?: string };
      };
      const accessToken = parsed.tokens?.access_token;
      const expiresAt = parsed.tokens?.expires_at ?? 0;
      if (accessToken && (expiresAt === 0 || expiresAt > Date.now() + 30_000)) {
        return {
          token: accessToken,
          source: `firebase-tools (${parsed.user?.email || 'cached user'})`,
          notes,
        };
      }
      notes.push('firebase-tools.json exists but has no active non-expired access_token.');
    } else {
      notes.push('No ~/.config/configstore/firebase-tools.json found.');
    }
  } catch (err) {
    notes.push(
      `Could not read firebase-tools.json: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Check gcloud CLI if installed
  for (const args of [
    ['auth', 'print-access-token'],
    ['auth', 'application-default', 'print-access-token'],
  ]) {
    try {
      const output = execFileSync('gcloud', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs,
      }).trim();
      if (output) {
        return {
          token: output,
          source: `gcloud ${args.join(' ')}`,
          notes,
        };
      }
    } catch {
      // Ignore when gcloud is unavailable or unauthenticated
    }
  }
  notes.push('gcloud CLI unavailable or has no active access token.');

  // Check GCE/Cloud Run metadata server (short timeout so local runs stay fast)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: controller.signal,
      }
    );
    clearTimeout(timer);
    if (res.ok) {
      const body = (await res.json()) as { access_token?: string };
      if (body.access_token) {
        return {
          token: body.access_token,
          source: 'gcp-metadata-server',
          notes,
        };
      }
    } else {
      notes.push(`Metadata server responded with HTTP ${res.status}.`);
    }
  } catch {
    notes.push('GCP metadata server not reachable or timed out.');
  }

  return { token: null, source: 'none', notes };
}

interface FirebaseReleaseItem {
  name: string;
  rulesetName?: string;
  createTime?: string;
  updateTime?: string;
}

interface FirebaseRulesetResponse {
  name?: string;
  createTime?: string;
  source?: {
    files?: FirebaseRuleFile[];
  };
}

export async function fetchDeployedFirestoreRules(params: {
  projectId: string;
  databaseId: string;
  localRulesPath: string;
  localOnly?: boolean;
  tokenOverride?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<DeployedRulesFetchResult> {
  const fetchFn = params.fetchImpl ?? fetch;
  const localRulesContent = fs.existsSync(params.localRulesPath)
    ? fs.readFileSync(params.localRulesPath, 'utf8')
    : null;
  const localRulesSha256 = localRulesContent !== null ? sha256(localRulesContent) : null;

  if (params.localOnly) {
    return {
      fetchedLive: false,
      projectId: params.projectId,
      databaseId: params.databaseId,
      tokenSource: 'skipped (--local-only)',
      releaseName: null,
      rulesetName: null,
      rulesetCreateTime: null,
      rulesContent: localRulesContent,
      rulesSourceLabel: 'LOCAL_FALLBACK',
      localRulesSha256,
      deployedRulesSha256: null,
      matchesLocalRules: null,
      errorStatus: null,
      errorMessage: 'Skipped live Firebase Rules API request due to --local-only flag.',
      authDiagnostics: [],
    };
  }

  const tokenResolution =
    params.tokenOverride !== undefined
      ? {
          token: params.tokenOverride,
          source: params.tokenOverride ? 'injected-token' : 'none',
          notes: [],
        }
      : await resolveGoogleAccessToken();

  if (!tokenResolution.token) {
    return {
      fetchedLive: false,
      projectId: params.projectId,
      databaseId: params.databaseId,
      tokenSource: tokenResolution.source,
      releaseName: null,
      rulesetName: null,
      rulesetCreateTime: null,
      rulesContent: localRulesContent,
      rulesSourceLabel: 'LOCAL_FALLBACK',
      localRulesSha256,
      deployedRulesSha256: null,
      matchesLocalRules: null,
      errorStatus: 401,
      errorMessage:
        'No OAuth2 access token available to call firebaserules.googleapis.com for project ' +
        `'${params.projectId}'.`,
      authDiagnostics: tokenResolution.notes,
    };
  }

  const headers = {
    Authorization: `Bearer ${tokenResolution.token}`,
    Accept: 'application/json',
  };

  try {
    const releasesUrl = `https://firebaserules.googleapis.com/v1/projects/${encodeURIComponent(
      params.projectId
    )}/releases`;
    const releasesRes = await fetchFn(releasesUrl, { headers });
    const releasesText = await releasesRes.text();

    if (!releasesRes.ok) {
      let parsedMessage = releasesText;
      try {
        const errJson = JSON.parse(releasesText) as { error?: { message?: string } };
        if (errJson.error?.message) {
          parsedMessage = errJson.error.message;
        }
      } catch {
        // Keep raw body
      }
      return {
        fetchedLive: false,
        projectId: params.projectId,
        databaseId: params.databaseId,
        tokenSource: tokenResolution.source,
        releaseName: null,
        rulesetName: null,
        rulesetCreateTime: null,
        rulesContent: localRulesContent,
        rulesSourceLabel: 'LOCAL_FALLBACK',
        localRulesSha256,
        deployedRulesSha256: null,
        matchesLocalRules: null,
        errorStatus: releasesRes.status,
        errorMessage: parsedMessage,
        authDiagnostics: tokenResolution.notes,
      };
    }

    const releasesData = JSON.parse(releasesText) as { releases?: FirebaseReleaseItem[] };
    const releases = releasesData.releases ?? [];
    const exactSuffix = `/releases/cloud.firestore/${params.databaseId}`;
    const defaultSuffix = '/releases/cloud.firestore';
    const matchedRelease =
      releases.find((r) => r.name.endsWith(exactSuffix)) ??
      releases.find((r) => r.name.endsWith(defaultSuffix)) ??
      releases.find((r) => r.name.includes('/releases/cloud.firestore'));

    if (!matchedRelease?.rulesetName) {
      return {
        fetchedLive: false,
        projectId: params.projectId,
        databaseId: params.databaseId,
        tokenSource: tokenResolution.source,
        releaseName: matchedRelease?.name ?? null,
        rulesetName: null,
        rulesetCreateTime: null,
        rulesContent: localRulesContent,
        rulesSourceLabel: 'LOCAL_FALLBACK',
        localRulesSha256,
        deployedRulesSha256: null,
        matchesLocalRules: null,
        errorStatus: 404,
        errorMessage:
          `No cloud.firestore release found in project '${params.projectId}' for database ` +
          `'${params.databaseId}'. Found releases: ${releases.map((r) => r.name).join(', ') || 'none'}.`,
        authDiagnostics: tokenResolution.notes,
      };
    }

    const rulesetUrl = `https://firebaserules.googleapis.com/v1/${matchedRelease.rulesetName}`;
    const rulesetRes = await fetchFn(rulesetUrl, { headers });
    const rulesetText = await rulesetRes.text();

    if (!rulesetRes.ok) {
      return {
        fetchedLive: false,
        projectId: params.projectId,
        databaseId: params.databaseId,
        tokenSource: tokenResolution.source,
        releaseName: matchedRelease.name,
        rulesetName: matchedRelease.rulesetName,
        rulesetCreateTime: null,
        rulesContent: localRulesContent,
        rulesSourceLabel: 'LOCAL_FALLBACK',
        localRulesSha256,
        deployedRulesSha256: null,
        matchesLocalRules: null,
        errorStatus: rulesetRes.status,
        errorMessage: rulesetText,
        authDiagnostics: tokenResolution.notes,
      };
    }

    const rulesetData = JSON.parse(rulesetText) as FirebaseRulesetResponse;
    const files = rulesetData.source?.files ?? [];
    const primaryRulesFile =
      files.find((f) => f.name.endsWith('firestore.rules')) ?? files[0];
    const deployedContent = primaryRulesFile?.content ?? '';
    const deployedRulesSha256 = sha256(deployedContent);

    return {
      fetchedLive: true,
      projectId: params.projectId,
      databaseId: params.databaseId,
      tokenSource: tokenResolution.source,
      releaseName: matchedRelease.name,
      rulesetName: rulesetData.name ?? matchedRelease.rulesetName,
      rulesetCreateTime: rulesetData.createTime ?? matchedRelease.updateTime ?? null,
      rulesContent: deployedContent,
      rulesSourceLabel: 'LIVE_DEPLOYED',
      localRulesSha256,
      deployedRulesSha256,
      matchesLocalRules:
        localRulesSha256 !== null ? deployedRulesSha256 === localRulesSha256 : null,
      errorStatus: null,
      errorMessage: null,
      authDiagnostics: tokenResolution.notes,
    };
  } catch (err) {
    return {
      fetchedLive: false,
      projectId: params.projectId,
      databaseId: params.databaseId,
      tokenSource: tokenResolution.source,
      releaseName: null,
      rulesetName: null,
      rulesetCreateTime: null,
      rulesContent: localRulesContent,
      rulesSourceLabel: 'LOCAL_FALLBACK',
      localRulesSha256,
      deployedRulesSha256: null,
      matchesLocalRules: null,
      errorStatus: null,
      errorMessage: err instanceof Error ? err.message : String(err),
      authDiagnostics: tokenResolution.notes,
    };
  }
}

export function extractBraceBlock(source: string, headerPattern: RegExp): string | null {
  const match = headerPattern.exec(source);
  if (!match) return null;
  const openBraceIdx = match.index + match[0].length - 1;
  if (source[openBraceIdx] !== '{') return null;

  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = openBraceIdx; i < source.length; i += 1) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (inSingleQuote || inDoubleQuote) continue;

    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(match.index, i + 1);
      }
    }
  }
  return null;
}

export function extractInvestmentRequestsRulesSnapshot(
  rulesContent: string | null
): RulesBlockExtraction {
  if (!rulesContent) {
    return {
      investmentRequestsMatchBlock: null,
      allowCreateExpression: null,
      allowCreateClauses: [],
      helperFunctions: {},
    };
  }

  const investmentRequestsMatchBlock = extractBraceBlock(
    rulesContent,
    /match\s+\/investmentRequests\/\{requestId\}\s*\{/
  );

  let allowCreateExpression: string | null = null;
  let allowCreateClauses: string[] = [];

  if (investmentRequestsMatchBlock) {
    const createMatch = investmentRequestsMatchBlock.match(
      /allow\s+create:\s*if\s+([\s\S]*?);/
    );
    if (createMatch) {
      allowCreateExpression = createMatch[1].trim();
      allowCreateClauses = allowCreateExpression
        .split('&&')
        .map((c) => c.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    }
  }

  const helperFunctions: Record<string, string | null> = {
    isSignedIn: extractBraceBlock(rulesContent, /function\s+isSignedIn\s*\([^)]*\)\s*\{/),
    isValidId: extractBraceBlock(rulesContent, /function\s+isValidId\s*\([^)]*\)\s*\{/),
    isAdmin: extractBraceBlock(rulesContent, /function\s+isAdmin\s*\([^)]*\)\s*\{/),
    isValidInvestmentRequest: extractBraceBlock(
      rulesContent,
      /function\s+isValidInvestmentRequest\s*\([^)]*\)\s*\{/
    ),
    isMatchingActiveCatalogOrPublishedPlan: extractBraceBlock(
      rulesContent,
      /function\s+isMatchingActiveCatalogOrPublishedPlan\s*\([^)]*\)\s*\{/
    ),
  };

  return {
    investmentRequestsMatchBlock,
    allowCreateExpression,
    allowCreateClauses,
    helperFunctions,
  };
}

export function runInvestmentRequestsMockEvaluation(params: {
  databaseId: string;
  extractedRules: RulesBlockExtraction;
}): Pick<
  DiagnosticScriptOutput,
  | 'mockAuthenticatedRequest'
  | 'primaryEvaluation'
  | 'clauseChecklist'
  | 'negativeDiagnosticScenarios'
> {
  const mockAuth: InvestmentRequestAuthContext = {
    isAuthenticated: true,
    uid: 'mock_auth_user_nexora_001',
    email: 'member.diagnostic@nexora-invest.example',
    emailVerified: true,
    signInProvider: 'password',
    isAnonymous: false,
  };

  const mockUserProfileDoc: Record<string, unknown> = {
    uid: mockAuth.uid,
    userId: 'NX100001',
    role: 'USER',
    fullName: 'Mock Diagnostic Member',
    email: mockAuth.email,
    mobile: '+919999999999',
    emailVerified: true,
    mobileVerified: true,
    authProvider: 'password',
    status: 'ACTIVE',
  };

  const selectedPlan = ILLUSTRATIVE_PLANS[0];
  const mockProductPlanDoc: Record<string, unknown> = {
    planId: selectedPlan.planId,
    productName: selectedPlan.productName,
    planPriceInr: selectedPlan.planPriceInr,
    coinDeductionAmount: selectedPlan.coinDeductionAmount,
    durationDays: selectedPlan.durationDays,
    totalCoinReward: selectedPlan.totalCoinReward,
    isActive: true,
  };

  const requestId = 'invreq_mock_1795500000000_a1b2c3d4e5f6';
  const payload = buildExpectedInvestmentRequestPayload({
    requestId,
    uid: mockAuth.uid!,
    userId: String(mockUserProfileDoc.userId),
    plan: selectedPlan,
    acceptedTerms: true,
    idempotencyKey: 'idem_mock_a1b2c3d4e5f6',
    createdAtSentinel: serverTimestamp(),
    updatedAtSentinel: serverTimestamp(),
  });

  const primaryEvaluation = diagnoseInvestmentRequestRules({
    operation: 'create',
    requestId,
    auth: mockAuth,
    incomingData: payload,
    existingRequestDoc: null,
    userProfileDoc: mockUserProfileDoc,
    productPlanDoc: mockProductPlanDoc,
    databaseId: params.databaseId,
  });

  const conditionStatusById = new Map<string, boolean>();
  for (const c of primaryEvaluation.passedConditions) conditionStatusById.set(c.id, true);
  for (const c of primaryEvaluation.failedConditions) conditionStatusById.set(c.id, false);

  const clauseMapping: Array<{ pattern: RegExp; conditionIds: string[] }> = [
    { pattern: /^isSignedIn\(\)$/, conditionIds: ['isSignedIn'] },
    { pattern: /^isValidId\(requestId\)$/, conditionIds: ['path_isValidId'] },
    {
      pattern: /^isValidInvestmentRequest\(incoming\(\)\)$/,
      conditionIds: [
        'schema_required_keys',
        'schema_allowed_keys_only',
        'schema_requestId',
        'schema_uid',
        'schema_userId',
        'schema_planId',
        'schema_productName',
        'schema_planPriceInr',
        'schema_coinCost',
        'schema_durationDays',
        'schema_totalRewardEntitlement',
        'schema_acceptedTerms_type',
        'schema_idempotencyKey',
        'schema_status_enum',
        'schema_paymentStatus_enum',
        'schema_createdAt_is_timestamp',
        'schema_updatedAt_is_timestamp',
      ],
    },
    { pattern: /^incoming\(\)\.requestId == requestId$/, conditionIds: ['create_requestId_matches_path'] },
    { pattern: /^incoming\(\)\.uid == request\.auth\.uid$/, conditionIds: ['create_uid_matches_auth'] },
    { pattern: /^incoming\(\)\.status == 'PENDING_VERIFICATION'$/, conditionIds: ['create_status_pending_verification'] },
    { pattern: /^incoming\(\)\.paymentStatus == 'PENDING'$/, conditionIds: ['create_paymentStatus_pending'] },
    { pattern: /^incoming\(\)\.acceptedTerms == true$/, conditionIds: ['create_acceptedTerms_true'] },
    { pattern: /^!\('activatedUserPlanId' in incoming\(\)\)$/, conditionIds: ['create_absent_activatedUserPlanId'] },
    { pattern: /^!\('coinTransactionId' in incoming\(\)\)$/, conditionIds: ['create_absent_coinTransactionId'] },
    { pattern: /^!\('verifiedByUid' in incoming\(\)\)$/, conditionIds: ['create_absent_verifiedByUid'] },
    { pattern: /^!\('failureReason' in incoming\(\)\)$/, conditionIds: ['create_absent_failureReason'] },
    { pattern: /^!\('activatedAt' in incoming\(\)\)$/, conditionIds: ['create_absent_activatedAt'] },
    { pattern: /^incoming\(\)\.createdAt == request\.time$/, conditionIds: ['create_createdAt_server_time'] },
    { pattern: /^incoming\(\)\.updatedAt == request\.time$/, conditionIds: ['create_updatedAt_server_time'] },
    { pattern: /^!exists\(\/databases\/\$\(database\)\/documents\/investmentRequests\/\$\(requestId\)\)$/, conditionIds: ['create_doc_not_already_exists'] },
    { pattern: /^exists\(\/databases\/\$\(database\)\/documents\/users\/\$\(request\.auth\.uid\)\)$/, conditionIds: ['create_user_profile_exists'] },
    { pattern: /^get\(\/databases\/\$\(database\)\/documents\/users\/\$\(request\.auth\.uid\)\)\.data\.status == 'ACTIVE'$/, conditionIds: ['create_user_status_active'] },
    { pattern: /^incoming\(\)\.userId == get\(\/databases\/\$\(database\)\/documents\/users\/\$\(request\.auth\.uid\)\)\.data\.userId$/, conditionIds: ['create_userId_matches_profile'] },
    {
      pattern: /^isMatchingActiveCatalogOrPublishedPlan\(incoming\(\)\)$/,
      conditionIds: ['create_matches_published_productPlan', 'create_matches_catalog_or_published_plan'],
    },
  ];

  const clauseChecklist = params.extractedRules.allowCreateClauses.map((clause) => {
    const matchedMapping = clauseMapping.find((m) => m.pattern.test(clause));
    const conditionIds = matchedMapping?.conditionIds ?? [];
    const evaluatedIds = conditionIds.filter((id) => conditionStatusById.has(id));
    const passed =
      evaluatedIds.length > 0 && evaluatedIds.every((id) => conditionStatusById.get(id) === true);

    return {
      clause,
      presentInInspectedRules: true,
      conditionIds: evaluatedIds,
      passed,
    };
  });

  const negativeDiagnosticScenarios: MockEvaluationScenarioResult[] = [
    {
      name: 'missing_user_profile',
      description: 'Authenticated Firebase user whose users/{uid} profile doc does not exist yet',
      report: diagnoseInvestmentRequestRules({
        operation: 'create',
        requestId,
        auth: mockAuth,
        incomingData: payload,
        existingRequestDoc: null,
        userProfileDoc: null,
        productPlanDoc: mockProductPlanDoc,
        databaseId: params.databaseId,
      }),
    },
    {
      name: 'user_status_not_active',
      description: "Authenticated user whose users/{uid}.status is 'PENDING_VERIFICATION' instead of 'ACTIVE'",
      report: diagnoseInvestmentRequestRules({
        operation: 'create',
        requestId,
        auth: mockAuth,
        incomingData: payload,
        existingRequestDoc: null,
        userProfileDoc: { ...mockUserProfileDoc, status: 'PENDING_VERIFICATION' },
        productPlanDoc: mockProductPlanDoc,
        databaseId: params.databaseId,
      }),
    },
    {
      name: 'anonymous_auth_session',
      description: 'Anonymous Firebase Auth session (rejected by isSignedIn())',
      report: diagnoseInvestmentRequestRules({
        operation: 'create',
        requestId,
        auth: {
          ...mockAuth,
          signInProvider: 'anonymous',
          isAnonymous: true,
        },
        incomingData: payload,
        existingRequestDoc: null,
        userProfileDoc: mockUserProfileDoc,
        productPlanDoc: mockProductPlanDoc,
        databaseId: params.databaseId,
      }),
    },
    {
      name: 'tampered_status_and_cost',
      description: "Client attempts self-activation (status='ACTIVATED') and reduced coinCost=1",
      report: diagnoseInvestmentRequestRules({
        operation: 'create',
        requestId,
        auth: mockAuth,
        incomingData: {
          ...payload,
          status: 'ACTIVATED',
          paymentStatus: 'VERIFIED',
          coinCost: 1,
        },
        existingRequestDoc: null,
        userProfileDoc: mockUserProfileDoc,
        productPlanDoc: mockProductPlanDoc,
        databaseId: params.databaseId,
      }),
    },
  ];

  return {
    mockAuthenticatedRequest: {
      auth: mockAuth,
      userProfileDoc: mockUserProfileDoc,
      productPlanDoc: mockProductPlanDoc,
      requestId,
      payload,
    },
    primaryEvaluation,
    clauseChecklist,
    negativeDiagnosticScenarios,
  };
}

export function formatDiagnosticText(
  output: DiagnosticScriptOutput,
  options: { summaryOnly?: boolean } = {}
): string {
  const lines: string[] = [];
  const hr = '='.repeat(80);
  const subHr = '-'.repeat(80);

  lines.push(hr);
  lines.push(
    `NEXORA INVEST — FIRESTORE SECURITY RULES & investmentRequests WRITE DIAGNOSTIC`
  );
  lines.push(hr);
  lines.push(`Generated At        : ${output.generatedAt}`);
  lines.push(`Target Project ID   : ${output.projectId} (Project Number: ${output.projectNumber})`);
  lines.push(`Target Database ID  : ${output.databaseId}`);
  lines.push('');

  lines.push('1. CURRENTLY DEPLOYED FIRESTORE SECURITY RULES');
  lines.push(subHr);
  lines.push(`Rules Source        : ${output.deployedRules.rulesSourceLabel}`);
  lines.push(`Fetched Live        : ${output.deployedRules.fetchedLive ? 'YES' : 'NO'}`);
  lines.push(`Token Source        : ${output.deployedRules.tokenSource}`);
  if (output.deployedRules.releaseName) {
    lines.push(`Release Name        : ${output.deployedRules.releaseName}`);
  }
  if (output.deployedRules.rulesetName) {
    lines.push(`Ruleset Name        : ${output.deployedRules.rulesetName}`);
  }
  if (output.deployedRules.rulesetCreateTime) {
    lines.push(`Ruleset Timestamp   : ${output.deployedRules.rulesetCreateTime}`);
  }
  if (output.deployedRules.deployedRulesSha256) {
    lines.push(`Deployed SHA-256    : ${output.deployedRules.deployedRulesSha256}`);
  }
  if (output.deployedRules.localRulesSha256) {
    lines.push(`Local SHA-256       : ${output.deployedRules.localRulesSha256}`);
  }
  if (output.deployedRules.matchesLocalRules !== null) {
    lines.push(
      `Parity vs Local     : ${
        output.deployedRules.matchesLocalRules
          ? 'MATCHES local firestore.rules byte-for-byte'
          : 'DRIFT DETECTED (live deployed rules differ from local firestore.rules)'
      }`
    );
  }

  if (!output.deployedRules.fetchedLive) {
    lines.push('');
    lines.push(
      `[LIVE FETCH UNAVAILABLE${
        output.deployedRules.errorStatus ? ` — HTTP ${output.deployedRules.errorStatus}` : ''
      }]`
    );
    lines.push(`Reason: ${output.deployedRules.errorMessage || 'Unknown error'}`);
    if (output.deployedRules.authDiagnostics.length > 0) {
      lines.push('Auth Probe Notes:');
      for (const note of output.deployedRules.authDiagnostics) {
        lines.push(`  - ${note}`);
      }
    }
    lines.push('To print live deployed rules directly from your authenticated machine:');
    lines.push(
      '  export FIREBASE_RULES_ACCESS_TOKEN="$(gcloud auth print-access-token)"'
    );
    lines.push(
      `  npx tsx scripts/diagnose-deployed-firestore-rules.ts --project ${output.projectId} --database ${output.databaseId}`
    );
    lines.push(
      'Falling back below to LOCAL workspace firestore.rules for structural inspection (labeled LOCAL_FALLBACK).'
    );
  }

  if (output.deployedRules.rulesContent) {
    if (!options.summaryOnly) {
      lines.push('');
      lines.push(
        `--- ${
          output.deployedRules.fetchedLive
            ? 'LIVE DEPLOYED firestore.rules'
            : 'LOCAL WORKSPACE firestore.rules (FALLBACK)'
        } ---`
      );
      const numberedLines = output.deployedRules.rulesContent
        .split('\n')
        .map((line, idx) => `${String(idx + 1).padStart(4, ' ')}: ${line}`);
      lines.push(...numberedLines);
      lines.push('--- END OF RULESET ---');
    } else {
      lines.push(
        `Ruleset Length      : ${output.deployedRules.rulesContent.split('\n').length} lines (pass without --summary-only to print full file)`
      );
    }
  } else {
    lines.push('No rules content available to print.');
  }

  lines.push('');
  lines.push('2. EXTRACTED match /investmentRequests/{requestId} RULE BLOCK');
  lines.push(subHr);
  if (output.extractedRules.investmentRequestsMatchBlock) {
    lines.push(output.extractedRules.investmentRequestsMatchBlock);
  } else {
    lines.push('WARNING: match /investmentRequests/{requestId} block was NOT found in rules!');
  }

  lines.push('');
  lines.push('3. MOCK AUTHENTICATED USER REQUEST PAYLOAD & CONTEXT');
  lines.push(subHr);
  lines.push(`Document Path       : investmentRequests/${output.mockAuthenticatedRequest.requestId}`);
  lines.push(`Auth Context        : ${JSON.stringify(output.mockAuthenticatedRequest.auth)}`);
  lines.push(
    `users/{uid} Doc     : ${JSON.stringify(output.mockAuthenticatedRequest.userProfileDoc)}`
  );
  lines.push(
    `productPlans Doc    : ${JSON.stringify(output.mockAuthenticatedRequest.productPlanDoc)}`
  );
  lines.push(
    `Create Payload      : ${JSON.stringify(output.mockAuthenticatedRequest.payload)}`
  );

  lines.push('');
  lines.push('4. EVALUATION OF investmentRequests WRITE CONDITIONS (PRIMARY MOCK REQUEST)');
  lines.push(subHr);
  lines.push(`Verdict             : ${output.primaryEvaluation.allowed ? 'ALLOWED' : 'DENIED'}`);
  lines.push(`Summary             : ${output.primaryEvaluation.summary}`);
  lines.push(
    `Passed / Failed     : ${output.primaryEvaluation.passedConditions.length} passed, ${output.primaryEvaluation.failedConditions.length} failed`
  );
  if (output.clauseChecklist.length > 0) {
    lines.push('');
    lines.push('Extracted allow create Clauses Evaluation:');
    output.clauseChecklist.forEach((item, index) => {
      lines.push(
        `  ${String(index + 1).padStart(2, ' ')}. [${item.passed ? 'PASS' : 'FAIL'}] ${item.clause}`
      );
    });
  }

  if (output.primaryEvaluation.failedConditions.length > 0) {
    lines.push('');
    lines.push('Failed Conditions Detail:');
    for (const cond of output.primaryEvaluation.failedConditions) {
      lines.push(`  - [${cond.id}] (${cond.firestoreRulesLocation}) ${cond.reason}`);
      lines.push(`    Remediation: ${cond.remediation}`);
    }
  }

  lines.push('');
  lines.push('5. NEGATIVE / ADVERSARIAL SCENARIO CHECKS (WHY WRITES GET DENIED)');
  lines.push(subHr);
  for (const scenario of output.negativeDiagnosticScenarios) {
    const firstFail = scenario.report.firstDenyingCondition;
    lines.push(
      `  - ${scenario.name}: ${scenario.report.allowed ? 'ALLOWED (UNEXPECTED)' : 'DENIED'} — ${scenario.description}`
    );
    if (firstFail) {
      lines.push(
        `    First Blocker: [${firstFail.id}] (${firstFail.firestoreRulesLocation}) -> ${firstFail.reason}`
      );
    }
  }

  lines.push(hr);
  return lines.join('\n');
}

export async function runDiagnostic(options: CliOptions): Promise<DiagnosticScriptOutput> {
  const deployedRules = await fetchDeployedFirestoreRules({
    projectId: options.projectId,
    databaseId: options.databaseId,
    localRulesPath: options.localRulesPath,
    localOnly: options.localOnly,
  });

  const extractedRules = extractInvestmentRequestsRulesSnapshot(deployedRules.rulesContent);
  const evalResult = runInvestmentRequestsMockEvaluation({
    databaseId: options.databaseId,
    extractedRules,
  });

  return {
    generatedAt: new Date().toISOString(),
    projectId: options.projectId,
    projectNumber: TARGET_PROJECT_NUMBER,
    databaseId: options.databaseId,
    deployedRules,
    extractedRules,
    ...evalResult,
  };
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const output = await runDiagnostic(options);

  if (options.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(formatDiagnosticText(output, { summaryOnly: options.summaryOnly }));
  }

  if (options.requireLive && !output.deployedRules.fetchedLive) {
    process.exitCode = 1;
  }
}

const isEntryModule =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  path.resolve(process.argv[1]).endsWith('diagnose-deployed-firestore-rules.ts');

if (isEntryModule) {
  void main().catch((err) => {
    console.error('Diagnostic failed:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
