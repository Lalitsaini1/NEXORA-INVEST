import { Link } from 'react-router-dom';
import { NexoraLogo } from '../branding/NexoraLogo';
import { useBrand } from '../../context/BrandContext';
import { ROUTES } from '../../config/constants';

export function SiteFooter() {
  const { brand } = useBrand();

  return (
    <footer className="bg-[#0B1A30] text-slate-300 border-t border-[#1D3A68]">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12 sm:py-16">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 pb-10 border-b border-white/10">
          <div className="md:col-span-5 space-y-4">
            <NexoraLogo variant="full" theme="light-on-dark" size="md" />
            <p className="text-sm text-slate-300 leading-relaxed max-w-sm">
              {brand.tagline}. Invest Real Money. Earn Real Rewards. Real Money. Transparent
              Investments. Clear Records.
            </p>
            <p className="text-xs text-slate-400 leading-relaxed max-w-sm">
              Notice: {brand.siteName} is an original brand identity. Domain and trademark
              availability checks must be verified prior to commercial launch.
            </p>
          </div>

          <div className="md:col-span-2 space-y-3">
            <h3 className="text-xs font-semibold tracking-wider text-[#D8B45A] uppercase">
              Platform
            </h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to={ROUTES.HOME} className="hover:text-white transition-colors">
                  Homepage
                </Link>
              </li>
              <li>
                <Link to={ROUTES.LOGIN} className="hover:text-white transition-colors">
                  User Sign In
                </Link>
              </li>
              <li>
                <Link to={ROUTES.REGISTER} className="hover:text-white transition-colors">
                  Create Account
                </Link>
              </li>
              <li>
                <Link to={ROUTES.ADMIN_LOGIN} className="hover:text-white transition-colors">
                  Admin Portal
                </Link>
              </li>
            </ul>
          </div>

          <div className="md:col-span-3 space-y-3">
            <h3 className="text-xs font-semibold tracking-wider text-[#D8B45A] uppercase">
              Legal & Disclosures
            </h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to={ROUTES.TERMS} className="hover:text-white transition-colors">
                  Terms & Conditions
                </Link>
              </li>
              <li>
                <Link to={ROUTES.PRIVACY} className="hover:text-white transition-colors">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link to={ROUTES.DISCLOSURES} className="hover:text-white transition-colors">
                  Risk & Reward Disclosures
                </Link>
              </li>
            </ul>
          </div>

          <div className="md:col-span-2 space-y-3">
            <h3 className="text-xs font-semibold tracking-wider text-[#D8B45A] uppercase">
              Support
            </h3>
            <ul className="space-y-2 text-sm text-slate-300">
              <li className="break-all">{brand.supportEmail}</li>
              <li className="font-mono text-xs tabular-nums">{brand.supportPhone}</li>
            </ul>
          </div>
        </div>

        <div className="pt-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-400">
          <p>
            &copy; {new Date().getFullYear()} {brand.siteName}. Virtual coins are non-INR
            accounting units unless legally enabled.
          </p>
          <p className="tabular-nums">Initial Rate: ₹100 = 100 Virtual Coins</p>
        </div>
      </div>
    </footer>
  );
}
