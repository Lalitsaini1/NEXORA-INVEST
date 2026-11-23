import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { AuthShell } from '../../components/auth/AuthShell';
import { ROUTES } from '../../config/constants';
import { useAuth } from '../../context/AuthContext';
import { usePhoneOtp } from '../../hooks/usePhoneOtp';
import {
  completePhoneOtpRegistration,
  mapFirebaseError,
  registerWithEmailPassword,
  sendPhoneOtp,
} from '../../services/authService';
import { UserProfile } from '../../types/domain';
import {
  validateEmail,
  validateFullName,
  validateIndianMobile,
  validateOtpCode,
  validatePassword,
} from '../../utils/validators';

type RegisterMethod = 'email' | 'phone';

export function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const referralCodeParam = searchParams.get('ref')?.trim().toUpperCase() || '';
  const { firebaseUser, profile: activeProfile, authReady } = useAuth();

  const [method, setMethod] = useState<RegisterMethod>('email');

  // Shared fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  // Email/password fields
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Phone OTP fields managed by single-instance reCAPTCHA lifecycle hook
  const [otpCode, setOtpCode] = useState('');
  const [otpStatus, setOtpStatus] = useState<string | null>(null);
  const {
    attachRecaptchaContainer,
    sendingOtp,
    otpSent,
    cooldownSec,
    confirmationResult,
    sendOtpWithVerifier,
    resetOtpFlow,
  } = usePhoneOtp({ cooldownSeconds: 30 });

  // Submission & result states
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedProfile, setConfirmedProfile] = useState<UserProfile | null>(null);
  const [existingAccountNotice, setExistingAccountNotice] = useState(false);

  // If user is already logged in with a Firestore profile and didn't just complete registration here
  useEffect(() => {
    if (authReady && firebaseUser && activeProfile && !confirmedProfile) {
      navigate(ROUTES.USER_DASHBOARD, { replace: true });
    }
  }, [authReady, firebaseUser, activeProfile, confirmedProfile, navigate]);

  const handleEmailRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const nameErr = validateFullName(fullName);
    if (nameErr) return setError(nameErr);
    const emailErr = validateEmail(email);
    if (emailErr) return setError(emailErr);
    const mobileErr = validateIndianMobile(mobile);
    if (mobileErr) return setError(mobileErr);
    const passErr = validatePassword(password);
    if (passErr) return setError(passErr);
    if (password !== confirmPassword) {
      return setError('Passwords do not match.');
    }
    if (!acceptedTerms) {
      return setError('You must accept the Terms & Conditions and Risk Disclosures.');
    }

    setSubmitting(true);
    try {
      const { profile } = await registerWithEmailPassword({
        fullName,
        email,
        mobile,
        password,
        referralCode: referralCodeParam || undefined,
      });
      setExistingAccountNotice(false);
      setConfirmedProfile(profile);
    } catch (err) {
      setError(mapFirebaseError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendPhoneOtp = async () => {
    if (sendingOtp || cooldownSec > 0) return;
    setError(null);
    setOtpStatus(null);

    const nameErr = validateFullName(fullName);
    if (nameErr) return setError(nameErr);
    const mobileErr = validateIndianMobile(mobile);
    if (mobileErr) return setError(mobileErr);
    if (email.trim()) {
      const emailErr = validateEmail(email);
      if (emailErr) return setError(emailErr);
    }
    if (!acceptedTerms) {
      return setError('You must accept the Terms & Conditions and Risk Disclosures.');
    }

    const res = await sendOtpWithVerifier(
      (verifier) => sendPhoneOtp(mobile, verifier),
      { isResend: otpSent }
    );
    if (res.dispatched) {
      setOtpCode('');
      setOtpStatus('6-digit OTP verification code sent to your mobile number.');
    } else if (res.error) {
      setError(res.error);
    }
  };

  const handleVerifyPhoneRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (!confirmationResult) {
      return setError('Request an OTP verification code first.');
    }
    const otpErr = validateOtpCode(otpCode);
    if (otpErr) return setError(otpErr);

    setSubmitting(true);
    try {
      const { profile, alreadyRegistered } = await completePhoneOtpRegistration({
        confirmationResult,
        otpCode,
        fullName,
        email,
        referralCode: referralCodeParam || undefined,
      });
      resetOtpFlow();
      setExistingAccountNotice(alreadyRegistered);
      setConfirmedProfile(profile);
    } catch (err) {
      setError(mapFirebaseError(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (confirmedProfile) {
    return (
      <AuthShell
        title={existingAccountNotice ? 'Account Already Registered' : 'Registration Confirmed'}
        subtitle="Your Firebase authentication and Firestore account profile are active."
      >
        <div className="space-y-5">
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-1 text-sm text-emerald-900">
              <p className="font-semibold">
                {existingAccountNotice
                  ? 'Welcome back — this mobile number is already linked to an active profile.'
                  : 'Your account has been created and secured.'}
              </p>
              <p className="text-xs text-emerald-800">
                {confirmedProfile.authProvider === 'password'
                  ? 'A verification link has been sent to your email address. Please verify your email and complete mobile OTP verification in your dashboard.'
                  : 'Your mobile number is verified via Firebase Phone Authentication.'}
              </p>
            </div>
          </div>

          <div className="p-5 bg-[#0B1A30] text-white rounded-xl space-y-3 border border-[#1D3A68]">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-[#D8B45A] font-semibold">
                Permanent NX User ID
              </span>
              <ShieldCheck className="h-4 w-4 text-[#C59B3B]" aria-hidden="true" />
            </div>
            <p className="font-mono text-2xl font-bold tracking-wider tabular-nums text-white">
              {confirmedProfile.userId}
            </p>
            <div className="pt-2 border-t border-white/10 text-xs text-slate-300 space-y-1">
              <p>Member: {confirmedProfile.fullName}</p>
              {confirmedProfile.email && <p>Email: {confirmedProfile.email}</p>}
              {confirmedProfile.mobile && (
                <p className="font-mono tabular-nums">Mobile: {confirmedProfile.mobile}</p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate(ROUTES.USER_DASHBOARD)}
            className="w-full py-3 px-4 text-sm font-semibold text-[#0B1A30] bg-[#C59B3B] hover:bg-[#D8B45A] rounded-lg transition-colors cursor-pointer"
          >
            Continue to Member Dashboard
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Permanent NX User IDs (e.g. NX100001) are assigned automatically after authentication succeeds."
    >
      {/* Registration Method Switcher */}
      <div
        role="tablist"
        aria-label="Registration method"
        className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg"
      >
        <button
          type="button"
          role="tab"
          aria-selected={method === 'email'}
          onClick={() => {
            setMethod('email');
            setError(null);
            setOtpStatus(null);
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
          aria-selected={method === 'phone'}
          onClick={() => {
            setMethod('phone');
            setError(null);
            setOtpStatus(null);
          }}
          className={`inline-flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
            method === 'phone' ? 'bg-white text-[#0B1A30] shadow-xs' : 'text-slate-600'
          }`}
        >
          <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Mobile OTP</span>
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg"
        >
          {error}
        </div>
      )}

      {otpStatus && (
        <div
          role="status"
          className="p-3 text-xs sm:text-sm text-[#0B1A30] bg-[#F8F1DE] border border-[#C59B3B]/40 rounded-lg"
        >
          {otpStatus}
        </div>
      )}

      {method === 'email' ? (
        <form onSubmit={handleEmailRegister} className="space-y-4" noValidate>
          <div>
            <label htmlFor="reg-name" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Full Name
            </label>
            <input
              id="reg-name"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Aarav Sharma"
              disabled={submitting}
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
              required
            />
          </div>

          <div>
            <label htmlFor="reg-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Email Address
            </label>
            <input
              id="reg-email"
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
            <label htmlFor="reg-mobile" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Mobile Number (+91)
            </label>
            <input
              id="reg-mobile"
              type="tel"
              autoComplete="tel"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="9876543210"
              disabled={submitting}
              className="w-full px-3.5 py-2.5 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="reg-password" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  id="reg-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 8 chars"
                  disabled={submitting}
                  className="w-full px-3.5 py-2.5 pr-9 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-[#0B1A30] cursor-pointer"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="reg-confirm" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Confirm Password
              </label>
              <input
                id="reg-confirm"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                disabled={submitting}
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
                required
              />
            </div>
          </div>

          <label className="flex items-start gap-2.5 text-xs text-slate-600 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              disabled={submitting}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#0B1A30] focus:ring-[#C59B3B]"
            />
            <span>
              I agree to the{' '}
              <Link to={ROUTES.TERMS} className="text-[#0B1A30] font-semibold underline">
                Terms & Conditions
              </Link>
              ,{' '}
              <Link to={ROUTES.PRIVACY} className="text-[#0B1A30] font-semibold underline">
                Privacy Policy
              </Link>
              , and{' '}
              <Link to={ROUTES.DISCLOSURES} className="text-[#0B1A30] font-semibold underline">
                Risk Disclosures
              </Link>
              .
            </span>
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 text-sm font-semibold text-[#0B1A30] bg-[#C59B3B] hover:bg-[#D8B45A] disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            <span>{submitting ? 'Creating Account...' : 'Register Account'}</span>
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyPhoneRegister} className="space-y-4" noValidate>
          <div>
            <label htmlFor="reg-otp-name" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Full Name
            </label>
            <input
              id="reg-otp-name"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Aarav Sharma"
              disabled={submitting || otpSent}
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
              required
            />
          </div>

          <div>
            <label htmlFor="reg-otp-mobile" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Mobile Number (+91)
            </label>
            <div className="flex gap-2">
              <input
                id="reg-otp-mobile"
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
                onClick={handleSendPhoneOtp}
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

          <div>
            <label htmlFor="reg-otp-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
              Email Address (Optional)
            </label>
            <input
              id="reg-otp-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={submitting || otpSent}
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
            />
          </div>

          {otpSent && (
            <div>
              <label htmlFor="reg-otp-code" className="block text-xs font-semibold text-slate-700 mb-1.5">
                6-Digit SMS OTP Code
              </label>
              <input
                id="reg-otp-code"
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

          <label className="flex items-start gap-2.5 text-xs text-slate-600 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              disabled={submitting}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#0B1A30] focus:ring-[#C59B3B]"
            />
            <span>
              I agree to the{' '}
              <Link to={ROUTES.TERMS} className="text-[#0B1A30] font-semibold underline">
                Terms & Conditions
              </Link>
              ,{' '}
              <Link to={ROUTES.PRIVACY} className="text-[#0B1A30] font-semibold underline">
                Privacy Policy
              </Link>
              , and{' '}
              <Link to={ROUTES.DISCLOSURES} className="text-[#0B1A30] font-semibold underline">
                Risk Disclosures
              </Link>
              .
            </span>
          </label>

          <button
            type="submit"
            disabled={submitting || !otpSent}
            className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 text-sm font-semibold text-[#0B1A30] bg-[#C59B3B] hover:bg-[#D8B45A] disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            <span>{submitting ? 'Verifying OTP...' : 'Verify OTP & Register'}</span>
          </button>
        </form>
      )}

      <div ref={attachRecaptchaContainer} aria-hidden="true" />

      <div className="pt-4 border-t border-slate-200 text-xs text-slate-600 text-center">
        Already registered?{' '}
        <Link to={ROUTES.LOGIN} className="font-semibold text-[#0B1A30] hover:text-[#A37B22]">
          Sign in instead
        </Link>
      </div>
    </AuthShell>
  );
}
