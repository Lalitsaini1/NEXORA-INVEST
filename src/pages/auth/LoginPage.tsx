import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, KeyRound, Loader2, Smartphone } from 'lucide-react';
import { AuthShell } from '../../components/auth/AuthShell';
import { ROUTES } from '../../config/constants';
import { useAuth } from '../../context/AuthContext';
import { ILLUSTRATIVE_PLANS } from '../../data/catalogPreview';
import { usePhoneOtp } from '../../hooks/usePhoneOtp';
import {
  loginWithEmailPassword,
  loginWithPhoneOtp,
  mapFirebaseError,
  sendPhoneOtp,
} from '../../services/authService';
import {
  buildAuthUrlWithPlan,
  extractSelectedPlanId,
  loadPendingPlanId,
  REDIRECT_QUERY_PARAM,
  resolvePostAuthDestination,
  savePendingPlanId,
} from '../../utils/planNavigation';
import {
  validateEmail,
  validateIndianMobile,
  validateOtpCode,
} from '../../utils/validators';

type LoginMethod = 'email' | 'otp';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const {
    firebaseUser,
    profile,
    authReady,
    profileInitializing,
    profileInitError,
    retryProfileInit,
  } = useAuth();

  const selectedPlanId = extractSelectedPlanId({
    searchParams,
    locationState: location.state,
    useStorageFallback: true,
  });
  const redirectQuery = searchParams.get(REDIRECT_QUERY_PARAM);
  const selectedPlanPreview = selectedPlanId
    ? ILLUSTRATIVE_PLANS.find((p) => p.planId === selectedPlanId)
    : undefined;

  useEffect(() => {
    if (selectedPlanId) {
      savePendingPlanId(selectedPlanId);
    }
  }, [selectedPlanId]);

  const destination = resolvePostAuthDestination({
    searchParams,
    locationState: location.state,
    storedPlanId: selectedPlanId || loadPendingPlanId(),
    defaultRoute: ROUTES.USER_DASHBOARD,
  });

  const registerUrl = buildAuthUrlWithPlan(ROUTES.REGISTER, {
    planId: selectedPlanId,
    redirectPath: redirectQuery,
  });

  const [method, setMethod] = useState<LoginMethod>('email');

  // Email login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Mobile OTP state
  const [mobile, setMobile] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const {
    attachRecaptchaContainer,
    sendingOtp,
    otpSent,
    cooldownSec,
    confirmationResult,
    sendOtpWithVerifier,
    resetOtpFlow,
  } = usePhoneOtp({ cooldownSeconds: 30 });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (authReady && firebaseUser && profile) {
      navigate(destination, { replace: true });
    }
  }, [authReady, firebaseUser, profile, destination, navigate]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setStatusMessage(null);

    const emailErr = validateEmail(email);
    if (emailErr) return setError(emailErr);
    if (!password) return setError('Enter your password.');

    setSubmitting(true);
    try {
      await loginWithEmailPassword(email, password);
      navigate(destination, { replace: true });
    } catch (err) {
      setError(mapFirebaseError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendOtp = async () => {
    if (sendingOtp || cooldownSec > 0) return;
    setError(null);
    setStatusMessage(null);

    const mobileErr = validateIndianMobile(mobile);
    if (mobileErr) return setError(mobileErr);

    const res = await sendOtpWithVerifier(
      (verifier) => sendPhoneOtp(mobile, verifier),
      { isResend: otpSent }
    );
    if (res.dispatched) {
      setOtpCode('');
      setStatusMessage('A 6-digit verification code has been dispatched via SMS.');
    } else if (res.error) {
      setError(res.error);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setStatusMessage(null);

    if (!confirmationResult) {
      return setError('Request an OTP verification code first.');
    }
    const otpErr = validateOtpCode(otpCode);
    if (otpErr) return setError(otpErr);

    setSubmitting(true);
    try {
      await loginWithPhoneOtp(confirmationResult, otpCode);
      resetOtpFlow();
      navigate(destination, { replace: true });
    } catch (err) {
      setError(mapFirebaseError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Sign in to your account"
      subtitle="Access your virtual coin wallet, active plans, and reward history."
    >
      {selectedPlanId && (
        <div className="p-3 bg-[#F8F1DE] border border-[#C59B3B]/50 rounded-lg flex items-center justify-between gap-2 text-xs text-[#0B1A30]">
          <div>
            <span className="font-semibold">Selected Plan:</span>{' '}
            <span>{selectedPlanPreview?.productName || selectedPlanId}</span>
          </div>
          <span className="inline-flex items-center gap-1 font-semibold text-[#8A6518] shrink-0">
            <span>Resumes after sign in</span>
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </div>
      )}

      {/* Method Switcher */}
      <div
        role="tablist"
        aria-label="Sign in method"
        className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg"
      >
        <button
          type="button"
          role="tab"
          aria-selected={method === 'email'}
          onClick={() => {
            setMethod('email');
            setError(null);
            setStatusMessage(null);
          }}
          className={`inline-flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
            method === 'email' ? 'bg-white text-[#0B1A30] shadow-xs' : 'text-slate-600'
          }`}
        >
          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Email & Password</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={method === 'otp'}
          onClick={() => {
            setMethod('otp');
            setError(null);
            setStatusMessage(null);
          }}
          className={`inline-flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
            method === 'otp' ? 'bg-white text-[#0B1A30] shadow-xs' : 'text-slate-600'
          }`}
        >
          <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Mobile OTP</span>
        </button>
      </div>

      {profileInitializing && !profile && (
        <div
          role="status"
          className="p-3 text-xs sm:text-sm text-[#0B1A30] bg-[#F8F1DE] border border-[#C59B3B]/40 rounded-lg flex items-center gap-2"
        >
          <Loader2 className="h-4 w-4 animate-spin text-[#A37B22] shrink-0" aria-hidden="true" />
          <span>Initializing your Firestore profile for dashboard access...</span>
        </div>
      )}

      {(error || profileInitError) && (
        <div
          role="alert"
          className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg space-y-2"
        >
          <p>{error || profileInitError}</p>
          {profileInitError && firebaseUser && !profile && (
            <button
              type="button"
              onClick={() => void retryProfileInit()}
              className="text-xs font-semibold text-[#0B1A30] underline cursor-pointer"
            >
              Retry profile initialization
            </button>
          )}
        </div>
      )}

      {statusMessage && (
        <div
          role="status"
          className="p-3 text-xs sm:text-sm text-[#0B1A30] bg-[#F8F1DE] border border-[#C59B3B]/40 rounded-lg"
        >
          {statusMessage}
        </div>
      )}

      {method === 'email' ? (
        <form onSubmit={handleEmailSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="login-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Email Address
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={submitting}
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="login-password" className="block text-xs font-semibold text-slate-700">
                Password
              </label>
              <Link
                to={ROUTES.RESET_PASSWORD}
                className="text-xs font-medium text-[#A37B22] hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                disabled={submitting}
                className="w-full px-3.5 py-2.5 pr-10 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-[#0B1A30] cursor-pointer"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 text-sm font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            <span>{submitting ? 'Signing In...' : 'Sign In'}</span>
          </button>
        </form>
      ) : (
        <form onSubmit={handleOtpSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="login-mobile" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Mobile Number (+91)
            </label>
            <div className="flex gap-2">
              <input
                id="login-mobile"
                type="tel"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                placeholder="9876543210"
                disabled={submitting || sendingOtp}
                className="flex-1 px-3.5 py-2.5 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
                required
              />
              <button
                type="button"
                onClick={handleSendOtp}
                disabled={sendingOtp || submitting || cooldownSec > 0}
                className="px-4 py-2.5 text-xs font-semibold text-[#0B1A30] border border-slate-300 hover:bg-slate-50 disabled:opacity-60 rounded-lg whitespace-nowrap cursor-pointer tabular-nums"
              >
                {sendingOtp
                  ? 'Sending...'
                  : cooldownSec > 0
                  ? `Resend (${cooldownSec}s)`
                  : otpSent
                  ? 'Resend OTP'
                  : 'Send OTP'}
              </button>
            </div>
          </div>

          {otpSent && (
            <div>
              <label htmlFor="login-otp" className="block text-xs font-semibold text-slate-700 mb-1.5">
                6-Digit OTP Code
              </label>
              <input
                id="login-otp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                disabled={submitting}
                className="w-full px-3.5 py-2.5 text-sm font-mono tracking-widest tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
                required
              />
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !otpSent}
            className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 text-sm font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            <span>{submitting ? 'Verifying...' : 'Verify & Sign In'}</span>
          </button>
        </form>
      )}

      <div ref={attachRecaptchaContainer} aria-hidden="true" />

      <div className="pt-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
        <span>
          New member?{' '}
          <Link to={registerUrl} className="font-semibold text-[#0B1A30] hover:text-[#A37B22]">
            Create account
          </Link>
        </span>
        <Link to={ROUTES.ADMIN_LOGIN} className="font-medium text-slate-500 hover:text-[#0B1A30]">
          Admin Portal
        </Link>
      </div>
    </AuthShell>
  );
}
