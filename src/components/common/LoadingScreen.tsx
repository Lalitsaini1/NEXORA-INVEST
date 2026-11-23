import { NexoraLogo } from '../branding/NexoraLogo';

interface LoadingScreenProps {
  label?: string;
}

export function LoadingScreen({ label = 'Preparing workspace...' }: LoadingScreenProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0B1A30] text-white px-6"
    >
      <div className="flex flex-col items-center gap-6">
        <div className="relative flex items-center justify-center">
          <div className="h-20 w-20 rounded-2xl border border-[#C59B3B]/35 bg-[#13284A]/60 flex items-center justify-center shadow-lg">
            <NexoraLogo variant="icon" theme="light-on-dark" size="lg" />
          </div>
        </div>
        <div className="text-center space-y-2">
          <p className="font-display text-xl font-bold tracking-tight text-white">
            NEXORA INVEST
          </p>
          <p className="text-sm text-slate-300">{label}</p>
        </div>
        <div className="w-44 h-1 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full w-1/2 rounded-full bg-[#C59B3B] animate-[pulse_1.4s_ease-in-out_infinite]" />
        </div>
      </div>
    </div>
  );
}
