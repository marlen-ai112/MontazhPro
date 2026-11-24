import { AlertTriangle } from 'lucide-react';
import { Logo } from './Logo';

/** Экран первоначальной загрузки. Не зависит от контекста приложения. */
export function Splash({ error }: { error: string | null }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-ink-950">
      <div className="pointer-events-none absolute -left-24 top-1/4 h-72 w-72 rounded-full bg-volt/20 blur-[100px]" />
      <div className="pointer-events-none absolute -right-24 bottom-1/4 h-72 w-72 rounded-full bg-royal/20 blur-[100px]" />
      <div className="relative flex flex-col items-center px-6 text-center">
        <div className="animate-pop rounded-3xl border border-white/10 bg-ink-800/80 p-5 shadow-glow animate-pulseGlow">
          <Logo size={72} />
        </div>
        <h1 className="h-display mt-7 animate-slideUp text-3xl tracking-[0.22em] sm:text-4xl">OFFICE<span className="shimmer-text"> DUTY</span> QUEST</h1>
        <p className="mt-2 animate-slideUp text-sm text-slate-400 [animation-delay:.15s]">Порядок в офисе — это игра на уровень</p>
        {error ? (
          <div className="mt-8 flex max-w-sm items-start gap-2 rounded-xl border border-bad/30 bg-bad/10 p-3 text-left text-sm text-bad">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" /> <span>{error}</span>
          </div>
        ) : (
          <div className="mt-9 w-56">
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full animate-[load_1.6s_ease-out_forwards] rounded-full bg-gradient-to-r from-volt via-royal to-gold" />
            </div>
            <p className="label mt-3">Загрузка системы…</p>
          </div>
        )}
      </div>
    </div>
  );
}
