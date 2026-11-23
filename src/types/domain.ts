export type UserRole = 'USER' | 'ADMIN' | 'SUPER_ADMIN';

export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'PENDING_VERIFICATION';

export type TransactionType =
  | 'COIN_PURCHASE'
  | 'PLAN_INVESTMENT'
  | 'DAILY_REWARD'
  | 'WITHDRAWAL_REQUEST'
  | 'WITHDRAWAL_REFUND'
  | 'ADMIN_ADJUSTMENT';

export type TransactionStatus = 'PENDING' | 'COMPLETED' | 'REJECTED' | 'FAILED';

export type DepositStatus = 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';

export type WithdrawalStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'COMPLETED'
  | 'PAID';

export type PayoutMethodType = 'UPI' | 'BANK_ACCOUNT';

export type PayoutVerificationStatus =
  | 'PENDING_VERIFICATION'
  | 'VERIFIED'
  | 'REJECTED';

export type UserPlanStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export type InvestmentRequestStatus =
  | 'PENDING_VERIFICATION'
  | 'ACTIVATED'
  | 'REJECTED'
  | 'FAILED';

export type InvestmentPaymentStatus =
  | 'PENDING'
  | 'VERIFIED'
  | 'INSUFFICIENT_BALANCE'
  | 'FAILED';

export interface InvestmentRequest {
  requestId: string;
  uid: string;
  userId: string;
  planId: string;
  productName: string;
  planPriceInr: number;
  coinCost: number;
  durationDays: number;
  totalRewardEntitlement: number;
  acceptedTerms: boolean;
  idempotencyKey: string;
  status: InvestmentRequestStatus;
  paymentStatus: InvestmentPaymentStatus;
  activatedUserPlanId?: string;
  coinTransactionId?: string;
  verifiedByUid?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
  activatedAt?: string;
}

export type DashboardTheme = 'navy' | 'high-contrast';

export type UserActivityCategory =
  | 'LOGIN'
  | 'PROFILE_UPDATE'
  | 'PLAN_CHANGE'
  | 'SECURITY'
  | 'WALLET';

export type AdminActionType =
  | 'USER_PROMOTED_TO_ADMIN'
  | 'ADMIN_REVOKED'
  | 'ADMIN_CREATED'
  | 'USER_STATUS_UPDATED'
  | 'WALLET_ADJUSTED'
  | 'UPI_ACCOUNT_UPDATED'
  | 'DEPOSIT_REVIEWED'
  | 'WITHDRAWAL_REVIEWED'
  | 'PRODUCT_PLAN_UPDATED'
  | 'COIN_PACKAGE_UPDATED'
  | 'PLATFORM_SETTINGS_UPDATED'
  | 'PAYMENT_WEBHOOK_VERIFIED'
  | 'PAYOUT_METHOD_REVIEWED';

export interface BrandSettings {
  siteName: string;
  tagline: string;
  primaryNavyHex: string;
  accentGoldHex: string;
  supportEmail: string;
  supportPhone: string;
  customLogoUrl?: string;
}

export interface UserProfile {
  uid: string;
  userId: string; // Permanent backend-generated ID e.g. NX100001
  role: UserRole;
  fullName: string;
  email: string;
  mobile: string;
  emailVerified: boolean;
  mobileVerified: boolean;
  authProvider: 'password' | 'phone' | 'password+phone';
  status: AccountStatus;
  avatarUrl?: string;
  referredByCode?: string;
  suspensionReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserRecord {
  uid: string;
  email: string;
  displayName?: string;
  role: 'ADMIN' | 'SUPER_ADMIN';
  active: boolean;
  createdByUid?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface CoinWallet {
  uid: string;
  userId: string;
  availableCoins: number;
  purchasedCoins: number;
  earnedCoins: number;
  coinsUsedForPlans: number;
  pendingTransactionCoins: number;
  withdrawableBalanceInr: number;
  lastWithdrawalRef?: string;
  lastPlanRef?: string;
  updatedAt: string;
}

export interface CoinTransaction {
  transactionId: string;
  uid: string;
  userId: string;
  type: TransactionType;
  assetType?: 'COINS' | 'INR';
  amount: number;
  previousBalance: number;
  newBalance: number;
  referenceId: string;
  idempotencyKey: string;
  status: TransactionStatus;
  description: string;
  createdAt: string;
}

export interface ProductPlan {
  planId: string;
  productName: string;
  category: string;
  imageUrl: string;
  displayedValueInr: number;
  planPriceInr: number;
  coinDeductionAmount: number;
  durationDays: number;
  totalCoinReward: number;
  dailyCoinRewardPreview: number;
  tierName?: string;
  minCoins?: number;
  maxCoins?: number;
  dailyRewardPercent?: number;
  description: string;
  termsAndConditions: string;
  isActive: boolean;
  isIllustrativePreview?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserPlan {
  userPlanId: string;
  uid: string;
  userId: string;
  planId: string;
  productName: string;
  imageUrl: string;
  coinCost: number;
  durationDays: number;
  totalRewardEntitlement: number;
  collectedReward: number;
  remainingReward: number;
  daysCompleted: number;
  remainingDays: number;
  startDate: string;
  endDate: string;
  nextRewardEligibilityTime: string | null;
  status: UserPlanStatus;
  createdAt: string;
}

export interface DailyRewardRecord {
  rewardId: string;
  userPlanId: string;
  uid: string;
  userId: string;
  rewardDayNumber: number;
  coinsCredited: number;
  scheduledFor: string;
  creditedAt: string;
}

export interface UpiAccount {
  accountId: string;
  upiId: string;
  displayName: string;
  qrCodeImageUrl: string;
  isActive: boolean;
  updatedAt: string;
}

export type CoinPackageBonusType = 'NONE' | 'PERCENTAGE' | 'FLAT_COINS';

export interface CoinPackageRecord {
  packageId: string;
  name: string;
  priceInr: number;
  baseCoins: number;
  bonusType: CoinPackageBonusType;
  bonusValue: number;
  bonusCoins: number;
  totalCoins: number;
  badgeTag?: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
  updatedByUid: string;
  createdAt: string;
  updatedAt: string;
}

export interface DepositRequest {
  depositId: string;
  uid: string;
  userId: string;
  amountInr: number;
  coinsRequested: number;
  packageId?: string;
  packageName?: string;
  baseCoins?: number;
  bonusCoins?: number;
  assignedUpiAccountId: string;
  assignedUpiId: string;
  assignedUpiDisplayName: string;
  assignedQrImageUrl: string;
  utrNumber?: string;
  screenshotUrl?: string;
  status: DepositStatus;
  rejectionReason?: string;
  createdAt: string;
  verifiedAt?: string;
  verifiedByAdminUid?: string;
}

export type PaymentGatewayProvider =
  | 'UPI_GATEWAY'
  | 'RAZORPAY'
  | 'CASHFREE'
  | 'PHONEPE_PG'
  | 'PAYTM_PG'
  | 'PLACEHOLDER_WEBHOOK';

export type PaymentVerificationMethod =
  | 'ADMIN_SETTLEMENT'
  | 'WEBHOOK_PLACEHOLDER'
  | 'WEBHOOK_VERIFIED';

export type WebhookVerificationStatus =
  | 'NOT_RECEIVED'
  | 'PLACEHOLDER_VERIFIED'
  | 'SIGNATURE_VERIFIED'
  | 'SIGNATURE_REJECTED'
  | 'DUPLICATE_IGNORED';

export type PaymentTxStatus =
  | 'INITIATED'
  | 'PENDING_VERIFICATION'
  | 'WEBHOOK_VERIFIED'
  | 'CREDITED'
  | 'DUPLICATE_BLOCKED'
  | 'FAILED'
  | 'REJECTED';

export type PaymentWebhookEventOutcome =
  | 'PLACEHOLDER_HOLD'
  | 'VERIFIED_READY_FOR_CREDIT'
  | 'DUPLICATE_IGNORED'
  | 'SIGNATURE_INVALID'
  | 'FAILED';

export interface PaymentTransactionRecord {
  paymentTxId: string;
  depositId: string;
  uid: string;
  userId: string;
  provider: PaymentGatewayProvider;
  gatewayOrderId?: string;
  gatewayPaymentId?: string;
  utrReference?: string;
  amountInr: number;
  coinsToCredit: number;
  packageId?: string;
  bonusCoins?: number;
  currency: 'INR';
  idempotencyKey: string;
  creditLockId: string;
  utrLockId?: string;
  verificationMethod: PaymentVerificationMethod;
  webhookVerificationStatus: WebhookVerificationStatus;
  lastWebhookEventId?: string;
  status: PaymentTxStatus;
  coinTransactionId?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
  creditedAt?: string;
}

export interface PaymentCreditLockRecord {
  lockId: string;
  lockScope: 'DEPOSIT_ORDER' | 'UTR_REFERENCE' | 'GATEWAY_PAYMENT';
  paymentTxId: string;
  depositId: string;
  uid: string;
  userId: string;
  coinsCredited: number;
  coinTransactionId: string;
  createdByUid: string;
  createdAt: string;
}

export interface PaymentWebhookEventRecord {
  eventId: string;
  gatewayEventId: string;
  provider: PaymentGatewayProvider;
  paymentTxId: string;
  depositId: string;
  utrReference?: string;
  amountInr: number;
  signaturePresent: boolean;
  computedDigestPreview: string;
  verificationStatus: PaymentWebhookEventOutcome;
  isLiveGatewayActive: boolean;
  note: string;
  actorUid: string;
  createdAt: string;
}

export interface UserPayoutMethod {
  methodId: string;
  uid: string;
  userId: string;
  methodType: PayoutMethodType;
  label: string;
  upiId?: string;
  upiProvider?: string;
  accountHolderName?: string;
  bankName?: string;
  accountNumber?: string;
  accountNumberMasked?: string;
  accountLast4?: string;
  ifscCode?: string;
  accountType?: 'SAVINGS' | 'CURRENT';
  isDefault: boolean;
  verificationStatus: PayoutVerificationStatus;
  verificationMethod: 'ADMIN_REVIEW' | 'OWNERSHIP_CONFIRMED';
  verificationNote?: string;
  verifiedByAdminUid?: string;
  verifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WithdrawalRequest {
  withdrawalId: string;
  uid: string;
  userId: string;
  amountInr: number;
  payoutMethodId?: string;
  payoutMethodType?: PayoutMethodType;
  payoutLabel?: string;
  payoutDestinationMasked?: string;
  idempotencyKey?: string;
  status: WithdrawalStatus;
  remarks?: string;
  createdAt: string;
  updatedAt: string;
  paidAt?: string;
}

export interface ReferralRecord {
  referralId: string;
  referrerUid: string;
  referrerCode: string;
  referredUid: string;
  referredUserId: string;
  createdAt: string;
}

export interface UserActivityLogEntry {
  logId: string;
  uid: string;
  category: UserActivityCategory;
  action: string;
  details: string;
  createdAt: string;
}

export interface AdminActivityLogEntry {
  logId: string;
  actorUid: string;
  actorEmail: string;
  actorRole: 'ADMIN' | 'SUPER_ADMIN';
  actionType: AdminActionType;
  targetId: string;
  summary: string;
  createdAt: string;
}

export interface PlatformSettingsRecord {
  settingId: string;
  payoutsEnabled: boolean;
  registrationsEnabled: boolean;
  supportEmail: string;
  supportPhone: string;
  securityNotice?: string;
  requireEmailVerification?: boolean;
  enforceAdminMfaOrOtp?: boolean;
  sessionTimeoutMinutes?: number;
  maxAdminLoginAttempts?: number;
  auditLogRetentionDays?: number;
  upiDepositsEnabled?: boolean;
  minDepositInr?: number;
  maxDepositInr?: number;
  coinPackagesCsv?: string;
  updatedByUid: string;
  updatedAt: string;
}

export interface AdminLoginAttemptRecord {
  attemptId: string;
  uid: string;
  email: string;
  role: UserRole;
  outcome: 'SUCCESS' | 'DENIED_NOT_ADMIN';
  timestamp: string;
}

export interface SupportTicket {
  ticketId: string;
  uid: string;
  userId: string;
  subject: string;
  description: string;
  attachmentUrl?: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  adminResponse?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppNotification {
  notificationId: string;
  uid: string;
  title: string;
  message: string;
  category: 'PAYMENT' | 'PLAN' | 'REWARD' | 'WITHDRAWAL' | 'ANNOUNCEMENT';
  isRead: boolean;
  createdAt: string;
}
