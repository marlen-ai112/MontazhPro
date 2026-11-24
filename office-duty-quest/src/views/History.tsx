import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Check, Minus, Pencil } from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { DayStatus, ISODate } from '../types';
import { addDays, formatDateTime, formatLong, monthTitle, parseISODate, startOfWeek, toISODate, WEEKDAYS_SHORT } from '../lib/dates';
import { dayStatus, dayXp } from '../lib/game';
import { TASKS } from '../lib/tasks';
import { Avatar } from '../components/Avatar';
import { CircleProgress } from '../components/CircleProgress';
import { StatusChip, useDay } from '../components/day';

const CELL: Record<DayStatus, string> = {
  done: 'bg-ok/20 text-ok border-ok/40',
  partial: 'bg-warn/20 text-warn border-warn/40',
  missed: 'bg-bad/20 text-bad border-bad/40',
  pending: 'bg-volt/15 text-volt-400 border-volt/50',
  future: 'bg-white/[0.04] text-slate-500 border-white/[0.06]',
  'before-start': 'bg-white/[0.02] text-slate-600 border-transparent',
};

export function History() {
  const { state, today, isAdmin, openTasks } = useApp();
  const [sel, setSel] = useState<ISODate>(today);
  const [ym, setYm] = useState({ y: parseISODate(today).getFullYear(), m: parseISODate(today).getMonth() });

  const cells = useMemo(() => {
    const first = toISODate(new Date(ym.y, ym.m, 1));
    const start = startOfWeek(first);
    const out: ISODate[] = [];
    for (let d = start; out.length < 42; d = addDays(d, 1)) out.push(d);
    // убираем полностью лишнюю последнюю неделю
    return out[35] && parseISODate(out[35]).getMonth() !== ym.m ? out.slice(0, 35) : out;
  }, [ym]);

  const shift = (n: number) => setYm(({ y, m }) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const pick = (d: ISODate) => { setSel(d); const p = parseISODate(d); if (p.getMonth() !== ym.m || p.getFullYear() !== ym.y) setYm({ y: p.getFullYear(), m: p.getMonth() }); };

  return (
    <div className="space-y-4">
      <h1 className="h-display text-2xl">История дежурств</h1>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="card p-4 sm:p-5" aria-label="Календарь">
          <div className="mb-3 flex items-center justify-between">
            <button className="btn-ghost !px-3" onClick={() => shift(-1)} aria-label="Предыдущий месяц"><ChevronLeft size={18} /></button>
            <div className="text-center">
              <p className="font-display text-lg font-bold text-white" data-testid="month-title">{monthTitle(ym.y, ym.m)}</p>
              <button className="text-xs font-semibold text-volt-400 hover:underline" onClick={() => { const p = parseISODate(today); setYm({ y: p.getFullYear(), m: p.getMonth() }); setSel(today); }}>К сегодняшнему дню</button>
            </div>
            <button className="btn-ghost !px-3" onClick={() => shift(1)} aria-label="Следующий месяц"><ChevronRight size={18} /></button>
          </div>
          <div className="grid grid-cols-7 gap-1.5 text-center">
            {WEEKDAYS_SHORT.map((w) => <div key={w} className="pb-1 text-[11px] font-semibold uppercase text-slate-500">{w}</div>)}
            {cells.map((d) => {
              const inMonth = parseISODate(d).getMonth() === ym.m;
              const st = dayStatus(state, d, today);
              const isSel = d === sel;
              return (
                <button key={d} onClick={() => pick(d)} data-testid={`cal-${d}`} data-status={st} aria-pressed={isSel}
                  aria-label={`${formatLong(d)}`}
                  className={`relative aspect-square min-h-[40px] rounded-xl border text-sm font-semibold transition hover:brightness-125 ${CELL[st]} ${inMonth ? '' : 'opacity-35'} ${isSel ? 'ring-2 ring-white/80 ring-offset-2 ring-offset-ink-800' : ''}`}>
                  {Number(d.slice(8))}
                  {d === today && <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-current" />}
                </button>
              );
            })}
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-slate-300 sm:grid-cols-4">
            {([['done', 'Всё выполнено'], ['partial', 'Частично'], ['missed', 'Не выполнено'], ['future', 'Ещё не наступило']] as const).map(([k, l]) => (
              <li key={k} className="flex items-center gap-2"><span className={`h-3 w-3 rounded border ${CELL[k]}`} />{l}</li>
            ))}
          </ul>
          <div className="mt-3 flex items-center gap-2">
            <label className="flex flex-1 items-center gap-2 text-xs text-slate-400"><CalendarDays size={14} /> Перейти к дате:
              <input type="date" className="input !min-h-[38px] !py-1" value={sel} onChange={(e) => e.target.value && pick(e.target.value)} aria-label="Выбрать дату" />
            </label>
          </div>
        </section>

        <DayDetail date={sel} isAdmin={isAdmin} onEdit={() => openTasks(sel)} key={sel} />
      </div>
    </div>
  );
}

function DayDetail({ date, isAdmin, onEdit }: { date: ISODate; isAdmin: boolean; onEdit: () => void }) {
  const { state, today } = useApp();
  const d = useDay(date);
  const marks = state.marks[date] ?? {};
  const st = dayStatus(state, date, today);
  return (
    <section className="card animate-fadeIn p-4 sm:p-5" aria-label="Подробности дня" data-testid="day-detail">
      <p className="label">{formatLong(date)}</p>
      <div className="mt-3 flex items-center gap-4">
        <CircleProgress value={d.percent} size={92} stroke={9} done={d.complete}>
          <p className="font-display text-xl font-bold text-white" data-testid="detail-percent">{d.percent}%</p>
        </CircleProgress>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            {d.employee && <Avatar name={d.employee.name} id={d.employee.id} size={36} />}
            <div><p className="text-xs text-slate-500">Дежурил(а)</p><p className="font-display text-lg font-bold text-white" data-testid="detail-name">{d.employee?.name}</p></div>
          </div>
          <div className="mt-2"><StatusChip status={st} overdue={d.overdue} /></div>
          <p className="mt-1.5 text-xs text-slate-400">{d.done} из {d.total} заданий · {dayXp(state, date)} XP</p>
        </div>
      </div>
      <ul className="mt-4 space-y-2">
        {TASKS.map((t) => {
          const m = marks[t.id];
          return (
            <li key={t.id} data-testid={`detail-${t.id}`} data-done={!!m} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${m ? 'border-ok/25 bg-ok/[0.06]' : 'border-white/[0.05] bg-white/[0.03]'}`}>
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${m ? 'bg-ok text-ink-950' : 'bg-white/10 text-slate-500'}`}>{m ? <Check size={16} strokeWidth={3} /> : <Minus size={16} />}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{t.title}</p>
                <p className="flex items-center gap-1 text-xs text-slate-400">
                  {m ? (<><Clock size={11} /> {formatDateTime(m.at)}{m.late ? ' · позже срока' : ''}{m.by === 'admin' ? ' · админ' : ''}</>) : st === 'future' ? 'Ещё не наступило' : 'Не выполнено'}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {isAdmin && st !== 'future' && (
        <button className="btn-ghost mt-4 w-full" onClick={onEdit}><Pencil size={15} /> Исправить отметки этого дня</button>
      )}
    </section>
  );
}
