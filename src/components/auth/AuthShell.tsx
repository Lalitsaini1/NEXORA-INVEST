import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { NexoraLogo } from '../branding/NexoraLogo';
import { ROUTES } from '../../config/constants';
import { useBrand } from '../../context/BrandContext';

interface AuthShellProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  isAdmin?: boolean;
}

export function AuthShell({ title, subtitle, children, isAdmin = false }: AuthShellProps) {
  const { brand } = useBrand();

  return (
    <div className="min-h-[calc(100vh-4rem)] grid grid-cols-1 lg:grid-cols-12 bg-slate-50">
      {/* Branded Architectural Side Panel */}
      <aside className="lg:col-span-5 bg-[#0B1A30] text-white p-8 sm:p-12 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-[#1D3A68]">
        <div className="space-y-8">
          <Link to={ROUTES.HOME} className="inline-block">
            <NexoraLogo variant="full" theme="light-on-dark" size="lg" />
          </Link>

          <div className="space-y-4 max-w-md">
            <p className="text-xs font-semibold tracking-wider text-[#D8B45A] uppercase">
              {isAdmin ? 'Authorized Administration' : 'Account Security & Ledger Access'}
            </p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">
              {isAdmin
                ? 'Server-verified administrative governance.'
                : `Welcome to ${brand.siteName}.`}
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              {isAdmin
                ? 'Admin access requires explicit server-side authorization. Every administrative action is permanently recorded in the audit ledger.'
                : 'Every verified member receives an immutable backend-issued User ID (such as NX100001) and atomic coin wallet accounting.'}
            </p>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-white/10 space-y-2 text-xs text-slate-400">
          <div className="flex items-center gap-2 text-slate-200 font-medium">
            <ShieldCheck className="h-4 w-4 text-[#C59B3B]" aria-hidden="true" />
            <span>Initial Fixed Rate: ₹100 = 100 Virtual Coins</span>
          </div>
          <p>
            Virtual coins do not represent guaranteed INR returns.{' '}
            <Link to={ROUTES.DISCLOSURES} className="text-[#D8B45A] underline underline-offset-2">
              View disclosures
            </Link>
            .
          </p>
        </div>
      </aside>

      {/* Form Viewport */}
      <main className="lg:col-span-7 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
          <div className="space-y-1.5">
            <h2 className="font-display text-2xl font-bold text-[#0B1A30]">{title}</h2>
            <p className="text-sm text-slate-600">{subtitle}</p>
          </div>

          {children}
        </div>
      </main>
    </div>
  );
}
