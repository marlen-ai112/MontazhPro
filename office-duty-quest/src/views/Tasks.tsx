import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { addDays, formatDayMonth, startOfWeek, weekDates, weekdayShort } from '../lib/dates';
import { dayStatus } from '../lib/game';
import { TaskPanel } from '../components/TaskPanel';
import { statusDot } from '../components/day';

export function Tasks() {
  const { state, today, selectedDate, openTasks } = useApp();
  const week = weekDates(startOfWeek(selectedDate));
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="h-display text-2xl">Задания дежурства</h1>
        {selectedDate !== today && <button className="btn-ghost" onClick={() => openTasks(today)}>Сегодня</button>}
      </div>
      <div className="card flex items-center gap-1.5 p-2">
        <button className="btn-ghost !min-h-[40px] !px-2.5" onClick={() => openTasks(addDays(selectedDate, -7))} aria-label="Предыдущая неделя"><ChevronLeft size={16} /></button>
        <div className="grid flex-1 grid-cols-7 gap-1">
          {week.map((d) => {
            const sel = d === selectedDate;
            return (
              <button key={d} onClick={() => openTasks(d)} data-testid={`pick-${d}`} aria-pressed={sel} aria-label={`${weekdayShort(d)}, ${formatDayMonth(d)}`}
                className={`flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-lg px-0.5 text-xs transition ${sel ? 'bg-gradient-to-b from-volt/30 to-royal/30 text-white ring-1 ring-volt/60' : 'text-slate-400 hover:bg-white/[0.06]'}`}>
                <span className={`font-semibold ${d === today ? 'text-volt-400' : ''}`}>{weekdayShort(d)}</span>
                <span className="font-display text-sm font-bold">{Number(d.slice(8))}</span>
                <span className={`h-1.5 w-1.5 rounded-full ${statusDot[dayStatus(state, d, today)]}`} />
              </button>
            );
          })}
        </div>
        <button className="btn-ghost !min-h-[40px] !px-2.5" onClick={() => openTasks(addDays(selectedDate, 7))} aria-label="Следующая неделя"><ChevronRight size={16} /></button>
      </div>
      <TaskPanel date={selectedDate} />
    </div>
  );
}
