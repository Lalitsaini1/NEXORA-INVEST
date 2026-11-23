export type DepositVerificationChannel =
  | 'BANK_STATEMENT'
  | 'GATEWAY_SETTLEMENT'
  | 'GATEWAY_WEBHOOK';

export interface DepositSettlementProofInput {
  verificationChannel: DepositVerificationChannel;
  externalTransactionId: string;
  settlementReference: string;
  reconciledAmountInr: number;
}

export interface DepositRecordForVerification {
  depositId: string;
  uid: string;
  userId: string;
  amountInr: number;
  coinsRequested: number;
  packageId?: string;
  bonusCoins?: number;
  utrNumber?: string;
  screenshotUrl?: string;
  status: string;
}

export interface ExistingGatewayPaymentVerification {
  webhookVerificationStatus?: string;
  gatewayPaymentId?: string;
  gatewayOrderId?: string;
  amountInr?: number;
  status?: string;
}

export interface ValidatedDepositApprovalPlan {
  depositId: string;
  targetUid: string;
  targetUserId: string;
  verifiedAmountInr: number;
  baseCoins: number;
  bonusCoins: number;
  totalCoins: number;
  cleanUtr: string;
  verificationChannel: DepositVerificationChannel;
  externalTransactionId: string;
  settlementReference: string;
  reconciledAmountInr: number;
  paymentTxId: string;
  creditLockId: string;
  utrLockId: string;
  externalLockId: string;
  coinTxId: string;
  idempotencyKey: string;
  verificationMethod: 'ADMIN_SETTLEMENT' | 'WEBHOOK_VERIFIED';
  webhookVerificationStatus: 'NOT_RECEIVED' | 'SIGNATURE_VERIFIED';
}

export class DepositVerificationError extends Error {
  readonly code:
    | 'invalid-argument'
    | 'failed-precondition'
    | 'already-exists';

  constructor(
    code: 'invalid-argument' | 'failed-precondition' | 'already-exists',
    message: string
  ) {
    super(message);
    this.name = 'DepositVerificationError';
    this.code = code;
  }
}

export function sanitizeDepositIdSegment(raw: string, fallback = 'item'): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  return cleaned || fallback;
}

export function normalizeUtrRef(raw: unknown): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function deterministicHash12(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + ((i + 1) & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0').slice(0, 4);
  return `${part1}${part2}`;
}

export function buildDepositOrderLockId(depositId: string): string {
  return `lock_dep_${sanitizeDepositIdSegment(depositId)}`.slice(0, 128);
}

export function buildUtrLockId(cleanUtr: string): string {
  const normalized = normalizeUtrRef(cleanUtr);
  return normalized ? `lock_utr_${normalized}`.slice(0, 128) : '';
}

export function buildExternalSettlementLockId(
  channel: DepositVerificationChannel,
  externalTransactionId: string
): string {
  const channelSlug =
    channel === 'GATEWAY_WEBHOOK'
      ? 'wh'
      : channel === 'GATEWAY_SETTLEMENT'
      ? 'gw'
      : 'bank';
  const cleanPrefix = externalTransactionId
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
  const hash = deterministicHash12(`${channel}:${externalTransactionId.trim().toLowerCase()}`);
  return `lock_gw_${channelSlug}_${cleanPrefix || 'ref'}_${hash}`.slice(0, 128);
}

export function buildCanonicalDepositTxIds(depositId: string) {
  const safeId = sanitizeDepositIdSegment(depositId);
  return {
    paymentTxId: `paytx_${safeId}`.slice(0, 128),
    creditLockId: `lock_dep_${safeId}`.slice(0, 128),
    coinTxId: `tx_dep_${safeId}`.slice(0, 128),
    idempotencyKey: `dep_${safeId}`.slice(0, 128),
  };
}

export function validateDepositApprovalRequirements(params: {
  deposit: DepositRecordForVerification;
  settlementProof?: Partial<DepositSettlementProofInput> | null;
  existingGatewayVerification?: ExistingGatewayPaymentVerification | null;
}): ValidatedDepositApprovalPlan {
  const { deposit, settlementProof, existingGatewayVerification } = params;
  const depositId = sanitizeDepositIdSegment(deposit.depositId || '', '');
  const targetUid = sanitizeDepositIdSegment(deposit.uid || '', '');
  const targetUserId = String(deposit.userId || '').trim();

  if (!depositId || !targetUid || !/^NX[0-9]{6,10}$/.test(targetUserId)) {
    throw new DepositVerificationError(
      'failed-precondition',
      'Deposit record is missing a verified member UID or NX User ID.'
    );
  }

  const currentStatus = String(deposit.status || '').toUpperCase();
  if (currentStatus === 'APPROVED' || currentStatus === 'REJECTED') {
    throw new DepositVerificationError(
      'failed-precondition',
      `Deposit already finalized (${currentStatus}).`
    );
  }
  if (currentStatus !== 'PENDING' && currentStatus !== 'UNDER_REVIEW') {
    throw new DepositVerificationError(
      'failed-precondition',
      `Deposit status "${currentStatus || 'UNKNOWN'}" is not eligible for approval.`
    );
  }

  const verifiedAmountInr = Math.round(Number(deposit.amountInr || 0));
  if (!Number.isInteger(verifiedAmountInr) || verifiedAmountInr < 100 || verifiedAmountInr > 500000) {
    throw new DepositVerificationError(
      'failed-precondition',
      'Deposit INR amount is invalid or outside allowed platform bounds.'
    );
  }

  const baseCoins = verifiedAmountInr;
  const bonusCoins =
    deposit.packageId &&
    typeof deposit.bonusCoins === 'number' &&
    Number.isInteger(deposit.bonusCoins) &&
    deposit.bonusCoins >= 0 &&
    deposit.bonusCoins <= verifiedAmountInr
      ? deposit.bonusCoins
      : 0;
  const totalCoins = baseCoins + bonusCoins;

  const cleanUtr = normalizeUtrRef(deposit.utrNumber);
  const utrLockId = buildUtrLockId(cleanUtr);
  const ids = buildCanonicalDepositTxIds(depositId);

  const gatewaySigVerified =
    existingGatewayVerification?.webhookVerificationStatus === 'SIGNATURE_VERIFIED' &&
    typeof existingGatewayVerification.gatewayPaymentId === 'string' &&
    existingGatewayVerification.gatewayPaymentId.trim().length >= 6 &&
    Math.round(Number(existingGatewayVerification.amountInr || 0)) === verifiedAmountInr;

  const rawChannel = settlementProof?.verificationChannel;
  const hasExplicitSettlementChannel =
    rawChannel === 'BANK_STATEMENT' || rawChannel === 'GATEWAY_SETTLEMENT';

  if (gatewaySigVerified && !hasExplicitSettlementChannel) {
    const gatewayPayId = existingGatewayVerification!.gatewayPaymentId!.trim().slice(0, 64);
    const gatewayOrdId = (
      existingGatewayVerification?.gatewayOrderId || `GATEWAY_WEBHOOK_${depositId}`
    )
      .trim()
      .slice(0, 120);

    return {
      depositId,
      targetUid,
      targetUserId,
      verifiedAmountInr,
      baseCoins,
      bonusCoins,
      totalCoins,
      cleanUtr,
      verificationChannel: 'GATEWAY_WEBHOOK',
      externalTransactionId: gatewayPayId,
      settlementReference: gatewayOrdId,
      reconciledAmountInr: verifiedAmountInr,
      ...ids,
      utrLockId,
      externalLockId: buildExternalSettlementLockId('GATEWAY_WEBHOOK', gatewayPayId),
      verificationMethod: 'WEBHOOK_VERIFIED',
      webhookVerificationStatus: 'SIGNATURE_VERIFIED',
    };
  }

  if (!settlementProof || !hasExplicitSettlementChannel) {
    throw new DepositVerificationError(
      'failed-precondition',
      'Payment gateway confirmation or authorized bank settlement reconciliation is required before approving a deposit. Screenshots or user-submitted UTR text alone cannot approve a deposit.'
    );
  }

  const externalTransactionId = String(settlementProof.externalTransactionId || '').trim();
  if (!/^[A-Za-z0-9_.:/-]{6,64}$/.test(externalTransactionId)) {
    throw new DepositVerificationError(
      'invalid-argument',
      'A valid bank transaction ID or gateway payment reference (6-64 characters) is required for verification.'
    );
  }

  const settlementReference = String(settlementProof.settlementReference || '').trim();
  if (settlementReference.length < 4 || settlementReference.length > 120) {
    throw new DepositVerificationError(
      'invalid-argument',
      'Authorized bank statement or gateway settlement reference (4-120 characters) is required.'
    );
  }

  const lowerRef = settlementReference.toLowerCase();
  if (
    lowerRef === 'screenshot' ||
    lowerRef === 'screenshot only' ||
    lowerRef === 'unverified utr'
  ) {
    throw new DepositVerificationError(
      'failed-precondition',
      'Deposits cannot be approved solely from screenshots or unverified UTR text.'
    );
  }

  const reconciledAmountInr = Math.round(Number(settlementProof.reconciledAmountInr));
  if (!Number.isFinite(reconciledAmountInr) || reconciledAmountInr !== verifiedAmountInr) {
    throw new DepositVerificationError(
      'failed-precondition',
      `Verified bank/gateway amount (₹${Number.isFinite(reconciledAmountInr) ? reconciledAmountInr : 0}) does not match requested deposit amount (₹${verifiedAmountInr}).`
    );
  }

  return {
    depositId,
    targetUid,
    targetUserId,
    verifiedAmountInr,
    baseCoins,
    bonusCoins,
    totalCoins,
    cleanUtr,
    verificationChannel: rawChannel,
    externalTransactionId,
    settlementReference,
    reconciledAmountInr,
    ...ids,
    utrLockId,
    externalLockId: buildExternalSettlementLockId(rawChannel, externalTransactionId),
    verificationMethod: 'ADMIN_SETTLEMENT',
    webhookVerificationStatus: 'NOT_RECEIVED',
  };
}
