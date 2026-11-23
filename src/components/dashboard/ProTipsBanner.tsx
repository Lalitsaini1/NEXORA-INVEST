import { useMemo } from 'react';
import { Lightbulb } from 'lucide-react';

const PRO_TIPS = [
  'Pro Tip: Compare 7-day, 14-day, and 21-day durations in the Profit Projection Calculator before committing coins to a product plan.',
  'Pro Tip: Re-allocating daily earned reward coins promptly into a qualifying active tier maximizes multi-cycle coin accumulation.',
  'Pro Tip: Export your filtered Coin Transaction History to CSV monthly to keep an offline reconciliation ledger of every daily credit.',
  'Pro Tip: Share your permanent Referral Link so every verified member joining through your NX code is tracked automatically.',
  'Pro Tip: Keep both Email Verification and Mobile OTP active to safeguard coin balances and streamline review queues.',
];

const SESSION_TIP_KEY = 'nexora_session_pro_tip_index';

function getSessionTipIndex(): number {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const existing = window.sessionStorage.getItem(SESSION_TIP_KEY);
      if (existing !== null) {
        const parsed = Number.parseInt(existing, 10);
        if (Number.isInteger(parsed) && parsed >= 0 && parsed < PRO_TIPS.length) {
          return parsed;
        }
      }
      const nextIdx = Math.floor(Math.random() * PRO_TIPS.length);
      window.sessionStorage.setItem(SESSION_TIP_KEY, String(nextIdx));
      return nextIdx;
    }
  } catch {
    // Ignore sessionStorage restrictions in sandboxed iframes
  }
  return 0;
}

interface ProTipsBannerProps {
  highContrast?: boolean;
}

export function ProTipsBanner({ highContrast = false }: ProTipsBannerProps) {
  const tipIndex = useMemo(() => getSessionTipIndex(), []);
  const tip = PRO_TIPS[tipIndex] || PRO_TIPS[0];

  return (
    <aside
      aria-label="Member Pro Tip"
      className={`rounded-xl px-4 py-3.5 flex items-start sm:items-center gap-3 ${
        highContrast
          ? 'bg-white border-2 border-slate-900 text-slate-950'
          : 'bg-[#F8F1DE] border border-[#C59B3B]/45 text-[#0B1A30]'
      }`}
    >
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
          highContrast ? 'bg-slate-950 text-white' : 'bg-[#0B1A30] text-[#D8B45A]'
        }`}
      >
        <Lightbulb className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="space-y-0.5">
        <p className="text-[11px] font-bold uppercase tracking-wider text-[#8A6518]">
          Pro Tips · Coin Accumulation Strategy
        </p>
        <p className="text-xs sm:text-sm font-medium leading-relaxed">{tip}</p>
      </div>
    </aside>
  );
}
