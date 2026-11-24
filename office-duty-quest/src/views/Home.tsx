import { useState } from 'react';
import { CalendarCheck, ChevronLeft, ChevronRight, ListChecks, Target, TrendingUp, Trophy } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { addDays, formatLong, formatWeekRange, startOfWeek, weekDates } from '../lib/dates';
import { levelFor, ranking, weekProgress, xpFor } from '../lib/game';
import { Avatar } from '../components/Avatar';
import { CircleProgress } from '../components/CircleProgress';
import { DayCard } from '../components/DayCard';
import { ActivityFeed } from '../components/ActivityFeed';
import { Leaderboard } from '../components/Leaderboard';
import { ProgressBar } from '../components/ProgressBar';
import { StatusChip, useDay } from '../components/day';

export function Home() {
  const { state, today, setTab, openTasks, currentEmployeeId, dutyBanner, dismissDutyBanner } = useApp();
  const [weekStart, setWeekStart] = useState(startOfWeek(today));
  const t = useDay(today);
  const wp = weekProgress(state, weekStart, today);
  const rows = ranking(state, 'week', startOfWeek(today));
  const lvl = t.employee ? levelFor(xpFor(state, t.employee.id)) : null;
  const mine = t.employee?.id === currentEmployeeId;
  const isCurrentWeek = weekStart === startOfWeek(today);

  return (
    <div className="space-y-6">
      {dutyBanner && (
        <div className="card flex animate-slideUp items-center gap-3 border-gold/30 bg-gradient-to-r from-gold/10 to-transparent p-3.5" data-testid="duty-banner">
          <CalendarCheck className="shrink-0 text-gold" size={22} />
          <p className="flex-1 text-sm text-slate-200">
            {dutyBanner.mine ? <b className="text-white">Сегодня ваше дежурство!</b> : <><b className="text-white">Новое дежурство:</b> сегодня дежурит {t.employee?.name}.</>}
          </p>
          <button className="text-xs font-semibold text-slate-400 hover:text-white" onClick={dismissDutyBanner}>Скрыть</button>
        </div>
      )}

      {/* герой: сегодняшнее дежурство */}
      <section className="card card-glow noise overflow-hidden p-5 sm:p-7" aria-label="Сегодняшнее дежурство">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-royal/25 blur-[90px]" />
        <div className="relative grid items-center gap-6 md:grid-cols-[auto_1fr]">
          <div className="mx-auto"><CircleProgress value={t.percent} size={210} stroke={16} done={t.complete}>
            <div>
              <p className="font-display text-5xl font-extrabold text-white" data-testid="today-percent">{t.percent}<span className="text-2xl text-slate-400">%</span></p>
              <p className="mt-1 text-sm text-slate-400" data-testid="today-count">{t.done} из {t.total} заданий</p>
            </div>
          </CircleProgress></div>
          <div className="text-center md:text-left">
            <p className="label">Сегодня дежурит</p>
            {t.employee && (
              <div className="mt-2 flex items-center justify-center gap-3 md:justify-start">
                <Avatar name={t.employee.name} id={t.employee.id} size={56} ring="blue" />
                <div className="text-left">
                  <p className="h-display text-3xl" data-testid="today-name">{t.employee.name}</p>
                  {lvl && <p className="text-sm text-slate-400">Ур. {lvl.index + 1} · {lvl.name}{mine && <span className="ml-1.5 text-volt-400">— это вы</span>}</p>}
                </div>
              </div>
            )}
            <div className="mt-3 flex justify-center md:justify-start"><StatusChip status={t.status} overdue={t.overdue} /></div>
            <div className="mt-5 grid grid-cols-3 gap-2.5">
              <Stat icon={<ListChecks size={16} />} label="Выполнено" value={`${t.done}/${t.total}`} />
              <Stat icon={<Target size={16} />} label="Осталось" value={String(t.total - t.done)} />
              <Stat icon={<TrendingUp size={16} />} label="За неделю" value={`${weekProgress(state, startOfWeek(today), today).percent}%`} />
            </div>
            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
              <button className="btn-primary flex-1 text-base sm:flex-none sm:px-8" onClick={() => openTasks(today)} data-testid="cta-mark">
                <ListChecks size={18} /> {t.complete ? 'Открыть задания' : 'Отметить выполнение'}
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-500">{formatLong(today)}</p>
          </div>
        </div>
      </section>

      {/* неделя */}
      <section aria-label="График на неделю">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="h-display text-xl">График дежурств</h2>
            <p className="text-sm text-slate-400" data-testid="week-range">{formatWeekRange(weekStart)}{isCurrentWeek && ' · текущая неделя'}</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-ghost !px-3" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Предыдущая неделя"><ChevronLeft size={18} /></button>
            {!isCurrentWeek && <button className="btn-ghost" onClick={() => setWeekStart(startOfWeek(today))}>Сегодня</button>}
            <button className="btn-ghost !px-3" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Следующая неделя"><ChevronRight size={18} /></button>
          </div>
        </div>
        <div className="card mb-4 p-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-semibold text-white">Общий недельный прогресс</span>
            <span className="text-slate-400" data-testid="week-progress">{wp.done} из {wp.total} заданий · полных дней {wp.fullDays}/7 · <b className="text-white">{wp.percent}%</b></span>
          </div>
          <ProgressBar value={wp.percent} tone={wp.percent === 100 ? 'gold' : 'blue'} height={10} />
        </div>
        <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2 lg:grid-cols-4">
          {weekDates(weekStart).map((d) => <DayCard key={d} date={d} />)}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-4 sm:p-5" aria-label="Рейтинг">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="h-display flex items-center gap-2 text-lg"><Trophy size={18} className="text-gold" /> Рейтинг недели</h2>
            <button className="text-sm font-semibold text-volt-400 hover:underline" onClick={() => setTab('rating')}>Весь рейтинг</button>
          </div>
          <Leaderboard rows={rows} limit={5} />
        </section>
        <section className="card p-4 sm:p-5" aria-label="Последние действия">
          <h2 className="h-display mb-3 text-lg">Последние действия</h2>
          <ActivityFeed limit={7} />
        </section>
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.04] px-3 py-2.5 text-left">
      <p className="flex items-center gap-1.5 text-[11px] text-slate-400">{icon}{label}</p>
      <p className="mt-0.5 font-display text-lg font-bold text-white">{value}</p>
    </div>
  );
}
