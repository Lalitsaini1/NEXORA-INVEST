import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { NexoraLogo } from '../branding/NexoraLogo';
import { ROUTES } from '../../config/constants';
import { useAuth } from '../../context/AuthContext';

const NAV_LINKS = [
  { label: 'Plans', href: '#plans' },
  { label: 'Features', href: '#features' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'FAQ', href: '#faq' },
  { label: 'Support', href: '#support' },
];

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { firebaseUser, isAdmin } = useAuth();

  const handleAnchorClick = (href: string) => {
    setMobileOpen(false);
    if (location.pathname !== ROUTES.HOME) {
      navigate(ROUTES.HOME);
      setTimeout(() => {
        const el = document.querySelector(href);
        el?.scrollIntoView({ behavior: 'smooth' });
      }, 80);
    } else {
      const el = document.querySelector(href);
      el?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const primaryActionRoute = firebaseUser
    ? isAdmin
      ? ROUTES.ADMIN_DASHBOARD
      : ROUTES.USER_DASHBOARD
    : ROUTES.LOGIN;

  const primaryActionLabel = firebaseUser ? (isAdmin ? 'Admin Panel' : 'Dashboard') : 'Sign In';

  return (
    <header className="sticky top-0 z-40 w-full bg-white/95 backdrop-blur border-b border-slate-200">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <Link
          to={ROUTES.HOME}
          className="focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C59B3B] rounded-lg whitespace-nowrap shrink-0"
          aria-label="NEXORA INVEST Home"
        >
          <span className="hidden sm:inline-flex">
            <NexoraLogo variant="full" theme="dark-on-light" size="md" />
          </span>
          <span className="inline-flex sm:hidden">
            <NexoraLogo variant="compact" theme="dark-on-light" size="sm" />
          </span>
        </Link>

        {/* Zone 2: 5 concise single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600" aria-label="Main navigation">
          {NAV_LINKS.map((item) => (
            <button
              key={item.href}
              type="button"
              onClick={() => handleAnchorClick(item.href)}
              className="whitespace-nowrap shrink-0 py-1 hover:text-[#0B1A30] hover:underline underline-offset-4 decoration-[#C59B3B] transition-colors cursor-pointer"
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: 1 primary action + mobile drawer trigger */}
        <div className="flex items-center gap-3 shrink-0">
          <Link
            to={primaryActionRoute}
            className="hidden md:inline-flex items-center justify-center px-5 py-2.5 text-sm font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] rounded-lg transition-colors whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C59B3B]"
          >
            {primaryActionLabel}
          </Link>

          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            className="md:hidden inline-flex items-center justify-center h-11 w-11 rounded-lg border border-slate-200 text-[#0B1A30] hover:bg-slate-50 transition-colors"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Responsive mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden border-t border-slate-200 bg-white px-4 py-4 space-y-3">
          <nav className="flex flex-col space-y-1" aria-label="Mobile navigation">
            {NAV_LINKS.map((item) => (
              <button
                key={item.href}
                type="button"
                onClick={() => handleAnchorClick(item.href)}
                className="text-left px-3 py-2.5 text-sm font-medium text-slate-700 hover:text-[#0B1A30] hover:bg-slate-50 rounded-lg transition-colors"
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-3">
            {firebaseUser ? (
              <Link
                to={primaryActionRoute}
                onClick={() => setMobileOpen(false)}
                className="col-span-2 inline-flex items-center justify-center py-2.5 px-4 text-sm font-semibold text-white bg-[#0B1A30] rounded-lg hover:bg-[#13284A] transition-colors whitespace-nowrap"
              >
                {primaryActionLabel}
              </Link>
            ) : (
              <>
                <Link
                  to={ROUTES.LOGIN}
                  onClick={() => setMobileOpen(false)}
                  className="inline-flex items-center justify-center py-2.5 px-4 text-sm font-semibold text-[#0B1A30] border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
                >
                  Sign In
                </Link>
                <Link
                  to={ROUTES.REGISTER}
                  onClick={() => setMobileOpen(false)}
                  className="inline-flex items-center justify-center py-2.5 px-4 text-sm font-semibold text-white bg-[#0B1A30] rounded-lg hover:bg-[#13284A] transition-colors whitespace-nowrap"
                >
                  Register
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
