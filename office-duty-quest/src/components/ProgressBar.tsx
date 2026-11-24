export function ProgressBar({ value, tone = 'blue', height = 8 }: { value: number; tone?: 'blue' | 'gold' | 'green'; height?: number }) {
  const v = Math.max(0, Math.min(100, value));
  const grad = tone === 'gold' ? 'from-gold-600 to-gold-400' : tone === 'green' ? 'from-emerald-500 to-ok' : 'from-volt-600 via-volt to-royal-500';
  return (
    <div className="w-full overflow-hidden rounded-full bg-white/[0.07]" style={{ height }} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full bg-gradient-to-r ${grad} transition-[width] duration-700 ease-out`} style={{ width: `${v}%` }} />
    </div>
  );
}
