import { inspectCloudFunctionError } from './cloudFunctionErrorFormatter';

export class InvestmentStageError extends Error {
  readonly requestId?: string;
  readonly savedAsPending: boolean;
  readonly code?: string;
  readonly creationMode?: 'CLOUD_FUNCTION' | 'FIRESTORE_RULES_FALLBACK';

  constructor(
    message: string,
    options?: {
      requestId?: string;
      savedAsPending?: boolean;
      code?: string;
      creationMode?: 'CLOUD_FUNCTION' | 'FIRESTORE_RULES_FALLBACK';
    }
  ) {
    super(message);
    this.name = 'InvestmentStageError';
    this.requestId = options?.requestId;
    this.savedAsPending = Boolean(options?.savedAsPending);
    this.code = options?.code;
    this.creationMode = options?.creationMode;
  }
}

export interface FormattedPlanError {
  message: string;
  requestId?: string;
  savedAsPending: boolean;
}

interface ParsedFirestoreErrorJson {
  error?: unknown;
  operationType?: unknown;
  path?: unknown;
}

/**
 * Formats Cloud Function errors raised during member investment flows
 * (`createInvestmentRequest` / `investInPlan`), preserving genuine server
 * validation & permission reasons while suppressing raw `internal [0]` blobs.
 */
export function formatMemberPlanFunctionError(
  err: unknown,
  fallbackMessage: string
): string {
  const meta = inspectCloudFunctionError(err);

  if (meta.isInternalTransportZero || meta.isFunctionUnreachable) {
    return 'Backend investment verification service is currently unreachable. Ensure Cloud Functions are deployed to this Firebase project.';
  }

  if (meta.code === 'functions/unauthenticated' || meta.code === 'unauthenticated') {
    return 'Your sign-in session expired or is missing. Please sign in again before investing.';
  }

  if (
    meta.rawMessage &&
    !/^internal(\s*\[\s*0\s*\]|\s+0)?$/i.test(meta.rawMessage)
  ) {
    if (meta.rawMessage.startsWith('{') && meta.rawMessage.includes('"operationType"')) {
      return formatPlanInvestmentError(meta.rawMessage).message;
    }
    return meta.rawMessage;
  }

  if (meta.code === 'functions/permission-denied' || meta.code === 'permission-denied') {
    return 'Permission denied: your account is not authorized for this investment request.';
  }

  return fallbackMessage;
}

export function formatPlanInvestmentError(err: unknown): FormattedPlanError {
  const stageError = err instanceof InvestmentStageError ? err : null;
  const rawMessage =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'Unable to process your investment request right now.';

  // Parse structured JSON thrown by handleFirestoreError without exposing raw JSON blobs in the UI
  const trimmed = rawMessage.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as ParsedFirestoreErrorJson;
      if (parsed && typeof parsed.error === 'string') {
        const pathLabel =
          typeof parsed.path === 'string' && parsed.path.trim()
            ? parsed.path.trim()
            : 'investmentRequests';
        const opLabel =
          typeof parsed.operationType === 'string' && parsed.operationType.trim()
            ? parsed.operationType.trim()
            : 'write';
        const isPermission =
          parsed.error.toLowerCase().includes('permission') ||
          parsed.error.toLowerCase().includes('insufficient');

        return {
          message: isPermission
            ? `Firestore permission denied during ${opLabel} on ${pathLabel}. Ensure the updated Firestore Security Rules and Cloud Functions (createInvestmentRequest / investInPlan) are deployed to this Firebase project.`
            : `Firestore ${opLabel} error on ${pathLabel}: ${parsed.error}`,
          requestId: stageError?.requestId,
          savedAsPending: Boolean(stageError?.savedAsPending),
        };
      }
    } catch {
      // Fall through to normal error formatting
    }
  }

  return {
    message:
      rawMessage ||
      'Unable to activate investment plan. Please verify your wallet balance and try again.',
    requestId: stageError?.requestId,
    savedAsPending: Boolean(stageError?.savedAsPending),
  };
}
