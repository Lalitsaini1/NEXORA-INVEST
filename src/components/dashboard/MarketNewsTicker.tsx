import { useState } from 'react';
import { Newspaper, Pause, Play } from 'lucide-react';

const MARKET_NEWS_UPDATES = [
  'Platform Rate Standard: 1 INR = 1 Virtual Coin across all active NEXORA product tiers.',
  'Ledger Integrity: All daily plan reward credits and coin allocations are recorded atomically in Firestore.',
  'Security Notice: Enable both Email Verification and Mobile OTP for reinforced account protection.',
  'Product Plans Update: Fixed-duration hardware & industrial asset plans distribute daily coin schedules without rounding drift.',
  'Transparency Brief: Review your 30-day coin balance curve and Profit Projection Calculator anytime inside your dashboard.',
];

interface MarketNewsTickerProps {
  highContrast?: boolean;
}

export function MarketNewsTicker({ highContrast = false }: MarketNewsTickerProps) {
  const [paused, setPaused] = useState(false);

  return (
    <div
      role="region"
      aria-label="Market News Updates"
      className={`border-b ${
        highContrast
          ? 'bg-white border-slate-900 text-slate-950'
          : 'bg-[#06101E] border-[#1D3A68] text-slate-100'
      }`}
    >
      <div className="mx-auto max-w-5xl px-4 sm:px-6 h-10 flex items-center gap-3">
        <div
          className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider shrink-0 px-2 py-0.5 rounded ${
            highContrast
              ? 'bg-slate-950 text-white'
              : 'bg-[#C59B3B]/15 text-[#D8B45A] border border-[#C59B3B]/35'
          }`}
        >
          <Newspaper className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Market News</span>
        </div>

        <div className="relative flex-1 overflow-hidden">
          {paused ? (
            <p className="text-xs truncate">
              {MARKET_NEWS_UPDATES.join('  ·  ')}
            </p>
          ) : (
            <div className="animate-nexora-marquee flex items-center gap-8 text-xs whitespace-nowrap">
              {[...MARKET_NEWS_UPDATES, ...MARKET_NEWS_UPDATES].map((headline, idx) => (
                <span key={`${idx}-${headline.slice(0, 12)}`} className="inline-flex items-center gap-3">
                  <span>{headline}</span>
                  <span
                    className={highContrast ? 'text-slate-400' : 'text-[#C59B3B]'}
                    aria-hidden="true"
                  >
                    ◆
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          aria-label={paused ? 'Resume market news ticker' : 'Pause market news ticker'}
          className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded border shrink-0 cursor-pointer ${
            highContrast
              ? 'border-slate-900 text-slate-950 hover:bg-slate-100'
              : 'border-white/20 text-slate-300 hover:text-white hover:border-[#C59B3B]'
          }`}
        >
          {paused ? (
            <>
              <Play className="h-3 w-3" aria-hidden="true" />
              <span>Play</span>
            </>
          ) : (
            <>
              <Pause className="h-3 w-3" aria-hidden="true" />
              <span>Pause</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
