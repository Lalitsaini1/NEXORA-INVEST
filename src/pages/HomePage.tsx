import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Lock,
  Mail,
  Phone,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  FAQ_ITEMS,
  HERO_BANNER_IMAGE,
  HOW_IT_WORKS_STEPS,
  ILLUSTRATIVE_PLANS,
  PLATFORM_CAPABILITIES,
} from '../data/catalogPreview';
import { ROUTES } from '../config/constants';
import { useBrand } from '../context/BrandContext';
import { ProductPlan } from '../types/domain';
import { formatCoins, formatInr } from '../utils/formatters';
import { validateEmail, validateFullName } from '../utils/validators';
import { ImageWithFallback } from '../components/common/ImageWithFallback';
import { ProductPlanCard } from '../components/home/ProductPlanCard';

export function HomePage() {
  const { brand } = useBrand();
  const navigate = useNavigate();

  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);
  const [selectedPlanForGate, setSelectedPlanForGate] = useState<ProductPlan | null>(null);

  // Support / Contact form state
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactSubject, setContactSubject] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactSubmitted, setContactSubmitted] = useState(false);

  const categories = ['ALL', ...Array.from(new Set(ILLUSTRATIVE_PLANS.map((p) => p.category)))];

  const visiblePlans =
    selectedCategory === 'ALL'
      ? ILLUSTRATIVE_PLANS
      : ILLUSTRATIVE_PLANS.filter((p) => p.category === selectedCategory);

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const nameErr = validateFullName(contactName);
    if (nameErr) return setContactError(nameErr);
    const emailErr = validateEmail(contactEmail);
    if (emailErr) return setContactError(emailErr);
    if (contactSubject.trim().length < 4) {
      return setContactError('Please enter a brief subject (at least 4 characters).');
    }
    if (contactMessage.trim().length < 15) {
      return setContactError('Please describe your inquiry in at least 15 characters.');
    }

    setContactError(null);
    setContactSubmitted(true);
  };

  return (
    <div className="bg-slate-50 text-slate-900">
      {/* 1. HERO / WELCOME BANNER */}
      <section className="bg-[#0B1A30] text-white border-b border-[#1D3A68]">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-14 sm:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
            <div className="lg:col-span-7 flex flex-col justify-center space-y-6">
              <div className="flex items-center gap-2 text-xs font-medium tracking-wider text-[#D8B45A] uppercase">
                <span>{brand.siteName}</span>
                <span aria-hidden="true">·</span>
                <span>Real Money Investment &amp; Earnings Platform</span>
              </div>

              <h1
                className="font-display font-bold tracking-tight text-white leading-[1.08]"
                style={{
                  fontSize: 'clamp(2.25rem, 4vw, 3.5rem)',
                  textWrap: 'balance',
                }}
              >
                Invest Real Money. Earn Real Rewards.
              </h1>

              <p className="text-base sm:text-lg text-slate-300 leading-relaxed max-w-2xl">
                Welcome to {brand.siteName} — a modern investment platform where users can
                participate in structured investment plans using real Indian currency (INR). Start
                investing with real money, choose from available investment plans, and track your
                investment activity, earnings, and eligible payouts through your personal dashboard
                at{' '}
                <span className="font-mono text-white font-medium tabular-nums">
                  ₹100 = 100 Coins
                </span>{' '}
                ledger parity.
              </p>

              <div className="flex flex-wrap items-center gap-4 pt-2">
                <Link
                  to={ROUTES.REGISTER}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3.5 text-sm font-semibold text-[#0B1A30] bg-[#C59B3B] hover:bg-[#D8B45A] rounded-lg transition-colors whitespace-nowrap"
                >
                  <span>Create Account</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  to={ROUTES.LOGIN}
                  className="inline-flex items-center justify-center px-6 py-3.5 text-sm font-semibold text-white border border-white/25 hover:border-[#C59B3B] hover:bg-white/5 rounded-lg transition-colors whitespace-nowrap"
                >
                  Sign In to Dashboard
                </Link>
              </div>
            </div>

            <div className="lg:col-span-5">
              <div className="h-full min-h-[260px] rounded-xl overflow-hidden border border-[#C59B3B]/35 bg-[#13284A]">
                <ImageWithFallback
                  src={HERO_BANNER_IMAGE}
                  alt="NEXORA INVEST executive financial architecture"
                  fallbackTitle="NEXORA INVEST Private Wealth Architecture"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>

          {/* 4-column Architectural Rule Strip below Hero Split */}
          <div className="mt-12 pt-8 border-t border-white/10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <p className="text-xs text-slate-400">Fixed Initial Conversion</p>
              <p className="font-mono text-lg font-semibold text-white tabular-nums mt-1">
                ₹100 = 100 Coins
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Permanent Account Format</p>
              <p className="font-mono text-lg font-semibold text-white tabular-nums mt-1">
                NX100001+
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Reward Cadence</p>
              <p className="font-mono text-lg font-semibold text-white tabular-nums mt-1">
                24-Hour Server Cycle
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Real-Money Payout Gate</p>
              <p className="font-mono text-lg font-semibold text-[#D8B45A] mt-1">
                Compliance Controlled
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. INTRODUCTION & WHY CHOOSE NEXORA INVEST */}
      <section className="py-16 sm:py-20 bg-white border-b border-slate-200">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 space-y-12">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
            <div className="lg:col-span-5 space-y-3">
              <p className="text-xs font-semibold tracking-wider text-[#A37B22] uppercase">
                Why Choose {brand.siteName}?
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#0B1A30] tracking-tight">
                Real Money. Transparent Investments. Clear Records.
              </h2>
            </div>
            <div className="lg:col-span-7 space-y-4 text-slate-600 leading-relaxed">
              <p>
                Start investing with real money, choose from available investment plans, and track
                your investment activity, earnings, and eligible payouts through your personal
                dashboard.
              </p>
              <p>
                Every deposit, plan enrollment, and reward credit executes through atomic Firestore
                transactions and deterministic credit locks, keeping real INR deposits, eligible
                real-money earnings, and virtual coin balances cleanly segregated.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                title: 'Real INR Deposits',
                detail: 'Make investments using Indian Rupees.',
              },
              {
                title: 'Structured Investment Plans',
                detail: 'Explore clearly defined investment packages.',
              },
              {
                title: 'Real Money Earnings',
                detail: 'Track actual INR earnings where applicable under the selected plan.',
              },
              {
                title: 'Transparent Records',
                detail: 'View deposits, investments, earnings, and eligible withdrawals.',
              },
              {
                title: 'Secure Payment Processing',
                detail: 'Payments are handled through supported payment channels.',
              },
              {
                title: 'Account Dashboard',
                detail: 'Manage your investment activity in one place.',
              },
            ].map((item) => (
              <div
                key={item.title}
                className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2
                    className="h-4 w-4 text-[#A37B22] shrink-0"
                    aria-hidden="true"
                  />
                  <h3 className="font-display text-sm font-bold text-[#0B1A30]">
                    {item.title}
                  </h3>
                </div>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed pl-6">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3. PRODUCT-BASED PLAN CATALOG */}
      <section id="plans" className="py-16 sm:py-24 bg-slate-50 border-b border-slate-200">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 space-y-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="space-y-2 max-w-2xl">
              <p className="text-xs font-semibold tracking-wider text-[#A37B22] uppercase">
                Illustrative Product Catalog
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#0B1A30] tracking-tight">
                Structured Product-Based Virtual Plans
              </h2>
              <p className="text-sm sm:text-base text-slate-600">
                Inspect exact coin deduction amounts, duration intervals, and integer remainder
                reward schedules before authenticating.
              </p>
            </div>

            {/* Interactive Category Filter Control */}
            <div
              role="group"
              aria-label="Filter product plans by category"
              className="flex flex-wrap items-center gap-1 p-1 bg-white border border-slate-200 rounded-lg self-start"
            >
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                    selectedCategory === cat
                      ? 'bg-[#0B1A30] text-white'
                      : 'text-slate-600 hover:text-[#0B1A30] hover:bg-slate-50'
                  }`}
                >
                  {cat === 'ALL' ? 'All Categories' : cat}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8">
            {visiblePlans.map((plan) => (
              <ProductPlanCard
                key={plan.planId}
                plan={plan}
                onInvestClick={(chosen) => setSelectedPlanForGate(chosen)}
              />
            ))}
          </div>
        </div>
      </section>

      {/* 4. CORE CAPABILITIES / FEATURES */}
      <section id="features" className="py-16 sm:py-24 bg-white border-b border-slate-200">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 space-y-12">
          <div className="max-w-2xl space-y-2">
            <p className="text-xs font-semibold tracking-wider text-[#A37B22] uppercase">
              Security & Governance
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#0B1A30] tracking-tight">
              Engineered for auditability from the first transaction.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {PLATFORM_CAPABILITIES.map((item) => (
              <div
                key={item.number}
                className="p-6 sm:p-8 bg-slate-50 border border-slate-200 rounded-xl space-y-3"
              >
                <span className="font-mono text-xs font-semibold text-[#A37B22]">
                  {item.number}.
                </span>
                <h3 className="font-display text-xl font-bold text-[#0B1A30]">{item.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. HOW IT WORKS */}
      <section id="how-it-works" className="py-16 sm:py-24 bg-slate-50 border-b border-slate-200">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 space-y-12">
          <div className="max-w-2xl space-y-2">
            <p className="text-xs font-semibold tracking-wider text-[#A37B22] uppercase">
              Operational Lifecycle
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#0B1A30] tracking-tight">
              How {brand.siteName} operates end-to-end
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {HOW_IT_WORKS_STEPS.map((step) => (
              <div
                key={step.step}
                className="bg-white border border-slate-200 rounded-xl p-6 space-y-3"
              >
                <p className="font-mono text-sm font-semibold text-[#C59B3B]">
                  Step {step.step}
                </p>
                <h3 className="font-display text-lg font-bold text-[#0B1A30]">{step.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{step.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6. FREQUENTLY ASKED QUESTIONS */}
      <section id="faq" className="py-16 sm:py-24 bg-white border-b border-slate-200">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 space-y-10">
          <div className="space-y-2">
            <p className="text-xs font-semibold tracking-wider text-[#A37B22] uppercase">
              Frequently Asked Questions
            </p>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#0B1A30] tracking-tight">
              Clarifications on coins, rewards, and compliance
            </h2>
          </div>

          <div className="divide-y divide-slate-200 border-y border-slate-200">
            {FAQ_ITEMS.map((faq, idx) => {
              const isOpen = openFaqIndex === idx;
              return (
                <div key={faq.question} className="py-5">
                  <button
                    type="button"
                    onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                    aria-expanded={isOpen}
                    className="w-full flex items-center justify-between gap-4 text-left cursor-pointer"
                  >
                    <span className="font-display text-base sm:text-lg font-semibold text-[#0B1A30]">
                      {faq.question}
                    </span>
                    <ChevronDown
                      className={`h-5 w-5 shrink-0 text-slate-500 transition-transform ${
                        isOpen ? 'rotate-180 text-[#A37B22]' : ''
                      }`}
                      aria-hidden="true"
                    />
                  </button>
                  {isOpen && (
                    <p className="mt-3 text-sm sm:text-base text-slate-600 leading-relaxed pr-8">
                      {faq.answer}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 7. CONTACT & SUPPORT */}
      <section id="support" className="py-16 sm:py-24 bg-slate-50 border-b border-slate-200">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
            <div className="lg:col-span-5 space-y-5">
              <p className="text-xs font-semibold tracking-wider text-[#A37B22] uppercase">
                Contact & Support
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-[#0B1A30] tracking-tight">
                Reach the {brand.siteName} Desk
              </h2>
              <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
                Have questions regarding account onboarding, UPI verification procedures, or
                compliance disclosures? Submit an inquiry below.
              </p>

              <div className="space-y-3 pt-2 text-sm text-slate-700">
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
                  <span>{brand.supportEmail}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
                  <span className="font-mono tabular-nums">{brand.supportPhone}</span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-7">
              <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
                {contactSubmitted ? (
                  <div className="py-8 text-center space-y-4">
                    <CheckCircle2
                      className="h-10 w-10 text-emerald-600 mx-auto"
                      aria-hidden="true"
                    />
                    <h3 className="font-display text-xl font-bold text-[#0B1A30]">
                      Inquiry Validated
                    </h3>
                    <p className="text-sm text-slate-600 max-w-md mx-auto">
                      Thank you, {contactName}. Your inquiry has been validated. Please reach our
                      support desk at {brand.supportEmail} or sign in to your Member Dashboard for
                      account-specific assistance.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setContactSubmitted(false);
                        setContactName('');
                        setContactEmail('');
                        setContactSubject('');
                        setContactMessage('');
                      }}
                      className="px-4 py-2 text-sm font-semibold text-[#0B1A30] border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                    >
                      Send Another Inquiry
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleContactSubmit} className="space-y-4" noValidate>
                    {contactError && (
                      <div
                        role="alert"
                        className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg"
                      >
                        {contactError}
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label
                          htmlFor="contact-name"
                          className="block text-xs font-semibold text-slate-700 mb-1.5"
                        >
                          Full Name
                        </label>
                        <input
                          id="contact-name"
                          type="text"
                          value={contactName}
                          onChange={(e) => setContactName(e.target.value)}
                          placeholder="Aarav Sharma"
                          className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
                          required
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="contact-email"
                          className="block text-xs font-semibold text-slate-700 mb-1.5"
                        >
                          Email Address
                        </label>
                        <input
                          id="contact-email"
                          type="email"
                          value={contactEmail}
                          onChange={(e) => setContactEmail(e.target.value)}
                          placeholder="name@domain.com"
                          className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
                          required
                        />
                      </div>
                    </div>
                    <div>
                      <label
                        htmlFor="contact-subject"
                        className="block text-xs font-semibold text-slate-700 mb-1.5"
                      >
                        Subject
                      </label>
                      <input
                        id="contact-subject"
                        type="text"
                        value={contactSubject}
                        onChange={(e) => setContactSubject(e.target.value)}
                        placeholder="Account verification or plan terms inquiry"
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
                        required
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="contact-message"
                        className="block text-xs font-semibold text-slate-700 mb-1.5"
                      >
                        Message
                      </label>
                      <textarea
                        id="contact-message"
                        rows={4}
                        value={contactMessage}
                        onChange={(e) => setContactMessage(e.target.value)}
                        placeholder="Describe your question clearly..."
                        className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
                        required
                      />
                    </div>
                    <button
                      type="submit"
                      className="px-6 py-3 text-sm font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] rounded-lg transition-colors cursor-pointer"
                    >
                      Submit Inquiry
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 8. RISK & REWARD DISCLOSURES */}
      <section className="py-14 bg-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 space-y-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <ShieldAlert className="h-5 w-5 text-[#A37B22] shrink-0" aria-hidden="true" />
              <h2 className="font-display text-xl sm:text-2xl font-bold text-[#0B1A30]">
                Risk &amp; Reward Disclosures
              </h2>
            </div>
            <Link
              to={ROUTES.DISCLOSURES}
              className="text-xs font-semibold text-[#0B1A30] hover:text-[#A37B22] underline underline-offset-4 whitespace-nowrap shrink-0"
            >
              Read Full Disclosures
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <h3 className="font-display text-sm font-bold text-[#0B1A30]">
                1. Investment Returns
              </h3>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                Investment returns are subject to the applicable plan terms and actual business
                performance. No profit or fixed return is guaranteed unless legally permitted and
                contractually established.
              </p>
            </div>
            <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <h3 className="font-display text-sm font-bold text-[#0B1A30]">
                2. Real Money Earnings
              </h3>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                Eligible earnings and payouts are recorded separately from virtual coin balances.
                INR withdrawals are subject to applicable laws, verification, and approved payout
                procedures.
              </p>
            </div>
            <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <h3 className="font-display text-sm font-bold text-[#0B1A30]">
                3. KYC &amp; Compliance
              </h3>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                All payment, investment, and withdrawal activities are subject to applicable Indian
                regulations, KYC/AML requirements, and taxation obligations.
              </p>
            </div>
          </div>

          <p className="text-xs font-medium text-slate-500 text-center pt-2">
            {brand.siteName} — Real Money. Transparent Investments. Clear Records.
          </p>
        </div>
      </section>

      {/* INVEST NOW AUTH GATE MODAL */}
      {selectedPlanForGate && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="invest-gate-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1A30]/70 backdrop-blur-xs p-4"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 space-y-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-[#A37B22] uppercase">
                  Authentication Required
                </p>
                <h3 id="invest-gate-title" className="font-display text-xl font-bold text-[#0B1A30]">
                  {selectedPlanForGate.productName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPlanForGate(null)}
                className="p-1.5 text-slate-500 hover:text-[#0B1A30] rounded-lg hover:bg-slate-100 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">Plan Deduction</span>
                <span className="font-mono font-semibold text-[#0B1A30] tabular-nums">
                  {formatCoins(selectedPlanForGate.coinDeductionAmount)} (
                  {formatInr(selectedPlanForGate.planPriceInr)})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Duration</span>
                <span className="font-mono text-[#0B1A30] tabular-nums">
                  {selectedPlanForGate.durationDays} Days
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Scheduled Total Reward</span>
                <span className="font-mono font-semibold text-[#A37B22] tabular-nums">
                  {formatCoins(selectedPlanForGate.totalCoinReward)}
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed flex items-start gap-2">
              <Lock className="h-4 w-4 text-[#0B1A30] shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                Plan activation processes atomically against your verified INR &amp; virtual coin
                ledger. Sign in or create an account to activate live structured investment plans.
              </span>
            </p>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                onClick={() => {
                  setSelectedPlanForGate(null);
                  navigate(ROUTES.LOGIN);
                }}
                className="py-2.5 px-4 text-sm font-semibold text-[#0B1A30] border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedPlanForGate(null);
                  navigate(ROUTES.REGISTER);
                }}
                className="py-2.5 px-4 text-sm font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] rounded-lg cursor-pointer"
              >
                Register Account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
