import { useState } from 'react';
import { Award, ChevronLeft, ChevronRight, Lock, Sparkles, Star } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { addDays, formatWeekRange, startOfWeek } from '../lib/dates';
import { achievementsFor, levelFor, LEVELS, perfectWeeks, ranking, xpFor } from '../lib/game';
import { Avatar } from '../components/Avatar';
import { Leaderboard } from '../components/Leaderboard';
import { ProgressBar } from '../components/ProgressBar';

export function Rating() {
  const { state, today, currentEmployeeId } = useApp();
  const [scope, setScope] = useState<'week' | 'all'>('week');
  const [weekStart, setWeekStart] = useState(startOfWeek(today));
  const [who, setWho] = useState<string>(currentEmployeeId ?? state.employees[0].id);
  const rows = ranking(state, scope, weekStart);
  const emp = state.employees.find((e) => e.id === who) ?? state.employees[0];
  const ach = achievementsFor(state, emp.id, today);
  const xp = xpFor(state, emp.id);
  const lvl = levelFor(xp);
  const perfect = perfectWeeks(state, today);

  return (
    <div className="space-y-6">
      <section className="card p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="h-display text-2xl">Рейтинг сотрудников</h1>
          <div className="flex rounded-xl bg-ink-800 p-1" role="tablist">
            {([['week', 'За неделю'], ['all', 'За всё время']] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={scope === k} onClick={() => setScope(k)}
                className={`min-h-[40px] rounded-lg px-4 text-sm font-semibold transition ${scope === k ? 'bg-gradient-to-r from-volt-600 to-royal-500 text-white' : 'text-slate-400 hover:text-white'}`}>{l}</button>
            ))}
          </div>
        </div>
        {scope === 'week' && (
          <div className="mb-4 flex items-center justify-between rounded-xl bg-white/[0.04] px-2 py-1.5">
            <button className="btn-ghost !min-h-[38px] !px-2.5" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Предыдущая неделя"><ChevronLeft size={16} /></button>
            <button className="text-sm font-semibold text-white" onClick={() => setWeekStart(startOfWeek(today))}>{formatWeekRange(weekStart)}</button>
            <button className="btn-ghost !min-h-[38px] !px-2.5" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Следующая неделя"><ChevronRight size={16} /></button>
          </div>
        )}
        <Leaderboard rows={rows} detailed />
        <p className="mt-3 text-xs text-slate-500">XP считается автоматически из отметок: 20 XP за задание + 50 XP за полностью закрытое дежурство. Уровень зависит от XP за всё время.</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <section className="card p-4 sm:p-5">
          <h2 className="h-display mb-3 flex items-center gap-2 text-lg"><Star size={18} className="text-gold" /> Уровни</h2>
          <ol className="space-y-2">
            {LEVELS.map((l, i) => {
              const reached = xp >= l.min;
              return (
                <li key={l.name} className={`flex items-center gap-3 rounded-xl border p-3 ${lvl.index === i ? 'border-gold/40 bg-gold/[0.07]' : 'border-white/[0.05] bg-white/[0.03]'} ${reached ? '' : 'opacity-60'}`}>
                  <span className={`grid h-9 w-9 place-items-center rounded-lg font-display font-bold ${reached ? 'bg-gradient-to-br from-volt to-royal text-white' : 'bg-white/10 text-slate-400'}`}>{i + 1}</span>
                  <div className="flex-1"><p className="font-semibold text-white">{l.name}</p><p className="text-xs text-slate-500">от {l.min} XP</p></div>
                  {lvl.index === i && <span className="chip bg-gold/15 text-gold">{emp.name}</span>}
                </li>
              );
            })}
          </ol>
          <div className="mt-4 rounded-xl bg-white/[0.04] p-3">
            <p className="text-sm text-slate-300">Идеальных недель у команды (все 7 дней закрыты): <b className="text-gold">{perfect.length}</b></p>
          </div>
        </section>

        <section className="card p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="h-display flex items-center gap-2 text-lg"><Award size={18} className="text-royal-400" /> Достижения и награды</h2>
            <select className="input !w-auto" value={emp.id} onChange={(e) => setWho(e.target.value)} aria-label="Сотрудник">
              {state.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="mb-4 flex items-center gap-3 rounded-xl bg-white/[0.04] p-3">
            <Avatar name={emp.name} id={emp.id} size={44} ring={lvl.index >= 4 ? 'gold' : 'violet'} />
            <div className="flex-1">
              <p className="font-display font-bold text-white">{emp.name} · {lvl.name}</p>
              <ProgressBar value={lvl.progress * 100} tone={lvl.nextName ? 'blue' : 'gold'} height={6} />
              <p className="mt-1 text-[11px] text-slate-500">{xp} XP{lvl.nextName ? ` · до «${lvl.nextName}» ещё ${lvl.toNext} XP` : ' · максимальный уровень'}</p>
            </div>
          </div>
          <ul className="grid gap-2.5 sm:grid-cols-2" data-testid="achievements">
            {ach.map((a) => (
              <li key={a.id} data-unlocked={a.unlocked} className={`rounded-xl border p-3 ${a.unlocked ? (a.id === 'master' ? 'border-gold/40 bg-gold/[0.08]' : 'border-royal/40 bg-royal/[0.08]') : 'border-white/[0.05] bg-white/[0.02] opacity-60'}`}>
                <div className="flex items-center gap-2">
                  {a.unlocked ? <Sparkles size={16} className={a.id === 'master' ? 'text-gold' : 'text-royal-400'} /> : <Lock size={16} className="text-slate-500" />}
                  <p className="text-sm font-semibold text-white">{a.title}</p>
                  {a.count > 1 && <span className="chip ml-auto bg-white/10 text-slate-200">×{a.count}</span>}
                </div>
                <p className="mt-1 text-xs text-slate-400">{a.description}</p>
                <p className="mt-1.5 text-[11px] font-medium text-gold">Награда: {a.reward}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
