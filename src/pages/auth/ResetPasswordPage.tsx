import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { AuthShell } from '../../components/auth/AuthShell';
import { ROUTES } from '../../config/constants';
import { mapFirebaseError, sendPasswordReset } from '../../services/authService';
import { validateEmail } from '../../utils/validators';

export function ResetPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentToEmail, setSentToEmail] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSentToEmail(null);

    const emailErr = validateEmail(email);
    if (emailErr) {
      return setError(emailErr);
    }

    setSubmitting(true);
    try {
      await sendPasswordReset(email);
      setSentToEmail(email.trim());
    } catch (err) {
      setError(mapFirebaseError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your registered email address to receive a Firebase password recovery link."
    >
      {error && (
        <div
          role="alert"
          className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg"
        >
          {error}
        </div>
      )}

      {sentToEmail && (
        <div
          role="status"
          className="p-3.5 text-xs sm:text-sm text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-2.5"
        >
          <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Password reset link sent to <strong>{sentToEmail}</strong>. Check your inbox and spam
            folder to complete recovery.
          </span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="reset-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
            Registered Email Address
          </label>
          <input
            id="reset-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={submitting}
            className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
            required
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 text-sm font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          <span>{submitting ? 'Sending Reset Link...' : 'Send Recovery Link'}</span>
        </button>
      </form>

      <div className="pt-4 border-t border-slate-200 text-xs text-slate-600 text-center">
        Remember your password?{' '}
        <Link to={ROUTES.LOGIN} className="font-semibold text-[#0B1A30] hover:text-[#A37B22]">
          Back to Sign In
        </Link>
      </div>
    </AuthShell>
  );
}
