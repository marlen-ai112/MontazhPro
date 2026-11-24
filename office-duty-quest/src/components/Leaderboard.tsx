import { Crown, Medal } from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { RankRow } from '../lib/game';
import { Avatar } from './Avatar';
import { ProgressBar } from './ProgressBar';

export function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-gold-400 to-gold-600 text-ink-950"><Crown size={16} /></span>;
  if (rank <= 3) return <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-slate-200"><Medal size={16} /></span>;
  return <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.04] font-display text-sm font-bold text-slate-400">{rank}</span>;
}

export function Leaderboard({ rows, limit, detailed }: { rows: RankRow[]; limit?: number; detailed?: boolean }) {
  const { currentEmployeeId } = useApp();
  const list = limit ? rows.slice(0, limit) : rows;
  return (
    <ol className="space-y-2" data-testid="leaderboard">
      {list.map((r) => (
        <li key={r.employee.id} className={`rounded-xl border p-3 ${r.employee.id === currentEmployeeId ? 'border-volt/40 bg-volt/[0.07]' : 'border-white/[0.05] bg-white/[0.03]'}`}>
          <div className="flex items-center gap-3">
            <RankBadge rank={r.rank} />
            <Avatar name={r.employee.name} id={r.employee.id} size={36} ring={r.rank === 1 && r.xp > 0 ? 'gold' : undefined} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-white">{r.employee.name}{r.employee.id === currentEmployeeId && <span className="ml-1.5 text-[11px] font-medium text-volt-400">вы</span>}</p>
              <p className="truncate text-xs text-slate-400">Ур. {r.level.index + 1} · {r.level.name}</p>
            </div>
            <div className="text-right">
              <p className="font-display text-lg font-bold text-white">{r.xp}<span className="ml-0.5 text-xs font-semibold text-gold"> XP</span></p>
              {detailed && <p className="text-[11px] text-slate-500">{r.tasks} зад. · {r.fullDuties} полн.</p>}
            </div>
          </div>
          {detailed && (
            <div className="mt-2.5">
              <ProgressBar value={r.level.progress * 100} tone={r.level.nextName ? 'blue' : 'gold'} height={6} />
              <p className="mt-1 text-[11px] text-slate-500">{r.level.nextName ? `До «${r.level.nextName}»: ${r.level.toNext} XP` : 'Максимальный уровень'}</p>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
