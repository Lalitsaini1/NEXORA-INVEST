import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, ShieldAlert } from 'lucide-react';
import { AuthShell } from '../../components/auth/AuthShell';
import { ROUTES } from '../../config/constants';
import { useAuth } from '../../context/AuthContext';
import { loginAdminWithEmail, mapFirebaseError } from '../../services/authService';
import { validateEmail } from '../../utils/validators';

export function AdminLoginPage() {
  const navigate = useNavigate();
  const { firebaseUser, isAdmin, authReady } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authReady && firebaseUser && isAdmin) {
      navigate(ROUTES.ADMIN_DASHBOARD, { replace: true });
    }
  }, [authReady, firebaseUser, isAdmin, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const emailErr = validateEmail(email);
    if (emailErr) return setError(emailErr);
    if (!password) return setError('Admin password is required.');

    setSubmitting(true);
    try {
      await loginAdminWithEmail(email, password);
      navigate(ROUTES.ADMIN_DASHBOARD, { replace: true });
    } catch (err) {
      setError(mapFirebaseError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      isAdmin
      title="Admin Control Sign In"
      subtitle="Restricted to pre-authorized administrative accounts verified against Firestore."
    >
      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-start gap-2.5 text-xs text-slate-600">
        <ShieldAlert className="h-4 w-4 text-[#A37B22] shrink-0 mt-0.5" aria-hidden="true" />
        <span>
          Standard user accounts cannot self-promote to Admin. Role claims are verified against{' '}
          <code className="font-mono">adminUsers</code> and server-enforced rules.
        </span>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="admin-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
            Authorized Admin Email
          </label>
          <input
            id="admin-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@nexorainvest.example"
            disabled={submitting}
            className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-[#0B1A30]"
            required
          />
        </div>

        <div>
          <label htmlFor="admin-password" className="block text-xs font-semibold text-slate-700 mb-1.5">
            Password
          </label>
          <input
            id="admin-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter admin password"
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
          <span>{submitting ? 'Verifying Admin Access...' : 'Verify Admin Credentials'}</span>
        </button>
      </form>

      <div className="pt-4 border-t border-slate-200 text-xs text-slate-600 text-center">
        Not an administrator?{' '}
        <Link to={ROUTES.LOGIN} className="font-semibold text-[#0B1A30] hover:text-[#A37B22]">
          Go to User Sign In
        </Link>
      </div>
    </AuthShell>
  );
}
