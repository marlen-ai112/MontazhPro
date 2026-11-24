import { ArrowRight } from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { ISODate } from '../types';
import { formatDayMonth, weekdayName } from '../lib/dates';
import { Avatar } from './Avatar';
import { ProgressBar } from './ProgressBar';
import { StatusChip, useDay } from './day';

export function DayCard({ date, compact }: { date: ISODate; compact?: boolean }) {
  const { openTasks, currentEmployeeId } = useApp();
  const d = useDay(date);
  const mine = d.employee?.id === currentEmployeeId;
  const tone = d.status === 'done' ? 'green' : 'blue';
  return (
    <div
      data-testid={`day-card-${date}`}
      className={`card flex flex-col gap-3 p-4 transition hover:-translate-y-0.5 ${d.isToday ? 'card-glow animate-pulseGlow' : ''} ${d.status === 'future' ? 'opacity-80' : ''}`}
    >
      {d.isToday && <span className="absolute -top-2.5 left-4 rounded-full bg-gradient-to-r from-volt to-royal px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">Сегодня</span>}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display text-base font-bold text-white">{weekdayName(date)}</p>
          <p className="text-xs text-slate-400">{formatDayMonth(date)} {date.slice(0, 4)}</p>
        </div>
        <span className="font-display text-lg font-bold text-white">{d.percent}<span className="text-xs text-slate-400">%</span></span>
      </div>
      <div className="flex items-center gap-2.5">
        {d.employee && <Avatar name={d.employee.name} id={d.employee.id} size={34} ring={mine ? 'blue' : undefined} />}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{d.employee?.name}</p>
          <p className="text-[11px] text-slate-500">{mine ? 'это вы' : 'дежурный'}</p>
        </div>
      </div>
      <ProgressBar value={d.percent} tone={tone} />
      <div className="flex flex-1 items-end"><StatusChip status={d.status} overdue={d.overdue} short={compact} /></div>
      <button className="btn-ghost w-full justify-between" onClick={() => openTasks(date)}>
        <span>К заданиям</span><ArrowRight size={16} />
      </button>
    </div>
  );
}
