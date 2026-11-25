import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import {
  CheckCircle2,
  Coins,
  Loader2,
  LogOut,
  Mail,
  Palette,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { LoadingScreen } from '../../components/common/LoadingScreen';
import { DailyRewardBreakdown } from '../../components/dashboard/DailyRewardBreakdown';
import { FinancialInsightsCharts } from '../../components/dashboard/FinancialInsightsCharts';
import { InvestmentHistory } from '../../components/dashboard/InvestmentHistory';
import { MarketNewsTicker } from '../../components/dashboard/MarketNewsTicker';
import { MemberActivityLog } from '../../components/dashboard/MemberActivityLog';
import { MemberInvestmentPlansSection } from '../../components/dashboard/MemberInvestmentPlansSection';
import { ProTipsBanner } from '../../components/dashboard/ProTipsBanner';
import { ProfileAvatarControl } from '../../components/dashboard/ProfileAvatarControl';
import { ProfitProjectionCalculator } from '../../components/dashboard/ProfitProjectionCalculator';
import { ReferralSection } from '../../components/dashboard/ReferralSection';
import { TransactionHistory } from '../../components/dashboard/TransactionHistory';
import { UpiPaymentGateway } from '../../components/dashboard/UpiPaymentGateway';
import { UserWalletControlCenter } from '../../components/dashboard/UserWalletControlCenter';
import { ROUTES } from '../../config/constants';
import { useAuth } from '../../context/AuthContext';
import { usePhoneOtp } from '../../hooks/usePhoneOtp';
import {
  confirmLinkPhoneOtp,
  mapFirebaseError,
  resendVerificationEmail,
  sendLinkPhoneOtp,
} from '../../services/authService';
import { DashboardTheme } from '../../types/domain';
import { ILLUSTRATIVE_PLANS } from '../../data/catalogPreview';
import {
  buildAuthUrlWithPlan,
  buildHomeReturnUrlWithPlan,
  PLAN_QUERY_PARAM,
} from '../../utils/planNavigation';
import { validateIndianMobile, validateOtpCode } from '../../utils/validators';

const THEME_STORAGE_KEY = 'nexora_dashboard_theme';

function loadInitialTheme(): DashboardTheme {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'high-contrast' || saved === 'navy') {
        return saved;
      }
    }
  } catch {
    // Ignore localStorage restrictions
  }
  return 'navy';
}

export function MemberDashboardPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pendingPlanId = searchParams.get(PLAN_QUERY_PARAM)?.trim() || '';
  const pendingPlanPreview = pendingPlanId
    ? ILLUSTRATIVE_PLANS.find((p) => p.planId === pendingPlanId)
    : undefined;
  const {
    firebaseUser,
    profile,
    wallet,
    authReady,
    profileInitializing,
    profileInitError,
    retryProfileInit,
    signOut,
  } = useAuth();

  const [theme, setTheme] = useState<DashboardTheme>(loadInitialTheme);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);

  // Mobile OTP verification inside dashboard (for Email-registered users)
  const [phoneInput, setPhoneInput] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [confirmingOtp, setConfirmingOtp] = useState(false);
  const {
    attachRecaptchaContainer,
    sendingOtp,
    otpSent,
    cooldownSec,
    confirmationResult,
    sendOtpWithVerifier,
    resetOtpFlow,
  } = usePhoneOtp({ cooldownSeconds: 30 });

  useEffect(() => {
    if (profile?.mobile && !phoneInput) {
      setPhoneInput(profile.mobile.replace(/^\+91/, ''));
    }
  }, [profile?.mobile, phoneInput]);

  if (!authReady || (firebaseUser && profileInitializing && !profile)) {
    return <LoadingScreen label="Initializing member account..." />;
  }

  if (!firebaseUser) {
    const loginTarget = pendingPlanId
      ? buildAuthUrlWithPlan(ROUTES.LOGIN, {
          planId: pendingPlanId,
          redirectPath: buildHomeReturnUrlWithPlan(pendingPlanId),
        })
      : ROUTES.LOGIN;
    return <Navigate to={loginTarget} replace />;
  }

  const isHighContrast = theme === 'high-contrast';
  const cardSurfaceClass = isHighContrast
    ? 'bg-white border-2 border-slate-900 rounded-xl'
    : 'bg-white border border-slate-200 rounded-xl';

  const handleToggleTheme = () => {
    const next: DashboardTheme = isHighContrast ? 'navy' : 'high-contrast';
    setTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Non-fatal
    }
  };

  const handleResendEmail = async () => {
    setActionError(null);
    setActionNotice(null);
    setSendingEmail(true);
    try {
      await resendVerificationEmail(firebaseUser);
      setActionNotice(`Verification link sent to ${firebaseUser.email}.`);
    } catch (err) {
      setActionError(mapFirebaseError(err));
    } finally {
      setSendingEmail(false);
    }
  };

  const handleSendLinkOtp = async () => {
    if (sendingOtp || cooldownSec > 0) return;
    setActionError(null);
    setActionNotice(null);
    const mobileErr = validateIndianMobile(phoneInput);
    if (mobileErr) return setActionError(mobileErr);

    const res = await sendOtpWithVerifier(
      (verifier) => sendLinkPhoneOtp(firebaseUser, phoneInput, verifier),
      { isResend: otpSent }
    );
    if (res.dispatched) {
      setOtpCode('');
      setActionNotice('6-digit OTP dispatched to your mobile number.');
    } else if (res.error) {
      setActionError(res.error);
    }
  };

  const handleConfirmLinkOtp = async () => {
    if (confirmingOtp) return;
    setActionError(null);
    setActionNotice(null);
    if (!confirmationResult) return setActionError('Send an OTP code first.');
    const otpErr = validateOtpCode(otpCode);
    if (otpErr) return setActionError(otpErr);

    setConfirmingOtp(true);
    try {
      await confirmLinkPhoneOtp(firebaseUser, confirmationResult, otpCode);
      resetOtpFlow();
      setOtpCode('');
      setActionNotice('Mobile number verified and linked to your account.');
    } catch (err) {
      setActionError(mapFirebaseError(err));
    } finally {
      setConfirmingOtp(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate(ROUTES.HOME, { replace: true });
  };

  return (
    <div
      className={`min-h-[calc(100vh-12rem)] ${
        isHighContrast ? 'bg-white text-slate-950' : 'bg-slate-50 text-slate-900'
      }`}
    >
      {/* Top Scrolling Market News Ticker */}
      <MarketNewsTicker highContrast={isHighContrast} />

      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 sm:py-12 space-y-8">
        <div
          className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 sm:p-8 rounded-xl ${
            isHighContrast
              ? 'bg-slate-950 text-white border-2 border-slate-950'
              : 'bg-[#0B1A30] text-white border border-[#1D3A68]'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center gap-5">
            <ProfileAvatarControl
              uid={firebaseUser.uid}
              fullName={profile?.fullName || firebaseUser.displayName || 'NEXORA Member'}
              avatarUrl={profile?.avatarUrl}
              hasProfileDoc={Boolean(profile)}
              onUpdated={(msg) => {
                setActionError(null);
                setActionNotice(msg);
              }}
            />
            <div className="space-y-1.5">
              <p className="text-xs font-semibold tracking-wider text-[#D8B45A] uppercase">
                Verified Member Account
              </p>
              <h1 className="font-display text-2xl sm:text-3xl font-bold">
                {profile?.fullName || firebaseUser.displayName || 'NEXORA Member'}
              </h1>
              <p className="text-sm text-slate-300 font-mono tabular-nums">
                Permanent User ID:{' '}
                <span className="text-white font-semibold">
                  {profile?.userId || 'Provisioning...'}
                </span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
            <a
              href="#add-coins-gateway"
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-[#0B1A30] bg-[#C59B3B] hover:bg-[#D8B45A] rounded-lg transition-colors whitespace-nowrap"
            >
              <Coins className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Add Coins</span>
            </a>

            <button
              type="button"
              onClick={handleToggleTheme}
              aria-pressed={isHighContrast}
              aria-label="Switch dashboard theme"
              className="inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-white border border-white/25 hover:border-[#C59B3B] hover:bg-white/10 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              <Palette className="h-3.5 w-3.5 text-[#D8B45A]" aria-hidden="true" />
              <span>Theme: {isHighContrast ? 'High-Contrast Light' : 'Classic Navy'}</span>
            </button>

            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white border border-white/25 hover:border-[#C59B3B] hover:bg-white/5 rounded-lg transition-colors cursor-pointer"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        {(actionError || (profileInitError && !profile)) && (
          <div
            role="alert"
            className="p-3.5 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg flex flex-wrap items-center justify-between gap-2"
          >
            <span>{actionError || profileInitError}</span>
            {profileInitError && !profile && (
              <button
                type="button"
                onClick={() => void retryProfileInit()}
                className="px-3 py-1.5 text-xs font-semibold text-[#0B1A30] bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
              >
                Retry Profile Setup
              </button>
            )}
          </div>
        )}

        {actionNotice && (
          <div
            role="status"
            className="p-3.5 text-sm text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" aria-hidden="true" />
            <span>{actionNotice}</span>
          </div>
        )}

        {pendingPlanId && (
          <div className="p-4 bg-[#F8F1DE] border border-[#C59B3B]/60 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5 text-xs sm:text-sm text-[#0B1A30]">
              <p className="font-bold">
                Pending Investment Plan:{' '}
                {pendingPlanPreview?.productName || pendingPlanId}
              </p>
              <p className="text-xs text-slate-700">
                Complete a verified UPI deposit below if needed, then return to confirm your plan
                once coins are credited.
              </p>
            </div>
            <Link
              to={buildHomeReturnUrlWithPlan(pendingPlanId)}
              className="inline-flex items-center justify-center px-4 py-2 text-xs font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] rounded-lg whitespace-nowrap shrink-0"
            >
              Return to Plan Confirmation
            </Link>
          </div>
        )}

        {/* Session-persistent Pro Tips Banner */}
        <ProTipsBanner highContrast={isHighContrast} />

        {/* User Wallet Control Center (Segregated Balances, UPI, Bank, Withdrawals) */}
        <UserWalletControlCenter
          uid={firebaseUser.uid}
          userId={profile?.userId}
          accountStatus={profile?.status}
          wallet={wallet}
          highContrast={isHighContrast}
        />

        {/* Visual Investment Growth & Transaction Cashflow Analytics (Recharts) */}
        <FinancialInsightsCharts
          uid={firebaseUser.uid}
          availableCoins={wallet?.availableCoins ?? 0}
          highContrast={isHighContrast}
        />

        {/* Available Investment Plans & Live Active Investments */}
        <MemberInvestmentPlansSection
          uid={firebaseUser.uid}
          profile={profile}
          wallet={wallet}
          profileInitializing={profileInitializing}
          highContrast={isHighContrast}
        />

        {/* Investment History (Live Firestore past plans, deposits, rewards, and payouts) */}
        <InvestmentHistory uid={firebaseUser.uid} highContrast={isHighContrast} />

        {/* Add Coins via Authorized UPI Gateway */}
        <UpiPaymentGateway
          uid={firebaseUser.uid}
          userId={profile?.userId}
          availableCoins={wallet?.availableCoins ?? 0}
          highContrast={isHighContrast}
        />

        {/* Identity & Verification Status */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className={`${cardSurfaceClass} p-6 space-y-4`}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-[#0B1A30] flex items-center gap-2">
                <Mail className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
                <span>Email Verification</span>
              </h2>
              <span className="text-xs font-semibold text-slate-600">
                {profile?.emailVerified ? 'Verified' : 'Pending Verification'}
              </span>
            </div>
            <p className="text-sm text-slate-600">
              Registered Email:{' '}
              <span className="font-medium text-[#0B1A30]">
                {profile?.email || firebaseUser.email || 'Not provided'}
              </span>
            </p>
            {!profile?.emailVerified && firebaseUser.email && (
              <button
                type="button"
                onClick={handleResendEmail}
                disabled={sendingEmail}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#0B1A30] border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
              >
                {sendingEmail && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Resend Verification Link</span>
              </button>
            )}
          </div>

          <div className={`${cardSurfaceClass} p-6 space-y-4`}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-[#0B1A30] flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
                <span>Mobile OTP Verification</span>
              </h2>
              <span className="text-xs font-semibold text-slate-600">
                {profile?.mobileVerified ? 'Verified' : 'Unverified'}
              </span>
            </div>
            <p className="text-sm text-slate-600 font-mono tabular-nums">
              {profile?.mobile || firebaseUser.phoneNumber || 'No mobile verified yet'}
            </p>

            {!profile?.mobileVerified && (
              <div className="space-y-3 pt-1">
                <div className="flex gap-2">
                  <input
                    type="tel"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    placeholder="9876543210"
                    className="flex-1 px-3 py-2 text-xs font-mono tabular-nums border border-slate-300 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={handleSendLinkOtp}
                    disabled={sendingOtp || confirmingOtp || cooldownSec > 0}
                    className="px-3.5 py-2 text-xs font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] disabled:opacity-60 rounded-lg whitespace-nowrap cursor-pointer tabular-nums"
                  >
                    {sendingOtp
                      ? 'Sending...'
                      : cooldownSec > 0
                      ? `Resend (${cooldownSec}s)`
                      : otpSent
                      ? 'Resend OTP'
                      : 'Verify via OTP'}
                  </button>
                </div>

                {otpSent && (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="6-digit OTP"
                      disabled={confirmingOtp}
                      className="flex-1 px-3 py-2 text-xs font-mono tracking-widest tabular-nums border border-slate-300 rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={handleConfirmLinkOtp}
                      disabled={confirmingOtp}
                      className="px-3.5 py-2 text-xs font-semibold text-[#0B1A30] bg-[#C59B3B] hover:bg-[#D8B45A] disabled:opacity-60 rounded-lg whitespace-nowrap cursor-pointer"
                    >
                      {confirmingOtp ? 'Confirming...' : 'Confirm OTP'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Referral Section with Unique Invite Link & Real Sign-up Count */}
        <ReferralSection
          uid={firebaseUser.uid}
          userId={profile?.userId}
          highContrast={isHighContrast}
        />

        {/* Daily Reward Earnings Breakdown */}
        <DailyRewardBreakdown
          uid={firebaseUser.uid}
          walletEarnedCoins={wallet?.earnedCoins ?? 0}
        />

        {/* Interactive Profit Projection Calculator */}
        <ProfitProjectionCalculator availableCoins={wallet?.availableCoins ?? 0} />

        {/* Verified Coin Transaction History with Dropdown Filter & CSV Export */}
        <TransactionHistory uid={firebaseUser.uid} highContrast={isHighContrast} />

        {/* Real Account Activity & Security Audit Log */}
        <MemberActivityLog uid={firebaseUser.uid} highContrast={isHighContrast} />

        <div className={`${cardSurfaceClass} p-6 flex items-start gap-3 text-sm text-slate-600`}>
          <ShieldCheck className="h-5 w-5 text-[#A37B22] shrink-0 mt-0.5" aria-hidden="true" />
          <p>
            Your account profile and permanent User ID{' '}
            <span className="font-mono font-semibold text-[#0B1A30]">
              {profile?.userId || ''}
            </span>{' '}
            are persisted in Firestore with audited virtual coin ledgers and security logs.
          </p>
        </div>

        <div ref={attachRecaptchaContainer} aria-hidden="true" />
      </div>
    </div>
  );
}
