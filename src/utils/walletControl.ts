import { WithdrawalStatus } from '../types/domain';

export const MIN_WITHDRAWAL_INR = 100;
export const MAX_WITHDRAWAL_INR = 500000;

export const UPI_HANDLE_OPTIONS = [
  'Google Pay',
  'PhonePe',
  'Paytm',
  'BHIM',
  'Other UPI',
] as const;

const UPI_REGEX = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z0-9.-]{2,32}$/;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_NUMBER_REGEX = /^[0-9]{9,18}$/;

export function normalizeUpiId(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateUserUpiId(raw: string): string | null {
  const clean = normalizeUpiId(raw);
  if (!clean) return 'Enter your UPI ID (e.g., yourname@okicici).';
  if (clean.length < 5 || clean.length > 100) {
    return 'UPI ID must be between 5 and 100 characters.';
  }
  if (!UPI_REGEX.test(clean)) {
    return 'Enter a valid UPI ID format (e.g., username@bankhandle).';
  }
  return null;
}

export function maskUpiId(raw: string): string {
  const clean = normalizeUpiId(raw);
  const atIndex = clean.indexOf('@');
  if (atIndex <= 0) return '••••@upi';
  const local = clean.slice(0, atIndex);
  const domain = clean.slice(atIndex);
  if (local.length <= 2) {
    return `${local[0]}•${domain}`;
  }
  if (local.length <= 4) {
    return `${local.slice(0, 1)}••${local.slice(-1)}${domain}`;
  }
  return `${local.slice(0, 2)}•••${local.slice(-2)}${domain}`;
}

export function normalizeIfscCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function sanitizeBankAccountDigits(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 18);
}

export function extractAccountLast4(accountNumber: string): string {
  const digits = sanitizeBankAccountDigits(accountNumber);
  return digits.slice(-4).padStart(4, '•');
}

export function maskBankAccountNumber(accountNumber: string): string {
  const digits = sanitizeBankAccountDigits(accountNumber);
  if (digits.length < 4) return '••••';
  const last4 = digits.slice(-4);
  return `•••• •••• ${last4}`;
}

export function validateBankAccountInput(params: {
  accountHolderName: string;
  bankName: string;
  accountNumber: string;
  confirmAccountNumber: string;
  ifscCode: string;
}): string | null {
  const holder = params.accountHolderName.trim();
  if (holder.length < 2 || holder.length > 80) {
    return 'Enter the bank account holder full name (2–80 characters).';
  }

  const bank = params.bankName.trim();
  if (bank.length < 2 || bank.length > 80) {
    return 'Enter the bank name (2–80 characters).';
  }

  const acct = sanitizeBankAccountDigits(params.accountNumber);
  const confirmAcct = sanitizeBankAccountDigits(params.confirmAccountNumber);
  if (!ACCOUNT_NUMBER_REGEX.test(acct)) {
    return 'Account number must contain 9 to 18 numeric digits.';
  }
  if (acct !== confirmAcct) {
    return 'Bank account numbers do not match.';
  }

  const ifsc = normalizeIfscCode(params.ifscCode);
  if (!IFSC_REGEX.test(ifsc)) {
    return 'Enter a valid 11-character Indian IFSC code (e.g., HDFC0001234).';
  }

  return null;
}

export function validateWithdrawalAmountInr(
  amountInr: number,
  eligibleBalanceInr: number,
  minInr: number = MIN_WITHDRAWAL_INR,
  maxInr: number = MAX_WITHDRAWAL_INR
): string | null {
  if (!Number.isFinite(amountInr) || !Number.isInteger(amountInr)) {
    return 'Enter a whole INR withdrawal amount.';
  }
  if (amountInr < minInr) {
    return `Minimum withdrawal amount is ₹${minInr.toLocaleString('en-IN')}.`;
  }
  if (amountInr > maxInr) {
    return `Maximum single withdrawal limit is ₹${maxInr.toLocaleString('en-IN')}.`;
  }
  if (eligibleBalanceInr <= 0) {
    return 'Your eligible withdrawable INR balance is currently ₹0.';
  }
  if (amountInr > eligibleBalanceInr) {
    return `Requested amount (₹${amountInr.toLocaleString('en-IN')}) exceeds your eligible INR balance (₹${eligibleBalanceInr.toLocaleString('en-IN')}).`;
  }
  return null;
}

export function getWithdrawalStatusDisplay(status: WithdrawalStatus): {
  label: 'Pending' | 'Processing' | 'Approved' | 'Rejected' | 'Completed';
  tone: 'amber' | 'navy' | 'blue' | 'red' | 'emerald';
} {
  switch (status) {
    case 'PENDING':
      return { label: 'Pending', tone: 'amber' };
    case 'PROCESSING':
    case 'UNDER_REVIEW':
      return { label: 'Processing', tone: 'blue' };
    case 'APPROVED':
      return { label: 'Approved', tone: 'navy' };
    case 'REJECTED':
      return { label: 'Rejected', tone: 'red' };
    case 'COMPLETED':
    case 'PAID':
      return { label: 'Completed', tone: 'emerald' };
    default:
      return { label: 'Pending', tone: 'amber' };
  }
}

export function isWithdrawalTerminalStatus(status: WithdrawalStatus): boolean {
  return status === 'COMPLETED' || status === 'PAID' || status === 'REJECTED';
}
