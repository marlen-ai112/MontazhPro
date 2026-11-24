import { CheckCircle2, RotateCcw, Settings2, Trophy, Undo2 } from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { ActivityItem } from '../types';
import { formatDayMonth, relativeTime } from '../lib/dates';
import { employeeById } from '../lib/state';
import { taskById } from '../lib/tasks';

export function ActivityFeed({ limit = 8 }: { limit?: number }) {
  const { state, now } = useApp();
  const items = state.activity.slice(0, limit);
  if (!items.length) {
    return <p className="rounded-xl border border-dashed border-white/10 p-5 text-center text-sm text-slate-500">Пока нет действий. Отметьте первое задание — оно появится здесь.</p>;
  }
  return (
    <ul className="space-y-1.5" data-testid="activity">
      {items.map((a) => <Row key={a.id} a={a} now={now} />)}
    </ul>
  );
}

function Row({ a, now }: { a: ActivityItem; now: Date }) {
  const { state } = useApp();
  const name = employeeById(state, a.employeeId)?.name ?? '—';
  const task = taskById(a.taskId ?? '')?.title;
  const by = a.actor === 'admin' ? ' · админ' : '';
  let Icon = CheckCircle2, tone = 'text-ok', title = '', sub = '';
  switch (a.kind) {
    case 'mark': title = `${name}: ${task}`; sub = `выполнено${by}`; break;
    case 'unmark': Icon = Undo2; tone = 'text-slate-400'; title = `${name}: ${task}`; sub = `отметка отменена${by}`; break;
    case 'complete': Icon = Trophy; tone = 'text-gold'; title = `Дежурство завершено — ${name}`; sub = `+50 XP бонус · ${formatDayMonth(a.date!)}`; break;
    case 'reset': Icon = RotateCcw; tone = 'text-warn'; title = `Сброс отметок: ${name}`; sub = `${formatDayMonth(a.date!)} · админ`; break;
    default: Icon = Settings2; tone = 'text-royal-400'; title = a.detail ?? 'Изменение настроек'; sub = 'администратор';
  }
  return (
    <li className="flex items-start gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
      <Icon size={18} className={`mt-0.5 shrink-0 ${tone}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{title}</p>
        <p className="text-xs text-slate-500">{sub}</p>
      </div>
      <span className="shrink-0 text-[11px] text-slate-500">{relativeTime(a.at, now)}</span>
    </li>
  );
}
