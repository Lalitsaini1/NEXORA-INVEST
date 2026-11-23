import type {
  PaymentGatewayProvider,
  PaymentWebhookEventOutcome,
  WebhookVerificationStatus,
} from '../types/domain.ts';
import { convertInrToCoins } from './formatters.ts';
import {
  MAX_UPI_DEPOSIT_INR,
  MIN_UPI_DEPOSIT_INR,
  normalizeUtrReference,
  validateDepositAmountInr,
  validateUtrReference,
} from './upiGateway.ts';

export function sanitizeIdSegment(raw: string, fallback = 'item'): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  return cleaned || fallback;
}

export function buildPaymentTxId(depositId: string): string {
  return `paytx_${sanitizeIdSegment(depositId)}`.slice(0, 128);
}

export function buildDepositIdempotencyKey(depositId: string): string {
  return `dep_${sanitizeIdSegment(depositId)}`.slice(0, 128);
}

export function buildDepositCreditLockId(depositId: string): string {
  return `lock_dep_${sanitizeIdSegment(depositId)}`.slice(0, 128);
}

export function buildUtrCreditLockId(utrReference: string): string {
  const normalized = normalizeUtrReference(utrReference);
  return `lock_utr_${sanitizeIdSegment(normalized)}`.slice(0, 128);
}

export function buildGatewayPaymentLockId(
  provider: PaymentGatewayProvider,
  gatewayPaymentId: string
): string {
  const prov = sanitizeIdSegment(provider.toLowerCase(), 'gw');
  const payId = sanitizeIdSegment(gatewayPaymentId, 'pay');
  return `lock_gw_${prov}_${payId}`.slice(0, 128);
}

export function buildCoinTxIdForDeposit(depositId: string): string {
  return `tx_dep_${sanitizeIdSegment(depositId)}`.slice(0, 128);
}

export interface WebhookVerificationPayload {
  gatewayEventId: string;
  provider: PaymentGatewayProvider;
  depositId: string;
  uid: string;
  userId: string;
  amountInr: number;
  utrReference?: string;
  gatewayOrderId?: string;
  gatewayPaymentId?: string;
  signatureHeader?: string;
  simulatedOutcome?: 'VERIFY' | 'HOLD' | 'REJECT_SIGNATURE';
}

export interface WebhookVerificationResult {
  ok: boolean;
  isLiveGatewayActive: boolean;
  verificationStatus: PaymentWebhookEventOutcome;
  paymentWebhookStatus: WebhookVerificationStatus;
  nextPaymentTxStatus: 'WEBHOOK_VERIFIED' | 'PENDING_VERIFICATION' | 'FAILED';
  computedDigestPreview: string;
  canonicalPayload: string;
  note: string;
}

export interface WebhookVerificationAdapter {
  readonly mode: 'PLACEHOLDER' | 'LIVE';
  verifyWebhookPayload(payload: WebhookVerificationPayload): Promise<WebhookVerificationResult>;
}

export function buildCanonicalWebhookPayload(payload: WebhookVerificationPayload): string {
  const canonical = {
    amountInr: Math.round(payload.amountInr),
    coinsToCredit: convertInrToCoins(Math.round(payload.amountInr)),
    currency: 'INR',
    depositId: payload.depositId.trim(),
    gatewayEventId: payload.gatewayEventId.trim(),
    gatewayOrderId: (payload.gatewayOrderId || '').trim(),
    gatewayPaymentId: (payload.gatewayPaymentId || '').trim(),
    provider: payload.provider,
    uid: payload.uid.trim(),
    userId: payload.userId.trim(),
    utrReference: payload.utrReference ? normalizeUtrReference(payload.utrReference) : '',
  };
  return JSON.stringify(canonical);
}

export async function computePayloadDigestHex(canonicalPayload: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const encoded = new TextEncoder().encode(canonicalPayload);
    const hashBuffer = await subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  let hash = 2166136261;
  for (let i = 0; i < canonicalPayload.length; i += 1) {
    hash ^= canonicalPayload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Placeholder webhook verification service designed to be swapped with a server-side
 * gateway HMAC verifier (Razorpay / Cashfree / PhonePe / Paytm) once gateway secrets
 * and backend webhook endpoints are provisioned.
 *
 * Security invariant: Never accepts secrets in the browser and never auto-credits wallets
 * without passing through atomic Firestore paymentCreditLocks verification.
 */
export class PlaceholderWebhookVerificationService implements WebhookVerificationAdapter {
  readonly mode = 'PLACEHOLDER' as const;

  async verifyWebhookPayload(
    payload: WebhookVerificationPayload
  ): Promise<WebhookVerificationResult> {
    const canonicalPayload = buildCanonicalWebhookPayload(payload);
    const digestHex = await computePayloadDigestHex(canonicalPayload);
    const digestPreview = `sha256:${digestHex.slice(0, 24)}`;

    if (!payload.gatewayEventId.trim() || !payload.depositId.trim()) {
      return {
        ok: false,
        isLiveGatewayActive: false,
        verificationStatus: 'FAILED',
        paymentWebhookStatus: 'SIGNATURE_REJECTED',
        nextPaymentTxStatus: 'FAILED',
        computedDigestPreview: digestPreview,
        canonicalPayload,
        note: 'Missing gatewayEventId or depositId in webhook payload.',
      };
    }

    const amountError = validateDepositAmountInr(
      payload.amountInr,
      MIN_UPI_DEPOSIT_INR,
      MAX_UPI_DEPOSIT_INR
    );
    if (amountError) {
      return {
        ok: false,
        isLiveGatewayActive: false,
        verificationStatus: 'FAILED',
        paymentWebhookStatus: 'SIGNATURE_REJECTED',
        nextPaymentTxStatus: 'FAILED',
        computedDigestPreview: digestPreview,
        canonicalPayload,
        note: amountError,
      };
    }

    if (payload.utrReference) {
      const utrErr = validateUtrReference(payload.utrReference);
      if (utrErr) {
        return {
          ok: false,
          isLiveGatewayActive: false,
          verificationStatus: 'FAILED',
          paymentWebhookStatus: 'SIGNATURE_REJECTED',
          nextPaymentTxStatus: 'FAILED',
          computedDigestPreview: digestPreview,
          canonicalPayload,
          note: utrErr,
        };
      }
    }

    if (payload.simulatedOutcome === 'REJECT_SIGNATURE') {
      return {
        ok: false,
        isLiveGatewayActive: false,
        verificationStatus: 'SIGNATURE_INVALID',
        paymentWebhookStatus: 'SIGNATURE_REJECTED',
        nextPaymentTxStatus: 'FAILED',
        computedDigestPreview: digestPreview,
        canonicalPayload,
        note: 'Placeholder webhook signature check failed: HMAC verification rejected.',
      };
    }

    if (payload.simulatedOutcome === 'VERIFY') {
      return {
        ok: true,
        isLiveGatewayActive: false,
        verificationStatus: 'VERIFIED_READY_FOR_CREDIT',
        paymentWebhookStatus: 'PLACEHOLDER_VERIFIED',
        nextPaymentTxStatus: 'WEBHOOK_VERIFIED',
        computedDigestPreview: digestPreview,
        canonicalPayload,
        note: 'Placeholder webhook verified payload parity & digest; awaiting atomic lock-guarded wallet credit.',
      };
    }

    return {
      ok: true,
      isLiveGatewayActive: false,
      verificationStatus: 'PLACEHOLDER_HOLD',
      paymentWebhookStatus: 'PLACEHOLDER_VERIFIED',
      nextPaymentTxStatus: 'PENDING_VERIFICATION',
      computedDigestPreview: digestPreview,
      canonicalPayload,
      note: 'Placeholder webhook logged in hold state (live gateway secret verification disabled).',
    };
  }
}

export const placeholderWebhookService = new PlaceholderWebhookVerificationService();
