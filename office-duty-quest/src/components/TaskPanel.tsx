import { useRef, useState } from 'react';
import { Check, Clock, Lock, RotateCcw, ShieldCheck, Undo2, Zap } from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { ISODate } from '../types';
import { formatLong, formatTime } from '../lib/dates';
import { canEditDuty } from '../lib/state';
import { TASKS } from '../lib/tasks';
import { XP_DUTY_BONUS, XP_PER_TASK, dayXp } from '../lib/game';
import { Avatar } from './Avatar';
import { CircleProgress } from './CircleProgress';
import { ConfirmDialog } from './Modal';
import { StatusChip, useDay } from './day';

export function TaskPanel({ date, showHeader = true }: { date: ISODate; showHeader?: boolean }) {
  const { state, today, actor, isAdmin, toggleTask, resetDay } = useApp();
  const d = useDay(date);
  const perm = canEditDuty(state, actor, date, today);
  const marks = state.marks[date] ?? {};
  const [confirmReset, setConfirmReset] = useState(false);
  const xp = dayXp(state, date);

  return (
    <div className="space-y-4" data-testid="task-panel">
      {showHeader && (
        <div className={`card flex items-center gap-4 p-4 sm:p-5 ${d.isToday ? 'card-glow' : ''}`}>
          <CircleProgress value={d.percent} size={104} stroke={10} done={d.complete}>
            <div><p className="font-display text-2xl font-bold text-white">{d.percent}%</p></div>
          </CircleProgress>
          <div className="min-w-0 flex-1">
            <p className="label">{d.isToday ? 'Сегодня дежурит' : 'Дежурный'}</p>
            <div className="mt-1.5 flex items-center gap-2.5">
              {d.employee && <Avatar name={d.employee.name} id={d.employee.id} size={36} />}
              <p className="truncate font-display text-xl font-bold text-white">{d.employee?.name}</p>
            </div>
            <p className="mt-1 text-xs text-slate-400">{formatLong(date)}</p>
            <div className="mt-2"><StatusChip status={d.status} overdue={d.overdue} /></div>
          </div>
        </div>
      )}

      {!perm.ok && (
        <div className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3 text-sm text-slate-300" data-testid="lock-note">
          <Lock size={16} className="mt-0.5 shrink-0 text-slate-400" /> <span>{perm.reason}</span>
        </div>
      )}
      {perm.ok && isAdmin && (
        <div className="flex items-start gap-2.5 rounded-xl border border-royal/30 bg-royal/10 px-3.5 py-3 text-sm text-royal-400">
          <ShieldCheck size={16} className="mt-0.5 shrink-0" /> <span>Режим администратора: можно менять любые отметки</span>
        </div>
      )}

      <ul className="space-y-2.5">
        {TASKS.map((t, i) => {
          const m = marks[t.id];
          const done = !!m;
          return (
            <li key={t.id} data-testid={`task-${t.id}`} data-done={done}
              className={`card flex items-center gap-3 p-3.5 transition sm:p-4 ${done ? 'border-ok/30 bg-gradient-to-r from-ok/[0.08] to-transparent' : ''}`}>
              <TaskCheck done={done} disabled={!perm.ok} label={`${t.title}: ${done ? 'выполнено, нажмите чтобы отменить' : 'отметить выполненным'}`}
                onToggle={(origin) => toggleTask(date, t.id, origin)} />
              <div className="min-w-0 flex-1">
                <p className={`text-[15px] font-semibold leading-snug ${done ? 'text-white' : 'text-slate-100'}`}><span className="mr-1.5 text-slate-500">{i + 1}.</span>{t.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{t.hint}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={`chip ${done ? 'bg-ok/15 text-ok' : 'bg-white/[0.06] text-slate-400'}`}>{done ? 'Выполнено' : 'Не выполнено'}</span>
                  {m && (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-400" data-testid={`time-${t.id}`}>
                      <Clock size={12} /> {formatTime(m.at)}
                      {m.late && <span className="text-warn">· позже срока</span>}
                      {m.by === 'admin' && <span className="text-royal-400">· админ</span>}
                    </span>
                  )}
                </div>
              </div>
              {done && perm.ok && (
                <button className="btn-ghost !min-h-[40px] !px-3 text-xs" onClick={() => toggleTask(date, t.id)} aria-label={`Отменить отметку: ${t.title}`}>
                  <Undo2 size={14} /><span className="hidden sm:inline">Отменить</span>
                </button>
              )}
              {!done && <span className="hidden text-xs font-semibold text-gold sm:block">+{XP_PER_TASK} XP</span>}
            </li>
          );
        })}
      </ul>

      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-2.5">
          <Zap size={18} className="text-gold" />
          <div>
            <p className="text-sm font-semibold text-white" data-testid="day-xp">{xp} XP за это дежурство</p>
            <p className="text-xs text-slate-500">{XP_PER_TASK} XP за задание + {XP_DUTY_BONUS} XP бонус за все пять</p>
          </div>
        </div>
        {isAdmin && Object.keys(marks).length > 0 && (
          <button className="btn-danger !min-h-[40px]" onClick={() => setConfirmReset(true)}><RotateCcw size={15} /> Сбросить отметки дня</button>
        )}
      </div>

      {confirmReset && (
        <ConfirmDialog title="Сбросить отметки?" danger confirmLabel="Да, сбросить"
          text={<>Все отметки за <b>{formatLong(date)}</b> ({d.employee?.name}) будут удалены, а XP за этот день снимется. Действие попадёт в журнал.</>}
          onCancel={() => setConfirmReset(false)} onConfirm={() => { resetDay(date); setConfirmReset(false); }} />
      )}
    </div>
  );
}

function TaskCheck({ done, disabled, label, onToggle }: { done: boolean; disabled: boolean; label: string; onToggle: (o: { x: number; y: number }) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button ref={ref} role="checkbox" aria-checked={done} aria-label={label} aria-disabled={disabled}
      onClick={() => {
        const r = ref.current?.getBoundingClientRect();
        onToggle({ x: r ? r.left + r.width / 2 : window.innerWidth / 2, y: r ? r.top : window.innerHeight / 2 });
      }}
      className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl border-2 transition active:scale-90 ${
        done ? 'border-ok bg-ok text-ink-950 shadow-[0_0_20px_-4px_rgba(52,211,153,.8)]'
          : disabled ? 'border-white/10 bg-white/[0.03] text-slate-600'
            : 'border-volt/50 bg-volt/10 text-transparent hover:border-volt hover:text-volt-400'}`}>
      {disabled && !done ? <Lock size={16} /> : <Check size={26} strokeWidth={3} />}
    </button>
  );
}
