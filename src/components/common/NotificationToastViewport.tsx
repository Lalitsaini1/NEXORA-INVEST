import { CheckCircle2, Coins, Info, X } from 'lucide-react';
import { useNotificationToasts } from '../../context/NotificationToastContext';

export function NotificationToastViewport() {
  const { toasts, dismissToast } = useNotificationToasts();

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="Live reward and transaction notifications"
      aria-live="polite"
      className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-96 z-50 flex flex-col gap-3 pointer-events-none"
    >
      {toasts.map((toast) => {
        const isReward = toast.tone === 'reward';
        const isSuccess = toast.tone === 'success';
        const accentBorder = isReward
          ? 'border-l-4 border-l-[#C59B3B]'
          : isSuccess
          ? 'border-l-4 border-l-emerald-600'
          : 'border-l-4 border-l-[#0B1A30]';

        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto bg-white border border-slate-200 ${accentBorder} rounded-xl shadow-lg p-4 flex items-start gap-3 transition-all`}
          >
            <div
              className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                isReward
                  ? 'bg-[#F8F1DE] text-[#A37B22]'
                  : isSuccess
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-slate-100 text-[#0B1A30]'
              }`}
              aria-hidden="true"
            >
              {isReward ? (
                <Coins className="h-4 w-4" />
              ) : isSuccess ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Info className="h-4 w-4" />
              )}
            </div>

            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-[#0B1A30] truncate">
                  {toast.title}
                </p>
                {toast.amountLabel && (
                  <span
                    className={`text-xs font-mono font-bold tabular-nums shrink-0 ${
                      toast.amountLabel.startsWith('+')
                        ? 'text-emerald-700'
                        : 'text-[#0B1A30]'
                    }`}
                  >
                    {toast.amountLabel}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 leading-relaxed line-clamp-2">
                {toast.message}
              </p>
            </div>

            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label={`Dismiss ${toast.title} notification`}
              className="p-1 text-slate-400 hover:text-[#0B1A30] rounded-md transition-colors cursor-pointer shrink-0"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
