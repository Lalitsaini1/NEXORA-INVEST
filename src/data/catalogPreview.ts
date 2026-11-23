import { ProductPlan } from '../types/domain';

export const HERO_BANNER_IMAGE = '/src/assets/images/hero_nexora_wealth_1795368366660.jpg';

/**
 * Illustrative product-based plan catalog displayed on the homepage.
 * Actual live purchasable plans, coin deductions, and daily credits are
 * governed by Firestore + Cloud Functions in Stage 2+.
 */
export const ILLUSTRATIVE_PLANS: ProductPlan[] = [
  {
    planId: 'PLAN_LAPTOP_100',
    productName: 'Laptop Plan',
    category: 'Workstation Hardware',
    imageUrl: '/src/assets/images/product_laptop_plan_1795368366093.jpg',
    displayedValueInr: 100,
    planPriceInr: 100,
    coinDeductionAmount: 100,
    durationDays: 7,
    totalCoinReward: 188,
    dailyCoinRewardPreview: 27,
    description:
      'Entry-tier illustrative hardware cycle demonstrating integer remainder distribution across a 7-day virtual coin schedule.',
    termsAndConditions:
      'Illustrative product reference only; does not represent physical laptop ownership. Virtual coin rewards are subject to server-side schedule completion.',
    isActive: true,
    isIllustrativePreview: true,
    createdAt: '2026-11-22T00:00:00Z',
    updatedAt: '2026-11-22T00:00:00Z',
  },
  {
    planId: 'PLAN_MACHINERY_500',
    productName: 'Machinery Plan',
    category: 'Industrial Fabrication',
    imageUrl: '/src/assets/images/product_machinery_plan_1795368366327.jpg',
    displayedValueInr: 500,
    planPriceInr: 500,
    coinDeductionAmount: 500,
    durationDays: 14,
    totalCoinReward: 650,
    dailyCoinRewardPreview: 46,
    description:
      'Mid-tier precision CNC hardware reference plan configured for a 14-day automated server reward schedule.',
    termsAndConditions:
      'Illustrative product category. Coin balances are maintained separately from INR withdrawable eligibility.',
    isActive: true,
    isIllustrativePreview: true,
    createdAt: '2026-11-22T00:00:00Z',
    updatedAt: '2026-11-22T00:00:00Z',
  },
  {
    planId: 'PLAN_SERVER_1000',
    productName: 'Compute Node Plan',
    category: 'Enterprise Infrastructure',
    imageUrl: '/src/assets/images/product_server_plan_1795368365751.jpg',
    displayedValueInr: 1000,
    planPriceInr: 1000,
    coinDeductionAmount: 1000,
    durationDays: 21,
    totalCoinReward: 1320,
    dailyCoinRewardPreview: 63,
    description:
      'Structured 21-day compute infrastructure plan with daily 24-hour interval reward tracking and immutable ledger records.',
    termsAndConditions:
      'Illustrative product category. All plan parameters are configurable exclusively by authorized Administrators.',
    isActive: true,
    isIllustrativePreview: true,
    createdAt: '2026-11-22T00:00:00Z',
    updatedAt: '2026-11-22T00:00:00Z',
  },
  {
    planId: 'PLAN_ENERGY_5000',
    productName: 'Grid Storage Plan',
    category: 'Energy Systems',
    imageUrl: '/src/assets/images/product_energy_plan_1795368366399.jpg',
    displayedValueInr: 5000,
    planPriceInr: 5000,
    coinDeductionAmount: 5000,
    durationDays: 30,
    totalCoinReward: 6600,
    dailyCoinRewardPreview: 220,
    description:
      'Extended 30-day virtual coin plan anchored to modular storage hardware metrics with automated completion closure.',
    termsAndConditions:
      'Illustrative product category. No guaranteed financial returns are implied or promised.',
    isActive: true,
    isIllustrativePreview: true,
    createdAt: '2026-11-22T00:00:00Z',
    updatedAt: '2026-11-22T00:00:00Z',
  },
];

export const PLATFORM_CAPABILITIES = [
  {
    number: '01',
    title: 'Atomic Coin Ledger & Idempotent Accounting',
    description:
      'Every purchase, plan investment, and reward credit writes an immutable ledger record with previous balance, new balance, reference ID, and idempotency protection.',
  },
  {
    number: '02',
    title: 'Verified UPI Payment Assignment',
    description:
      'Each coin purchase request permanently binds an active UPI account and QR code. Verification requires UTR validation and manual administrative evidence checks.',
  },
  {
    number: '03',
    title: 'Deterministic 24-Hour Reward Distribution',
    description:
      'Scheduled server jobs distribute integer virtual coin entitlements across the full plan duration using remainder accounting so zero fractional coins are lost or over-issued.',
  },
  {
    number: '04',
    title: 'Segregated Coin & Compliance Balances',
    description:
      'Purchased virtual coins, earned virtual coins, and compliance-eligible withdrawable balances are tracked independently with payouts gated behind legal and KYC review.',
  },
];

export const HOW_IT_WORKS_STEPS = [
  {
    step: '01',
    title: 'Register & Receive Your Permanent NX ID',
    detail:
      'Create an account with email or mobile OTP verification. The backend issues an immutable User ID such as NX100001.',
  },
  {
    step: '02',
    title: 'Request Virtual Coins via Assigned UPI',
    detail:
      'Select an amount at the fixed initial rate (₹100 = 100 Virtual Coins), pay to the assigned active UPI ID, and submit your UTR reference for admin verification.',
  },
  {
    step: '03',
    title: 'Activate a Product-Based Virtual Plan',
    detail:
      'Review plan price, duration, and disclosure terms, then confirm investment. Coins deduct atomically and the plan enters My Active Plans.',
  },
  {
    step: '04',
    title: 'Track Automated Daily Credits & Completion',
    detail:
      'Scheduled backend functions credit one unique daily reward per 24-hour interval until the configured duration and total coin entitlement complete.',
  },
];

export const FAQ_ITEMS = [
  {
    question: 'What is the conversion rate for Virtual Coins on NEXORA INVEST?',
    answer:
      'The initial fixed conversion rate is ₹100 = 100 Virtual Coins (for example, ₹500 = 500 Coins, ₹1,000 = 1,000 Coins, and ₹5,000 = 5,000 Coins). Ordinary users cannot alter this rate.',
  },
  {
    question: 'Do product plans grant physical ownership of laptops or machinery?',
    answer:
      'No. Product cards such as the Laptop Plan or Machinery Plan represent structured virtual coin plan tiers and illustrative reference categories, not ownership or delivery of physical equipment.',
  },
  {
    question: 'How are daily virtual coin rewards calculated without rounding errors?',
    answer:
      'The backend uses integer coin accounting with deterministic remainder distribution. For example, a 188-coin reward across 7 days distributes 27 coins across 6 intervals and 26 coins on 1 interval, totaling exactly 188 Coins.',
  },
  {
    question: 'Are virtual coin rewards immediately withdrawable as real INR?',
    answer:
      'No. Purchased Virtual Coins, Earned Virtual Coins, and Legally Eligible Withdrawable Balances are maintained separately. Real-money payouts remain disabled by default until legal, KYC/AML, and tax compliance approvals are completed.',
  },
  {
    question: 'How does UPI payment verification prevent duplicate credits?',
    answer:
      'Each deposit request locks a single active UPI account and requires a unique UTR reference plus administrative verification. Screenshots alone are never treated as conclusive proof, and duplicate UTRs are rejected.',
  },
];
