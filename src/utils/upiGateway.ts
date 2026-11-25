import { COIN_CONVERSION_RATE } from '../config/constants.ts';
import { convertInrToCoins } from './formatters.ts';

import type { CoinPackageBonusType, CoinPackageRecord } from '../types/domain.ts';

export interface CoinPackageOption {
  id: string;
  packageId?: string;
  label: string;
  amountInr: number;
  baseCoins: number;
  bonusCoins: number;
  bonusType: CoinPackageBonusType;
  bonusValue: number;
  coins: number;
  tag?: string;
  description?: string;
}

export const MIN_UPI_DEPOSIT_INR = 100;
export const MAX_UPI_DEPOSIT_INR = 500000;
export const MAX_PACKAGE_BONUS_PERCENT = 100;

export const DEFAULT_COIN_PACKAGES_CSV = '100,500,1000,2500,5000,10000';

const PACKAGE_LABELS = [
  'Starter Pack',
  'Standard Pack',
  'Growth Pack',
  'Silver Pack',
  'Gold Pack',
  'Institutional Pack',
  'Elite Pack',
  'Executive Pack',
];

export interface PackageBonusCalculation {
  priceInr: number;
  baseCoins: number;
  bonusType: CoinPackageBonusType;
  bonusValue: number;
  bonusCoins: number;
  totalCoins: number;
  effectivePercent: number;
  error: string | null;
}

export function computePackageBonusMetrics(params: {
  priceInr: number;
  bonusType: CoinPackageBonusType;
  bonusValue: number;
}): PackageBonusCalculation {
  const roundedPrice = Math.round(params.priceInr);
  const priceError = validateDepositAmountInr(
    roundedPrice,
    MIN_UPI_DEPOSIT_INR,
    MAX_UPI_DEPOSIT_INR
  );
  if (priceError) {
    return {
      priceInr: roundedPrice || 0,
      baseCoins: 0,
      bonusType: params.bonusType,
      bonusValue: params.bonusValue,
      bonusCoins: 0,
      totalCoins: 0,
      effectivePercent: 0,
      error: priceError,
    };
  }

  const baseCoins = convertInrToCoins(roundedPrice);
  const rawBonusVal = Number.isFinite(params.bonusValue) ? Math.max(0, params.bonusValue) : 0;

  if (params.bonusType === 'NONE' || rawBonusVal === 0) {
    return {
      priceInr: roundedPrice,
      baseCoins,
      bonusType: 'NONE',
      bonusValue: 0,
      bonusCoins: 0,
      totalCoins: baseCoins,
      effectivePercent: 0,
      error: null,
    };
  }

  if (params.bonusType === 'PERCENTAGE') {
    if (rawBonusVal > MAX_PACKAGE_BONUS_PERCENT) {
      return {
        priceInr: roundedPrice,
        baseCoins,
        bonusType: 'PERCENTAGE',
        bonusValue: rawBonusVal,
        bonusCoins: 0,
        totalCoins: baseCoins,
        effectivePercent: 0,
        error: `Percentage bonus cannot exceed ${MAX_PACKAGE_BONUS_PERCENT}%.`,
      };
    }
    const cleanPct = Math.round(rawBonusVal * 100) / 100;
    const bonusCoins = Math.min(baseCoins, Math.round(baseCoins * (cleanPct / 100)));
    return {
      priceInr: roundedPrice,
      baseCoins,
      bonusType: 'PERCENTAGE',
      bonusValue: cleanPct,
      bonusCoins,
      totalCoins: baseCoins + bonusCoins,
      effectivePercent: cleanPct,
      error: null,
    };
  }

  const flatBonus = Math.round(rawBonusVal);
  if (flatBonus > baseCoins) {
    return {
      priceInr: roundedPrice,
      baseCoins,
      bonusType: 'FLAT_COINS',
      bonusValue: flatBonus,
      bonusCoins: 0,
      totalCoins: baseCoins,
      effectivePercent: 0,
      error: `Flat bonus coins (${flatBonus.toLocaleString('en-IN')}) cannot exceed base package coins (${baseCoins.toLocaleString('en-IN')}).`,
    };
  }

  const effectivePercent = Math.round((flatBonus / baseCoins) * 10000) / 100;
  return {
    priceInr: roundedPrice,
    baseCoins,
    bonusType: 'FLAT_COINS',
    bonusValue: flatBonus,
    bonusCoins: flatBonus,
    totalCoins: baseCoins + flatBonus,
    effectivePercent,
    error: null,
  };
}

export function coinPackageRecordToOption(rec: CoinPackageRecord): CoinPackageOption {
  return {
    id: rec.packageId,
    packageId: rec.packageId,
    label: rec.name,
    amountInr: rec.priceInr,
    baseCoins: rec.baseCoins,
    bonusCoins: rec.bonusCoins,
    bonusType: rec.bonusType,
    bonusValue: rec.bonusValue,
    coins: rec.totalCoins,
    tag: rec.badgeTag || (rec.bonusCoins > 0 ? `+${rec.bonusCoins.toLocaleString('en-IN')} Bonus` : undefined),
    description: rec.description || undefined,
  };
}

export function buildCoinPackagesFromCsv(
  csv: string | undefined,
  minAmount = MIN_UPI_DEPOSIT_INR,
  maxAmount = MAX_UPI_DEPOSIT_INR
): CoinPackageOption[] {
  const source = (csv || DEFAULT_COIN_PACKAGES_CSV)
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= minAmount && n <= maxAmount);

  const uniqueAmounts = Array.from(new Set(source)).sort((a, b) => a - b).slice(0, 8);
  const effectiveAmounts =
    uniqueAmounts.length > 0
      ? uniqueAmounts
      : [100, 500, 1000, 2500, 5000, 10000].filter((n) => n >= minAmount && n <= maxAmount);

  return effectiveAmounts.map((amountInr, idx) => {
    const coins = convertInrToCoins(amountInr);
    return {
      id: `pkg_${amountInr}`,
      label: PACKAGE_LABELS[idx] || `Tier ${idx + 1}`,
      amountInr,
      baseCoins: coins,
      bonusCoins: 0,
      bonusType: 'NONE',
      bonusValue: 0,
      coins,
      tag: idx === 2 ? 'Popular' : idx === 4 ? 'Best Value' : undefined,
    };
  });
}

export const COIN_PACKAGES: readonly CoinPackageOption[] = buildCoinPackagesFromCsv(
  DEFAULT_COIN_PACKAGES_CSV
);

export type SupportedUpiApp = 'GENERIC' | 'GPAY' | 'PHONEPE' | 'PAYTM' | 'BHIM';

export interface UpiIntentParams {
  upiId: string;
  displayName: string;
  amountInr: number;
  transactionRef: string;
  note?: string;
}

export function validateDepositAmountInr(
  amountInr: number,
  minInr = MIN_UPI_DEPOSIT_INR,
  maxInr = MAX_UPI_DEPOSIT_INR
): string | null {
  if (!Number.isFinite(amountInr) || !Number.isInteger(amountInr)) {
    return 'Please enter a whole rupee amount without decimals.';
  }
  if (amountInr < minInr) {
    return `Minimum UPI deposit amount is ₹${minInr.toLocaleString('en-IN')}.`;
  }
  if (amountInr > maxInr) {
    return `Maximum single UPI deposit amount is ₹${maxInr.toLocaleString('en-IN')}.`;
  }
  return null;
}

export function normalizeUtrReference(rawUtr: string): string {
  return rawUtr.trim().toUpperCase().replace(/\s+/g, '');
}

export function validateUtrReference(rawUtr: string): string | null {
  const clean = normalizeUtrReference(rawUtr);
  if (!clean) {
    return 'Enter the 12-digit UPI Transaction / UTR reference number after completing payment.';
  }
  if (clean.length < 8 || clean.length > 36) {
    return 'UPI / UTR reference must be between 8 and 36 alphanumeric characters.';
  }
  if (!/^[a-zA-Z0-9]+$/.test(clean)) {
    return 'UPI / UTR reference may contain letters and numbers only.';
  }
  return null;
}

export function calculateCoinsForDepositInr(amountInr: number): number {
  return convertInrToCoins(amountInr);
}

export function getExchangeRateLabel(): string {
  return `₹${COIN_CONVERSION_RATE.inrAmount} = ${COIN_CONVERSION_RATE.virtualCoins} Virtual Coins (1 INR = ${COIN_CONVERSION_RATE.coinsPerInr} Coin)`;
}

export function buildUpiQueryString(params: UpiIntentParams): string {
  const pa = params.upiId.trim();
  const pn = (params.displayName.trim() || 'NEXORA INVEST').slice(0, 60);
  const am = Math.max(MIN_UPI_DEPOSIT_INR, Math.round(params.amountInr)).toFixed(2);
  const tr = params.transactionRef.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 35) || 'NXDEPOSIT';
  const tn = (params.note?.trim() || `NEXORA Coin Deposit ${tr}`).slice(0, 60);

  const search = new URLSearchParams({
    pa,
    pn,
    am,
    cu: 'INR',
    tr,
    tn,
  });
  return search.toString();
}

export function buildUpiPaymentIntentUrl(
  params: UpiIntentParams,
  app: SupportedUpiApp = 'GENERIC'
): string {
  const query = buildUpiQueryString(params);
  switch (app) {
    case 'GPAY':
      return `tez://upi/pay?${query}`;
    case 'PHONEPE':
      return `phonepe://pay?${query}`;
    case 'PAYTM':
      return `paytmmp://pay?${query}`;
    case 'BHIM':
      return `bhim://upi/pay?${query}`;
    case 'GENERIC':
    default:
      return `upi://pay?${query}`;
  }
}

export type UpiGatewayAvailabilityReason =
  | 'LOADING'
  | 'READ_ERROR'
  | 'PAUSED_BY_ADMIN'
  | 'NO_ACTIVE_ENDPOINT'
  | 'READY';

export interface UpiGatewayAvailability {
  ready: boolean;
  reason: UpiGatewayAvailabilityReason;
  headline: string;
  detail: string;
}

export function evaluateUpiGatewayAvailability(params: {
  loading: boolean;
  upiDepositsEnabled: boolean;
  hasActiveEndpoint: boolean;
  readErrorMessage?: string | null;
}): UpiGatewayAvailability {
  if (params.loading) {
    return {
      ready: false,
      reason: 'LOADING',
      headline: 'Checking UPI Payment Gateway Configuration...',
      detail: 'Loading authorized UPI payment endpoints from Firestore.',
    };
  }

  if (params.readErrorMessage && params.readErrorMessage.trim().length > 0) {
    return {
      ready: false,
      reason: 'READ_ERROR',
      headline: 'UPI Payment Gateway Unavailable',
      detail: params.readErrorMessage.trim(),
    };
  }

  if (!params.upiDepositsEnabled) {
    return {
      ready: false,
      reason: 'PAUSED_BY_ADMIN',
      headline: 'UPI Payment Processing Currently Inactive',
      detail:
        'UPI coin deposits are currently paused by platform administration (platformSettings/global upiDepositsEnabled = false).',
    };
  }

  if (!params.hasActiveEndpoint) {
    return {
      ready: false,
      reason: 'NO_ACTIVE_ENDPOINT',
      headline: 'UPI Payment Processing Currently Inactive',
      detail:
        'No active UPI payment endpoint is configured in Firestore (upiAccounts has 0 active records). Coin purchases remain paused until an administrator adds and activates a verified UPI endpoint in the Admin Portal.',
    };
  }

  return {
    ready: true,
    reason: 'READY',
    headline: 'UPI Payment Gateway Active',
    detail: 'Authorized UPI payment endpoint loaded from Firestore.',
  };
}

