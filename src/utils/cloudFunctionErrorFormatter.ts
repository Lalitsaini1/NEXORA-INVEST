export interface NormalizedErrorMetadata {
  code: string;
  rawMessage: string;
  isFunctionUnreachable: boolean;
  isInternalTransportZero: boolean;
}

const UNREACHABLE_FUNCTION_CODES = new Set([
  'functions/not-found',
  'functions/unavailable',
  'functions/unimplemented',
]);

export function extractFirebaseErrorCode(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    return String((err as { code?: unknown }).code || '').trim();
  }
  return '';
}

export function extractRawErrorMessage(err: unknown): string {
  if (err instanceof Error && typeof err.message === 'string') {
    return err.message.trim();
  }
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message?: unknown }).message || '').trim();
  }
  if (typeof err === 'string') {
    return err.trim();
  }
  return '';
}

/**
 * Firebase Functions Web SDK maps CORS-blocked 404 or network status 0 responses
 * to `code: 'functions/internal'` and `message: 'internal [0]'` (rendered as
 * "internal 0" or "internal [0]"). Treat status-0 transport errors and standard
 * unprovisioned codes as unreachable backend Cloud Functions, while keeping
 * genuine HTTP 500 server failures distinct.
 */
export function inspectCloudFunctionError(err: unknown): NormalizedErrorMetadata {
  const code = extractFirebaseErrorCode(err);
  const rawMessage = extractRawErrorMessage(err);
  const lowerMsg = rawMessage.toLowerCase();

  const isInternalTransportZero =
    (code === 'functions/internal' || code === 'internal' || code === '') &&
    /^internal(\s*\[\s*0\s*\]|\s+0)?$/i.test(rawMessage);

  const isFunctionUnreachable =
    UNREACHABLE_FUNCTION_CODES.has(code) ||
    isInternalTransportZero ||
    (code === 'functions/internal' &&
      (lowerMsg.includes('failed to fetch') ||
        lowerMsg.includes('networkerror') ||
        lowerMsg.includes('cors')));

  return {
    code,
    rawMessage,
    isFunctionUnreachable,
    isInternalTransportZero,
  };
}

export function isCloudFunctionUnreachableError(err: unknown): boolean {
  return inspectCloudFunctionError(err).isFunctionUnreachable;
}

/**
 * Formats Admin Portal / financial action errors into clean, user-friendly messages.
 * Never exposes "internal [0]", "internal 0", or raw serialized FirestoreErrorInfo JSON.
 */
export function formatAdminActionError(err: unknown, fallbackMessage: string): string {
  const meta = inspectCloudFunctionError(err);

  if (meta.rawMessage) {
    console.error('[NEXORA Admin Action Diagnostic]', {
      code: meta.code || 'unknown',
      rawMessage: meta.rawMessage,
    });
  }

  if (meta.isInternalTransportZero || meta.isFunctionUnreachable) {
    return 'Backend verification service is currently unreachable. Please retry or check administrator session permissions.';
  }

  if (meta.code === 'functions/permission-denied' || meta.code === 'permission-denied') {
    return 'Permission denied: only verified administrator accounts can perform this action.';
  }
  if (meta.code === 'functions/unauthenticated' || meta.code === 'unauthenticated') {
    return 'Your administrator session has expired. Please sign in again.';
  }
  if (meta.code === 'functions/already-exists') {
    return meta.rawMessage && !/^internal/i.test(meta.rawMessage)
      ? meta.rawMessage
      : 'Duplicate approval blocked: this deposit or payment reference has already been credited.';
  }
  if (meta.code === 'functions/internal') {
    return 'A server processing error occurred while verifying this request. Existing balances remain unchanged.';
  }

  // Handle serialized FirestoreErrorInfo JSON thrown by handleFirestoreError
  if (meta.rawMessage.startsWith('{') && meta.rawMessage.includes('"operationType"')) {
    try {
      const parsed = JSON.parse(meta.rawMessage) as { error?: string; path?: string };
      const inner = String(parsed.error || '');
      if (/permission-denied|missing or insufficient permissions/i.test(inner)) {
        return `Permission denied while updating ${parsed.path || 'record'}. Ensure you are signed in as an active administrator and all verification fields are valid.`;
      }
      if (inner && !/^internal(\s*\[\s*0\s*\]|\s+0)?$/i.test(inner)) {
        return inner;
      }
    } catch {
      // fall through to generic sanitization
    }
    return fallbackMessage;
  }

  if (!meta.rawMessage || /^internal(\s*\[\s*0\s*\]|\s+0)?$/i.test(meta.rawMessage)) {
    return fallbackMessage;
  }

  if (/missing or insufficient permissions|permission_denied/i.test(meta.rawMessage)) {
    return 'Permission denied: your account lacks active administrator privileges or the record failed security validation.';
  }

  return meta.rawMessage;
}
