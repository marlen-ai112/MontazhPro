import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Hourglass, Lock, MinusCircle } from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { DayStatus, ISODate } from '../types';
import { dayPercent, dayStatus, isDayComplete, isOverdue, TOTAL_TASKS } from '../lib/game';
import { dayDone, dutyEmployee } from '../lib/state';

export function useDay(date: ISODate) {
  const { state, today, now } = useApp();
  const done = dayDone(state, date);
  return {
    date,
    employee: dutyEmployee(state, date),
    done,
    total: TOTAL_TASKS,
    percent: dayPercent(state, date),
    complete: isDayComplete(state, date),
    status: dayStatus(state, date, today),
    overdue: isOverdue(state, date, now),
    isToday: date === today,
  };
}

const META: Record<DayStatus, { label: string; cls: string; Icon: typeof Clock }> = {
  done: { label: 'Дежурство завершено', cls: 'bg-ok/15 text-ok', Icon: CheckCircle2 },
  partial: { label: 'Частично выполнено', cls: 'bg-warn/15 text-warn', Icon: Hourglass },
  missed: { label: 'Не выполнено', cls: 'bg-bad/15 text-bad', Icon: MinusCircle },
  pending: { label: 'Ожидает выполнения', cls: 'bg-volt/15 text-volt-400', Icon: CircleDashed },
  future: { label: 'Ещё не наступило', cls: 'bg-white/[0.06] text-slate-400', Icon: Lock },
  'before-start': { label: 'До начала учёта', cls: 'bg-white/[0.06] text-slate-500', Icon: Lock },
};

export function StatusChip({ status, overdue, short }: { status: DayStatus; overdue?: boolean; short?: boolean }) {
  const m = META[status];
  const label = short ? ({ done: 'Завершено', partial: 'В процессе', missed: 'Не выполнено', pending: 'Ожидает', future: 'Впереди', 'before-start': 'Нет данных' } as const)[status] : m.label;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={`chip ${m.cls}`}><m.Icon size={13} /> {label}</span>
      {overdue && <span className="chip bg-bad/15 text-bad" data-testid="overdue"><AlertTriangle size={13} /> Просрочено</span>}
    </span>
  );
}

export const statusDot: Record<DayStatus, string> = {
  done: 'bg-ok', partial: 'bg-warn', missed: 'bg-bad', pending: 'bg-volt', future: 'bg-slate-600', 'before-start': 'bg-slate-700',
};
