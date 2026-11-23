import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ROUTES } from '../../config/constants';
import { useBrand } from '../../context/BrandContext';

interface LegalPageProps {
  docType: 'terms' | 'privacy' | 'disclosures';
}

export function LegalPage({ docType }: LegalPageProps) {
  const { brand } = useBrand();

  const content = {
    terms: {
      title: 'Terms & Conditions',
      updated: 'November 2026',
      sections: [
        {
          heading: '1. Platform Scope & Virtual Coin Accounting',
          body: `${brand.siteName} provides a product-referenced virtual coin platform. Initial coin acquisition operates at a fixed conversion rate of ₹100 = 100 Virtual Coins. Users cannot alter conversion rates, plan durations, or reward entitlements.`,
        },
        {
          heading: '2. Illustrative Product Plans',
          body: 'Product categories such as Laptop Plan, Machinery Plan, Compute Node Plan, and Grid Storage Plan serve as structured virtual coin plan tiers. Purchasing a plan deducts virtual coins and does not confer ownership or delivery of physical hardware.',
        },
        {
          heading: '3. Payment Verification & Anti-Fraud Controls',
          body: 'Coin purchase requests are assigned a specific active UPI account. Screenshots alone do not constitute conclusive proof of payment. Duplicate UTR submissions or unauthorized modification attempts result in immediate rejection and account suspension.',
        },
        {
          heading: '4. Permanent User IDs',
          body: 'Upon verified registration, the backend assigns a unique permanent User ID (such as NX100001). Users may not select, transfer, or modify their permanent User ID.',
        },
      ],
    },
    privacy: {
      title: 'Privacy Policy',
      updated: 'November 2026',
      sections: [
        {
          heading: '1. Information Collected',
          body: `${brand.siteName} collects identity and contact records required for authentication (name, email address, verified mobile number), payment verification evidence (UTR references, uploaded payment receipts), and immutable wallet/ledger events.`,
        },
        {
          heading: '2. Segregation & Access Control',
          body: 'Financial records are stored in segregated Firestore collections protected by default-deny security rules. Normal users can view only their own account, wallet, plans, and tickets.',
        },
        {
          heading: '3. Administrative Audit Trail',
          body: 'Authorized administrative actions—including payment verification, account status updates, and branding changes—are logged with timestamps and operator IDs.',
        },
      ],
    },
    disclosures: {
      title: 'Risk & Reward Disclosures',
      updated: 'November 2026',
      sections: [
        {
          heading: '1. Investment Returns',
          body: 'Investment returns are subject to the applicable plan terms and actual business performance. No profit or fixed return is guaranteed unless legally permitted and contractually established.',
        },
        {
          heading: '2. Real Money Earnings',
          body: 'Eligible earnings and payouts are recorded separately from virtual coin balances. INR withdrawals are subject to applicable laws, verification, and approved payout procedures.',
        },
        {
          heading: '3. KYC & Compliance',
          body: 'All payment, investment, and withdrawal activities are subject to applicable Indian regulations, KYC/AML requirements, and taxation obligations.',
        },
      ],
    },
  }[docType];

  return (
    <div className="bg-slate-50 py-12 sm:py-16 min-h-[calc(100vh-12rem)]">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <Link
          to={ROUTES.HOME}
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-[#0B1A30] mb-6"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Back to Homepage</span>
        </Link>

        <article className="bg-white border border-slate-200 rounded-xl p-6 sm:p-10 space-y-8">
          <header className="space-y-2 pb-6 border-b border-slate-200">
            <p className="text-xs font-semibold tracking-wider text-[#A37B22] uppercase">
              {brand.siteName} · Last Updated {content.updated}
            </p>
            <h1 className="font-display text-3xl font-bold text-[#0B1A30]">{content.title}</h1>
          </header>

          <div className="space-y-6">
            {content.sections.map((sec) => (
              <section key={sec.heading} className="space-y-2">
                <h2 className="font-display text-lg font-bold text-[#0B1A30]">{sec.heading}</h2>
                <p className="text-sm sm:text-base text-slate-600 leading-relaxed">{sec.body}</p>
              </section>
            ))}
          </div>
        </article>
      </div>
    </div>
  );
}
