import { useEffect, useState } from 'react';
import { Check, Copy, Link2, Users } from 'lucide-react';
import { ROUTES } from '../../config/constants';
import {
  ensureReferralCodeRegistered,
  subscribeUserReferrals,
} from '../../services/activityLogService';
import { ReferralRecord } from '../../types/domain';
import { formatDateTimeInr } from '../../utils/formatters';

interface ReferralSectionProps {
  uid: string;
  userId?: string;
  highContrast?: boolean;
}

export function ReferralSection({
  uid,
  userId,
  highContrast = false,
}: ReferralSectionProps) {
  const [referrals, setReferrals] = useState<ReferralRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const referralCode = userId && /^NX[0-9]{6,10}$/.test(userId) ? userId : '';
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://nexorainvest.app';
  const referralUrl = referralCode
    ? `${origin}${ROUTES.REGISTER}?ref=${encodeURIComponent(referralCode)}`
    : '';

  useEffect(() => {
    if (!uid || !referralCode) return;
    void ensureReferralCodeRegistered(uid, referralCode);
  }, [uid, referralCode]);

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    const unsub = subscribeUserReferrals(
      uid,
      (items) => {
        setReferrals(items);
        setLoading(false);
        setErrorMsg(null);
      },
      (msg) => {
        setErrorMsg(msg);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [uid]);

  const handleCopy = async () => {
    if (!referralUrl) return;
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      // Clipboard fallback unavailable
    }
  };

  return (
    <section
      aria-labelledby="referral-section-heading"
      className={`bg-white rounded-xl p-5 sm:p-6 space-y-5 ${
        highContrast ? 'border-2 border-slate-900' : 'border border-slate-200'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2
            id="referral-section-heading"
            className="font-display text-lg font-bold text-[#0B1A30] flex items-center gap-2"
          >
            <Users className="h-4 w-4 text-[#A37B22]" aria-hidden="true" />
            <span>Referral Program &amp; Invitations</span>
          </h2>
          <p className="text-xs text-slate-600">
            Share your unique NEXORA invite link. Verified sign-ups via your link are permanently
            attributed in Firestore.
          </p>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-right shrink-0">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            Successful Sign-ups
          </p>
          <p className="font-mono text-2xl font-bold text-[#0B1A30] tabular-nums">
            {loading ? '—' : referrals.length}
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
        <div className="flex-1 flex items-center gap-2 px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-lg min-w-0">
          <Link2 className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
          <input
            type="text"
            readOnly
            value={referralUrl || 'Generating permanent referral link...'}
            aria-label="Your unique referral link"
            className="w-full bg-transparent text-xs font-mono text-slate-800 focus:outline-none truncate"
          />
        </div>

        <button
          type="button"
          onClick={handleCopy}
          disabled={!referralUrl}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-[#0B1A30] hover:bg-[#13284A] disabled:opacity-50 rounded-lg whitespace-nowrap cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-[#D8B45A]" aria-hidden="true" />
              <span>Copied Link</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Copy Referral Link</span>
            </>
          )}
        </button>
      </div>

      {errorMsg && (
        <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {errorMsg}
        </p>
      )}

      {!loading && !errorMsg && (
        <div className="border-t border-slate-100 pt-3">
          {referrals.length === 0 ? (
            <p className="text-xs text-slate-500">
              No referral sign-ups recorded yet. Copy your referral link above to invite new
              members.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-600">Recent Referred Members</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {referrals.slice(0, 6).map((refItem) => (
                  <div
                    key={refItem.referralId}
                    className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="font-mono font-semibold text-[#0B1A30]">
                      {refItem.referredUserId}
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                      {formatDateTimeInr(refItem.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
