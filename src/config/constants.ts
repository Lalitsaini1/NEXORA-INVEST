import { BrandSettings } from '../types/domain';

export const DEFAULT_BRAND_SETTINGS: BrandSettings = {
  siteName: 'NEXORA INVEST',
  tagline: 'Real Money Investment & Earnings Platform',
  primaryNavyHex: '#0B1A30',
  accentGoldHex: '#C59B3B',
  supportEmail: 'support@nexorainvest.example',
  supportPhone: '+91 800-000-0000',
};

/**
 * Fixed initial conversion rate: ₹100 = 100 Virtual Coins (1 INR = 1 Virtual Coin).
 * Ordinary users cannot modify this rate.
 */
export const COIN_CONVERSION_RATE = {
  inrAmount: 100,
  virtualCoins: 100,
  coinsPerInr: 1,
} as const;

export const USER_ID_PREFIX = 'NX';

export const WITHDRAWAL_PRESET_AMOUNTS_INR = [200, 300, 500] as const;

/**
 * Real-money payouts remain disabled by default until regulatory, KYC/AML,
 * and taxation reviews are completed and explicitly enabled by an authorized Admin.
 */
export const DEFAULT_PAYOUTS_ENABLED = false;

export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  REGISTER: '/register',
  RESET_PASSWORD: '/reset-password',
  ADMIN_LOGIN: '/admin/login',
  USER_DASHBOARD: '/dashboard',
  ADMIN_DASHBOARD: '/admin',
  TERMS: '/legal/terms',
  PRIVACY: '/legal/privacy',
  DISCLOSURES: '/legal/disclosures',
} as const;

export const OWNER_ADMIN_EMAIL = 'saini.lalit278@gmail.com';

export const SUPER_ADMIN_UID = 'wZQCw7fXrWQCn5HqdSjS6RQHVyi1';

export const SUPER_ADMIN_EMAILS = [OWNER_ADMIN_EMAIL] as const;
