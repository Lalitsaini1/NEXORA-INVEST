import { ROUTES } from '../config/constants';

export const PLAN_QUERY_PARAM = 'plan';
export const REDIRECT_QUERY_PARAM = 'redirect';
export const REFERRAL_QUERY_PARAM = 'ref';
export const PENDING_PLAN_STORAGE_KEY = 'nexora_pending_investment_plan_v1';

/**
 * Restricts redirect targets strictly to safe in-app relative paths so
 * query-string redirects cannot be abused for open redirects.
 */
export function sanitizeInternalRedirectPath(
  raw: string | null | undefined,
  fallback: string = ROUTES.USER_DASHBOARD
): string {
  if (!raw || typeof raw !== 'string') {
    return fallback;
  }
  const trimmed = raw.trim();
  if (
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/\\') ||
    trimmed.includes('\\') ||
    /^\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
  ) {
    return fallback;
  }
  return trimmed;
}

export function buildHomeReturnUrlWithPlan(planId: string): string {
  const cleanPlanId = planId.trim();
  if (!cleanPlanId) return ROUTES.HOME;
  const params = new URLSearchParams();
  params.set(PLAN_QUERY_PARAM, cleanPlanId);
  return `${ROUTES.HOME}?${params.toString()}`;
}

export function buildAuthUrlWithPlan(
  authRoute: string,
  options?: {
    planId?: string | null;
    redirectPath?: string | null;
    referralCode?: string | null;
  }
): string {
  const params = new URLSearchParams();
  const cleanPlanId = options?.planId?.trim();
  if (cleanPlanId) {
    params.set(PLAN_QUERY_PARAM, cleanPlanId);
  }
  const cleanRedirect = options?.redirectPath?.trim();
  if (cleanRedirect) {
    const safeRedirect = sanitizeInternalRedirectPath(cleanRedirect, ROUTES.HOME);
    params.set(REDIRECT_QUERY_PARAM, safeRedirect);
  }
  const cleanRef = options?.referralCode?.trim().toUpperCase();
  if (cleanRef && /^NX[0-9]{6,10}$/.test(cleanRef)) {
    params.set(REFERRAL_QUERY_PARAM, cleanRef);
  }
  const qs = params.toString();
  return qs ? `${authRoute}?${qs}` : authRoute;
}

export function savePendingPlanId(planId: string): void {
  const clean = planId.trim();
  if (!clean) return;
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(PENDING_PLAN_STORAGE_KEY, clean);
    }
  } catch {
    // Ignore storage restrictions in sandboxed iframes
  }
}

export function loadPendingPlanId(): string | null {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const value = window.sessionStorage.getItem(PENDING_PLAN_STORAGE_KEY);
      return value && value.trim() ? value.trim() : null;
    }
  } catch {
    // Ignore storage restrictions
  }
  return null;
}

export function clearPendingPlanId(): void {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(PENDING_PLAN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage restrictions
  }
}

export interface AuthLocationState {
  selectedPlanId?: string;
  redirectTo?: string;
}

export function extractSelectedPlanId(params: {
  searchParams: URLSearchParams;
  locationState?: unknown;
  useStorageFallback?: boolean;
}): string | null {
  const fromQuery = params.searchParams.get(PLAN_QUERY_PARAM)?.trim();
  if (fromQuery) return fromQuery;

  if (
    params.locationState &&
    typeof params.locationState === 'object' &&
    'selectedPlanId' in params.locationState
  ) {
    const statePlanId = String(
      (params.locationState as AuthLocationState).selectedPlanId || ''
    ).trim();
    if (statePlanId) return statePlanId;
  }

  if (params.useStorageFallback !== false) {
    return loadPendingPlanId();
  }

  return null;
}

export function resolvePostAuthDestination(params: {
  searchParams: URLSearchParams;
  locationState?: unknown;
  storedPlanId?: string | null;
  defaultRoute?: string;
}): string {
  const defaultRoute = params.defaultRoute || ROUTES.USER_DASHBOARD;
  const planId =
    extractSelectedPlanId({
      searchParams: params.searchParams,
      locationState: params.locationState,
      useStorageFallback: false,
    }) ||
    (params.storedPlanId?.trim() || null);

  if (planId) {
    return buildHomeReturnUrlWithPlan(planId);
  }

  const queryRedirect = params.searchParams.get(REDIRECT_QUERY_PARAM);
  if (queryRedirect) {
    return sanitizeInternalRedirectPath(queryRedirect, defaultRoute);
  }

  if (
    params.locationState &&
    typeof params.locationState === 'object' &&
    'redirectTo' in params.locationState
  ) {
    const stateRedirect = String(
      (params.locationState as AuthLocationState).redirectTo || ''
    );
    if (stateRedirect) {
      return sanitizeInternalRedirectPath(stateRedirect, defaultRoute);
    }
  }

  return defaultRoute;
}
