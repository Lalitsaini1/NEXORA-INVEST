import { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Crown,
  KeyRound,
  Lock,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { DEFAULT_BRAND_SETTINGS } from '../../config/constants';
import {
  AdminActorContext,
  savePlatformSettings,
  subscribeAdminLoginAttempts,
  subscribePlatformSettings,
} from '../../services/adminService';
import { AdminLoginAttemptRecord, PlatformSettingsRecord } from '../../types/domain';
import { formatDateTimeInr } from '../../utils/formatters';
import { canEditPlatformSettings } from '../../utils/rbac';

interface SecurityConfigProps {
  actor: AdminActorContext;
}

const RETENTION_OPTIONS = [
  { days: 30, label: '30 Days (Minimum Compliance)' },
  { days: 90, label: '90 Days (Standard Quarterly)' },
  { days: 180, label: '180 Days (6 Months)' },
  { days: 365, label: '365 Days (1 Year Recommended)' },
  { days: 730, label: '730 Days (2 Years Extended)' },
];

export function SecurityConfig({ actor }: SecurityConfigProps) {
  const [settings, setSettings] = useState<PlatformSettingsRecord | null>(null);
  const [loginAttempts, setLoginAttempts] = useState<AdminLoginAttemptRecord[]>([]);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [loadingAttempts, setLoadingAttempts] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // System-wide authentication & retention policy state
  const [requireEmailVerification, setRequireEmailVerification] = useState(true);
  const [enforceAdminMfaOrOtp, setEnforceAdminMfaOrOtp] = useState(false);
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState('60');
  const [maxAdminLoginAttempts, setMaxAdminLoginAttempts] = useState('5');
  const [auditLogRetentionDays, setAuditLogRetentionDays] = useState('365');

  const isSuperAdmin = canEditPlatformSettings(actor.role);

  useEffect(() => {
    setLoadingSettings(true);
    const unsubSettings = subscribePlatformSettings(
      (rec) => {
        setSettings(rec);
        if (rec) {
          setRequireEmailVerification(rec.requireEmailVerification ?? true);
          setEnforceAdminMfaOrOtp(rec.enforceAdminMfaOrOtp ?? false);
          setSessionTimeoutMinutes(String(rec.sessionTimeoutMinutes ?? 60));
          setMaxAdminLoginAttempts(String(rec.maxAdminLoginAttempts ?? 5));
          setAuditLogRetentionDays(String(rec.auditLogRetentionDays ?? 365));
        }
        setLoadingSettings(false);
      },
      (msg) => {
        setErrorMsg(msg);
        setLoadingSettings(false);
      }
    );

    setLoadingAttempts(true);
    const unsubAttempts = subscribeAdminLoginAttempts(
      (items) => {
        setLoginAttempts(items);
        setLoadingAttempts(false);
      },
      (msg) => {
        setErrorMsg(msg);
        setLoadingAttempts(false);
      }
    );

    return () => {
      unsubSettings();
      unsubAttempts();
    };
  }, []);

  const handleSavePolicies = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) return;
    setErrorMsg(null);
    setNoticeMsg(null);
    setSaving(true);
    try {
      await savePlatformSettings({
        actor,
        payoutsEnabled: settings?.payoutsEnabled ?? false,
        registrationsEnabled: settings?.registrationsEnabled ?? true,
        supportEmail: settings?.supportEmail ?? DEFAULT_BRAND_SETTINGS.supportEmail,
        supportPhone: settings?.supportPhone ?? DEFAULT_BRAND_SETTINGS.supportPhone,
        securityNotice: settings?.securityNotice ?? '',
        requireEmailVerification,
        enforceAdminMfaOrOtp,
        sessionTimeoutMinutes: Number.parseInt(sessionTimeoutMinutes, 10) || 60,
        maxAdminLoginAttempts: Number.parseInt(maxAdminLoginAttempts, 10) || 5,
        auditLogRetentionDays: Number.parseInt(auditLogRetentionDays, 10) || 365,
        upiDepositsEnabled: settings?.upiDepositsEnabled,
        minDepositInr: settings?.minDepositInr,
        maxDepositInr: settings?.maxDepositInr,
        coinPackagesCsv: settings?.coinPackagesCsv,
      });
      setNoticeMsg('Authentication policies and audit log retention settings saved.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to update security config.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Authentication & Audit Retention Configuration */}
      <section
        aria-labelledby="security-config-heading"
        className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div className="space-y-1">
            <h2
              id="security-config-heading"
              className="font-display text-lg font-bold text-[#0B1A30] flex items-center gap-2"
            >
              <KeyRound className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
              <span>Security Config · Authentication &amp; Retention Policies</span>
            </h2>
            <p className="text-xs text-slate-500">
              System-wide authentication safeguards, admin session timeouts, and compliance audit
              log retention policies.
            </p>
          </div>

          {isSuperAdmin ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold bg-[#F8F1DE] text-[#8A6518] border border-[#C59B3B] self-start">
              <Crown className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Super Admin Exclusive</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-300 self-start">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Read-Only (Super Admin Only)</span>
            </span>
          )}
        </div>

        {!isSuperAdmin && (
          <div className="p-3.5 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-2">
            <Lock className="h-4 w-4 text-slate-500 shrink-0" aria-hidden="true" />
            <span>
              Lower-tier Admin accounts cannot alter Super Admin authentication thresholds or
              audit retention policies (enforced by Firestore Security Rules).
            </span>
          </div>
        )}

        {errorMsg && (
          <div role="alert" className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}
        {noticeMsg && (
          <div role="status" className="p-3 text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" aria-hidden="true" />
            <span>{noticeMsg}</span>
          </div>
        )}

        {loadingSettings ? (
          <p className="text-xs text-slate-500">Loading security policy configuration...</p>
        ) : (
          <form onSubmit={handleSavePolicies} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="flex items-start gap-3 p-4 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  disabled={!isSuperAdmin}
                  checked={requireEmailVerification}
                  onChange={(e) => setRequireEmailVerification(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                />
                <div>
                  <p className="text-xs font-bold text-[#0B1A30]">
                    Mandate Verified Email Claims
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Requires verified email status before privileged operations and payouts.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 p-4 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  disabled={!isSuperAdmin}
                  checked={enforceAdminMfaOrOtp}
                  onChange={(e) => setEnforceAdminMfaOrOtp(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300"
                />
                <div>
                  <p className="text-xs font-bold text-[#0B1A30]">
                    Enforce Secondary OTP / MFA Verification for Admins
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Flags admin accounts requiring step-up verification on privileged reviews.
                  </p>
                </div>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Admin Session Timeout (Minutes)
                </label>
                <input
                  type="number"
                  min={15}
                  max={1440}
                  disabled={!isSuperAdmin}
                  value={sessionTimeoutMinutes}
                  onChange={(e) => setSessionTimeoutMinutes(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Max Admin Login Attempts Before Alert
                </label>
                <input
                  type="number"
                  min={3}
                  max={20}
                  disabled={!isSuperAdmin}
                  value={maxAdminLoginAttempts}
                  onChange={(e) => setMaxAdminLoginAttempts(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Audit Log Retention Policy
                </label>
                <select
                  aria-label="Audit log retention policy"
                  disabled={!isSuperAdmin}
                  value={auditLogRetentionDays}
                  onChange={(e) => setAuditLogRetentionDays(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-semibold text-[#0B1A30] bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg cursor-pointer"
                >
                  {RETENTION_OPTIONS.map((opt) => (
                    <option key={opt.days} value={String(opt.days)}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {isSuperAdmin && (
              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  {saving ? 'Saving Security Policies...' : 'Save Security & Retention Policies'}
                </button>
              </div>
            )}
          </form>
        )}
      </section>

      {/* Real-Time Admin Portal Login Attempts Monitor */}
      <section
        aria-labelledby="admin-login-monitor-heading"
        className="bg-white border border-slate-200 rounded-xl overflow-hidden"
      >
        <div className="p-5 sm:p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <h3
              id="admin-login-monitor-heading"
              className="font-display text-base font-bold text-[#0B1A30] flex items-center gap-2"
            >
              <Activity className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
              <span>Real-Time Admin Portal Login Monitor</span>
            </h3>
            <p className="text-xs text-slate-500">
              Live Firestore stream tracking authorized admin sign-ins and rejected privilege
              escalation attempts.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 self-start">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Live Telemetry Active</span>
          </span>
        </div>

        {loadingAttempts ? (
          <div className="p-6 text-xs text-slate-500">Connecting to real-time login feed...</div>
        ) : loginAttempts.length === 0 ? (
          <div className="p-6 text-xs text-slate-500">
            No Admin Portal login attempts recorded yet. Subsequent sign-ins will stream here
            automatically.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[660px] border-collapse text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th scope="col" className="py-3 px-5 whitespace-nowrap">
                    Timestamp
                  </th>
                  <th scope="col" className="py-3 px-4">
                    Email &amp; UID
                  </th>
                  <th scope="col" className="py-3 px-4 whitespace-nowrap">
                    Resolved Role
                  </th>
                  <th scope="col" className="py-3 px-5 text-right whitespace-nowrap">
                    Outcome
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {loginAttempts.slice(0, 25).map((att) => (
                  <tr key={att.attemptId} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-5 font-mono text-slate-600 whitespace-nowrap">
                      {formatDateTimeInr(att.timestamp)}
                    </td>
                    <td className="py-2.5 px-4">
                      <p className="font-semibold text-[#0B1A30]">{att.email || 'Unknown'}</p>
                      <p className="text-[11px] font-mono text-slate-500">{att.uid}</p>
                    </td>
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-700 whitespace-nowrap">
                      {att.role}
                    </td>
                    <td className="py-2.5 px-5 text-right whitespace-nowrap">
                      {att.outcome === 'SUCCESS' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700">
                          Authorized Sign-In
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-red-50 text-red-700">
                          Denied (Non-Admin)
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
