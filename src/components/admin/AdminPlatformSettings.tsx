import { useEffect, useState } from 'react';
import { CheckCircle2, Crown, Lock, Settings2 } from 'lucide-react';
import { DEFAULT_BRAND_SETTINGS } from '../../config/constants';
import {
  AdminActorContext,
  savePlatformSettings,
  subscribePlatformSettings,
} from '../../services/adminService';
import { PlatformSettingsRecord } from '../../types/domain';
import { formatDateTimeInr } from '../../utils/formatters';
import { canEditPlatformSettings } from '../../utils/rbac';

interface AdminPlatformSettingsProps {
  actor: AdminActorContext;
}

export function AdminPlatformSettings({ actor }: AdminPlatformSettingsProps) {
  const [settings, setSettings] = useState<PlatformSettingsRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [payoutsEnabled, setPayoutsEnabled] = useState(false);
  const [registrationsEnabled, setRegistrationsEnabled] = useState(true);
  const [upiDepositsEnabled, setUpiDepositsEnabled] = useState(true);
  const [legalComplianceVerified, setLegalComplianceVerified] = useState(false);
  const [paymentProviderComplianceVerified, setPaymentProviderComplianceVerified] = useState(false);
  const [realMoneyInvestmentsEnabled, setRealMoneyInvestmentsEnabled] = useState(false);
  const [complianceStatusNote, setComplianceStatusNote] = useState('');
  const [minDepositInr, setMinDepositInr] = useState('100');
  const [maxDepositInr, setMaxDepositInr] = useState('500000');
  const [coinPackagesCsv, setCoinPackagesCsv] = useState('100,500,1000,2500,5000,10000');
  const [supportEmail, setSupportEmail] = useState(DEFAULT_BRAND_SETTINGS.supportEmail);
  const [supportPhone, setSupportPhone] = useState(DEFAULT_BRAND_SETTINGS.supportPhone);
  const [securityNotice, setSecurityNotice] = useState('');

  const editable = canEditPlatformSettings(actor.role);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribePlatformSettings(
      (rec) => {
        setSettings(rec);
        if (rec) {
          setPayoutsEnabled(rec.payoutsEnabled);
          setRegistrationsEnabled(rec.registrationsEnabled);
          setUpiDepositsEnabled(rec.upiDepositsEnabled !== false);
          setLegalComplianceVerified(Boolean(rec.legalComplianceVerified));
          setPaymentProviderComplianceVerified(Boolean(rec.paymentProviderComplianceVerified));
          setRealMoneyInvestmentsEnabled(Boolean(rec.realMoneyInvestmentsEnabled));
          setComplianceStatusNote(rec.complianceStatusNote || '');
          setMinDepositInr(String(rec.minDepositInr ?? 100));
          setMaxDepositInr(String(rec.maxDepositInr ?? 500000));
          setCoinPackagesCsv(rec.coinPackagesCsv || '100,500,1000,2500,5000,10000');
          setSupportEmail(rec.supportEmail);
          setSupportPhone(rec.supportPhone);
          setSecurityNotice(rec.securityNotice || '');
        }
        setLoading(false);
        setErrorMsg(null);
      },
      (msg) => {
        setErrorMsg(msg);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  const bothComplianceChecksComplete =
    legalComplianceVerified && paymentProviderComplianceVerified;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editable) return;
    setErrorMsg(null);
    setNoticeMsg(null);
    setSaving(true);
    try {
      await savePlatformSettings({
        actor,
        payoutsEnabled,
        registrationsEnabled,
        upiDepositsEnabled,
        legalComplianceVerified,
        paymentProviderComplianceVerified,
        realMoneyInvestmentsEnabled: bothComplianceChecksComplete
          ? realMoneyInvestmentsEnabled
          : false,
        complianceStatusNote,
        minDepositInr: Number.parseInt(minDepositInr, 10) || 100,
        maxDepositInr: Number.parseInt(maxDepositInr, 10) || 500000,
        coinPackagesCsv,
        supportEmail,
        supportPhone,
        securityNotice,
        requireEmailVerification: settings?.requireEmailVerification,
        enforceAdminMfaOrOtp: settings?.enforceAdminMfaOrOtp,
        sessionTimeoutMinutes: settings?.sessionTimeoutMinutes,
        maxAdminLoginAttempts: settings?.maxAdminLoginAttempts,
        auditLogRetentionDays: settings?.auditLogRetentionDays,
      });
      setNoticeMsg('Master platform, compliance gate, and UPI gateway configuration saved.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save platform settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-labelledby="platform-settings-heading"
      className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div className="space-y-1">
          <h2
            id="platform-settings-heading"
            className="font-display text-lg font-bold text-[#0B1A30] flex items-center gap-2"
          >
            <Settings2 className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
            <span>Website Configuration &amp; Master Security Settings</span>
          </h2>
          <p className="text-xs text-slate-500">
            Master toggles governing legal &amp; payment compliance gates, payout eligibility, and
            customer support contact channels.
          </p>
        </div>

        {editable ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold bg-[#F8F1DE] text-[#8A6518] border border-[#C59B3B]">
            <Crown className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Super Admin Master Control</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-300">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Read-Only (Super Admin Restricted)</span>
          </span>
        )}
      </div>

      {!editable && (
        <div className="p-3.5 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-2">
          <Lock className="h-4 w-4 text-slate-500 shrink-0" aria-hidden="true" />
          <span>
            Master website security settings are enforced by Firestore Rules for the Super Admin
            only. Lower-tier Admin accounts have read-only visibility.
          </span>
        </div>
      )}

      {errorMsg && (
        <div role="alert" className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
          {errorMsg}
        </div>
      )}
      {noticeMsg && (
        <div role="status" className="p-3 text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" aria-hidden="true" />
          <span>{noticeMsg}</span>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-slate-500">Loading platform settings...</p>
      ) : (
        <form onSubmit={handleSave} className="space-y-4">
          {/* Real-Money Compliance Gate */}
          <div className="p-4 bg-[#0B1A30] text-white rounded-xl space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#D8B45A]">
                  Real-Money Investment Compliance Gate
                </p>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  Real-money plan enrollments stay blocked on both frontend and Firestore/Cloud
                  Functions until both compliance checks below are verified.
                </p>
              </div>
              <span
                className={`px-2.5 py-1 rounded text-[11px] font-semibold ${
                  bothComplianceChecksComplete && realMoneyInvestmentsEnabled
                    ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/40'
                    : 'bg-amber-500/20 text-amber-200 border border-amber-400/40'
                }`}
              >
                {bothComplianceChecksComplete && realMoneyInvestmentsEnabled
                  ? 'LIVE INVESTMENTS ENABLED'
                  : 'COMPLIANCE HOLD ACTIVE'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="flex items-start gap-2.5 p-3 bg-white/5 border border-white/15 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  disabled={!editable}
                  checked={legalComplianceVerified}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setLegalComplianceVerified(checked);
                    if (!checked) setRealMoneyInvestmentsEnabled(false);
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-slate-400"
                />
                <div>
                  <p className="text-xs font-semibold text-white">Legal &amp; Regulatory Verified</p>
                  <p className="text-[11px] text-slate-300 mt-0.5">
                    Terms, risk disclosures, and jurisdiction filings completed.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-3 bg-white/5 border border-white/15 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  disabled={!editable}
                  checked={paymentProviderComplianceVerified}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setPaymentProviderComplianceVerified(checked);
                    if (!checked) setRealMoneyInvestmentsEnabled(false);
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-slate-400"
                />
                <div>
                  <p className="text-xs font-semibold text-white">Payment Provider Verified</p>
                  <p className="text-[11px] text-slate-300 mt-0.5">
                    Merchant KYC, webhook settlement, and escrow/reconciliation active.
                  </p>
                </div>
              </label>

              <label
                className={`flex items-start gap-2.5 p-3 rounded-lg border ${
                  bothComplianceChecksComplete
                    ? 'bg-white/10 border-[#D8B45A]/50 cursor-pointer'
                    : 'bg-white/5 border-white/10 opacity-60 cursor-not-allowed'
                }`}
              >
                <input
                  type="checkbox"
                  disabled={!editable || !bothComplianceChecksComplete}
                  checked={bothComplianceChecksComplete && realMoneyInvestmentsEnabled}
                  onChange={(e) => setRealMoneyInvestmentsEnabled(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-400"
                />
                <div>
                  <p className="text-xs font-semibold text-[#D8B45A]">
                    Accept Real-Money Investments
                  </p>
                  <p className="text-[11px] text-slate-300 mt-0.5">
                    Requires both compliance checks above to be verified first.
                  </p>
                </div>
              </label>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-200 mb-1">
                Compliance Audit Reference / Note (Optional)
              </label>
              <input
                type="text"
                disabled={!editable}
                value={complianceStatusNote}
                onChange={(e) => setComplianceStatusNote(e.target.value)}
                placeholder="e.g. Awaiting RBI/PSP merchant onboarding reference"
                className="w-full px-3 py-2 text-xs text-[#0B1A30] bg-white disabled:bg-slate-200 rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex items-start gap-3 p-4 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                disabled={!editable}
                checked={payoutsEnabled}
                onChange={(e) => setPayoutsEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <div>
                <p className="text-xs font-bold text-[#0B1A30]">Enable Real-Money Withdrawals</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Controls whether verified member withdrawal requests can be submitted.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 p-4 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                disabled={!editable}
                checked={registrationsEnabled}
                onChange={(e) => setRegistrationsEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <div>
                <p className="text-xs font-bold text-[#0B1A30]">Allow New Member Registrations</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Controls onboarding across Email &amp; Mobile OTP registration forms.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 p-4 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer md:col-span-2">
              <input
                type="checkbox"
                disabled={!editable}
                checked={upiDepositsEnabled}
                onChange={(e) => setUpiDepositsEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <div>
                <p className="text-xs font-bold text-[#0B1A30]">Enable UPI Coin Deposits Gateway</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Controls whether verified members can initiate new Add Coins orders through active
                  UPI endpoints.
                </p>
              </div>
            </label>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Min Deposit INR
              </label>
              <input
                type="number"
                min={100}
                max={100000}
                required
                disabled={!editable}
                value={minDepositInr}
                onChange={(e) => setMinDepositInr(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Max Deposit INR
              </label>
              <input
                type="number"
                min={100}
                max={500000}
                required
                disabled={!editable}
                value={maxDepositInr}
                onChange={(e) => setMaxDepositInr(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                UPI Coin Package Presets (Comma-separated INR / Coin values, up to 8)
              </label>
              <input
                type="text"
                required
                disabled={!editable}
                value={coinPackagesCsv}
                onChange={(e) => setCoinPackagesCsv(e.target.value)}
                placeholder="100,500,1000,2500,5000,10000"
                className="w-full px-3 py-2 text-xs font-mono bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Official Support Email
              </label>
              <input
                type="email"
                required
                disabled={!editable}
                value={supportEmail}
                onChange={(e) => setSupportEmail(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Official Support Phone
              </label>
              <input
                type="text"
                required
                disabled={!editable}
                value={supportPhone}
                onChange={(e) => setSupportPhone(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Global Security Notice (Optional)
            </label>
            <input
              type="text"
              disabled={!editable}
              value={securityNotice}
              onChange={(e) => setSecurityNotice(e.target.value)}
              placeholder="e.g. Scheduled ledger reconciliation window on Sunday 02:00 IST"
              className="w-full px-3 py-2 text-xs bg-white disabled:bg-slate-100 border border-slate-300 rounded-lg"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <p className="text-[11px] text-slate-500 font-mono">
              {settings?.updatedAt
                ? `Last updated ${formatDateTimeInr(settings.updatedAt)} by ${settings.updatedByUid}`
                : 'Using default baseline settings'}
            </p>
            {editable && (
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] disabled:opacity-60 rounded-lg cursor-pointer self-start sm:self-auto"
              >
                {saving ? 'Saving Configuration...' : 'Save Master Settings'}
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
