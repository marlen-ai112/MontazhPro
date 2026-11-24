import { useRef, useState } from 'react';
import { BarChart3, CalendarCog, Download, FlaskConical, KeyRound, Lock, LogOut, Pencil, Save, Settings, ShieldCheck, Trash2, Undo2, Upload, Users } from 'lucide-react';
import { useApp } from '../store/AppContext';
import type { Assignments, ISODate } from '../types';
import { addDays, formatDayMonth, formatLong, startOfWeek, WEEKDAYS } from '../lib/dates';
import { employeeStats } from '../lib/game';
import { assignmentsFor, assigneeFor } from '../lib/state';
import { Avatar } from '../components/Avatar';
import { ConfirmDialog } from '../components/Modal';
import { PinModal } from '../components/PinModal';
import { TaskPanel } from '../components/TaskPanel';

export function Admin() {
  const { isAdmin } = useApp();
  const [pinOpen, setPinOpen] = useState(false);
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-md pt-6">
        <div className="card p-8 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-volt/30 to-royal/30 text-volt-400"><Lock size={30} /></div>
          <h1 className="h-display mt-5 text-2xl">Панель администратора</h1>
          <p className="mt-2 text-sm text-slate-400">Изменение расписания, имён и отметок, статистика по всем сотрудникам. Доступ защищён PIN-кодом.</p>
          <button className="btn-primary mt-6 w-full" onClick={() => setPinOpen(true)} data-testid="admin-unlock"><KeyRound size={18} /> Ввести PIN-код</button>
          <p className="mt-3 text-xs text-slate-500">PIN по умолчанию — 1234. Смените его после входа.</p>
        </div>
        {pinOpen && <PinModal onClose={() => setPinOpen(false)} />}
      </div>
    );
  }
  return <AdminPanel />;
}

function Section({ icon, title, children, id }: { icon: React.ReactNode; title: string; children: React.ReactNode; id?: string }) {
  return (
    <section className="card p-4 sm:p-5" id={id}>
      <h2 className="h-display mb-4 flex items-center gap-2 text-lg"><span className="text-volt-400">{icon}</span>{title}</h2>
      {children}
    </section>
  );
}

function AdminPanel() {
  const { state, today, logoutAdmin, renameEmployee, saveSchedule, setOverride, setDeadline, changePin, loadDemo, clearAllHistory, exportData, importData, toast } = useApp();

  // расписание
  const [draft, setDraft] = useState<Assignments>(() => ({ ...assignmentsFor(state, today) }));
  const [from, setFrom] = useState<'today' | 'nextWeek'>('today');
  const missing = state.employees.filter((e) => !Object.values(draft).includes(e.id));
  const nextMonday = addDays(startOfWeek(today), 7);

  // замена на дату
  const [ovDate, setOvDate] = useState<ISODate>(addDays(today, 1));
  const [ovEmp, setOvEmp] = useState(state.employees[0].id);

  // имена
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(state.employees.map((e) => [e.id, e.name])));

  // исправление отметок
  const [fixDate, setFixDate] = useState<ISODate>(today);

  // PIN
  const [pins, setPins] = useState({ cur: '', next: '' });
  const [pinMsg, setPinMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [confirm, setConfirm] = useState<null | 'clear' | 'demo'>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stats = employeeStats(state, today);

  const doExport = () => {
    try {
      const blob = new Blob([exportData()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `office-duty-quest-${today}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('success', 'Резервная копия скачана');
    } catch { toast('error', 'Не удалось создать файл'); }
  };
  const doImport = async (file?: File) => {
    if (!file) return;
    if (file.size > 5_000_000) { toast('error', 'Файл слишком большой'); return; }
    const err = importData(await file.text());
    if (err) toast('error', err);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="h-display flex items-center gap-2 text-2xl"><ShieldCheck className="text-royal-400" /> Администратор</h1>
          <p className="text-sm text-slate-400">Режим включён на этой вкладке браузера</p>
        </div>
        <button className="btn-ghost" onClick={logoutAdmin} data-testid="admin-logout"><LogOut size={16} /> Выйти из режима</button>
      </div>

      <Section icon={<BarChart3 size={18} />} title="Статистика сотрудников">
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[640px] text-left text-sm" data-testid="stats-table">
            <thead><tr className="label border-b border-white/10">
              <th className="py-2 pr-2">Сотрудник</th><th className="px-2">Уровень</th><th className="px-2 text-right">XP</th><th className="px-2 text-right">Дежурств</th>
              <th className="px-2 text-right">Полных</th><th className="px-2 text-right">Пропусков</th><th className="px-2 text-right">Заданий</th><th className="px-2 text-right">Выполнение</th><th className="pl-2 text-right">Награды</th>
            </tr></thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.employee.id} className="border-b border-white/[0.05] last:border-0">
                  <td className="py-2.5 pr-2"><div className="flex items-center gap-2"><Avatar name={s.employee.name} id={s.employee.id} size={28} /><span className="font-semibold text-white">{s.employee.name}</span></div></td>
                  <td className="px-2 text-slate-300">{s.level.name}</td>
                  <td className="px-2 text-right font-display font-bold text-gold">{s.xp}</td>
                  <td className="px-2 text-right">{s.duties}</td>
                  <td className="px-2 text-right text-ok">{s.fullDuties}</td>
                  <td className="px-2 text-right text-bad">{s.missedDuties}</td>
                  <td className="px-2 text-right">{s.tasksDone}</td>
                  <td className="px-2 text-right">{s.duties ? `${s.completionRate}%` : '—'}</td>
                  <td className="pl-2 text-right">{s.achievements}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section icon={<Pencil size={18} />} title="Исправление отметок">
        <label className="mb-4 flex flex-wrap items-center gap-3 text-sm text-slate-300">Дата:
          <input type="date" className="input !w-auto" value={fixDate} max={today} onChange={(e) => e.target.value && setFixDate(e.target.value > today ? today : e.target.value)} aria-label="Дата для исправления" />
          <span className="text-slate-400">{formatLong(fixDate)}</span>
        </label>
        <TaskPanel date={fixDate} showHeader={false} key={fixDate} />
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section icon={<CalendarCog size={18} />} title="Расписание дежурств">
          <div className="space-y-2">
            {WEEKDAYS.map((w, i) => (
              <label key={w} className="flex items-center gap-3">
                <span className="w-28 text-sm text-slate-300">{w}</span>
                <select className="input" value={draft[i]} onChange={(e) => setDraft({ ...draft, [i]: e.target.value })} data-testid={`sched-${i}`} aria-label={`Дежурный: ${w}`}>
                  {state.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </label>
            ))}
          </div>
          {missing.length > 0 && <p className="mt-3 text-xs text-warn">Без дежурства: {missing.map((m) => m.name).join(', ')}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-400">Действует с:</span>
            {([['today', `сегодня (${formatDayMonth(today)})`], ['nextWeek', `следующей недели (${formatDayMonth(nextMonday)})`]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setFrom(k)} aria-pressed={from === k} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${from === k ? 'border-volt bg-volt/15 text-white' : 'border-white/10 text-slate-400'}`}>{l}</button>
            ))}
          </div>
          <button className="btn-primary mt-4 w-full" onClick={() => saveSchedule(draft, from === 'today' ? today : nextMonday)} data-testid="sched-save"><Save size={16} /> Сохранить расписание</button>
          <p className="mt-2 text-xs text-slate-500">Прошлые даты сохраняют прежних дежурных — история не меняется.</p>

          <div className="mt-6 border-t border-white/10 pt-4">
            <p className="mb-2 text-sm font-semibold text-white">Разовая замена на дату</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input type="date" className="input" value={ovDate} min={today} onChange={(e) => e.target.value && setOvDate(e.target.value)} aria-label="Дата замены" />
              <select className="input" value={ovEmp} onChange={(e) => setOvEmp(e.target.value)} aria-label="Кто дежурит">
                {state.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div className="mt-2 flex gap-2">
              <button className="btn-ghost flex-1" onClick={() => setOverride(ovDate, ovEmp)}>Назначить</button>
              <button className="btn-ghost flex-1" onClick={() => setOverride(ovDate, null)}><Undo2 size={15} /> Снять замену</button>
            </div>
            <p className="mt-2 text-xs text-slate-500">Сейчас на {formatDayMonth(ovDate)}: <b className="text-slate-300">{state.employees.find((e) => e.id === assigneeFor(state, ovDate))?.name}</b>{state.overrides[ovDate] ? ' (замена)' : ''}</p>
          </div>
        </Section>

        <div className="space-y-6">
          <Section icon={<Users size={18} />} title="Сотрудники">
            <ul className="space-y-2">
              {state.employees.map((e) => (
                <li key={e.id} className="flex items-center gap-2">
                  <Avatar name={names[e.id] ?? e.name} id={e.id} size={36} />
                  <input className="input" value={names[e.id] ?? ''} maxLength={24} aria-label={`Имя сотрудника ${e.name}`}
                    onChange={(ev) => setNames({ ...names, [e.id]: ev.target.value })}
                    onKeyDown={(ev) => { if (ev.key === 'Enter') renameEmployee(e.id, names[e.id] ?? ''); }} />
                  <button className="btn-ghost !px-3" disabled={!names[e.id]?.trim() || names[e.id].trim() === e.name} onClick={() => renameEmployee(e.id, names[e.id])} aria-label={`Сохранить имя ${e.name}`}><Save size={16} /></button>
                </li>
              ))}
            </ul>
          </Section>

          <Section icon={<Settings size={18} />} title="Настройки и данные">
            <label className="flex items-center justify-between gap-3 text-sm text-slate-300">Срок сдачи дежурства (час, после него сегодняшний день «просрочен»)
              <select className="input !w-24" value={state.settings.deadlineHour} onChange={(e) => setDeadline(Number(e.target.value))} aria-label="Час срока">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </label>

            <form className="mt-5 border-t border-white/10 pt-4" onSubmit={async (e) => {
              e.preventDefault();
              const err = await changePin(pins.cur, pins.next);
              setPinMsg(err ? { ok: false, text: err } : { ok: true, text: 'PIN-код изменён' });
              if (!err) setPins({ cur: '', next: '' });
            }}>
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-white"><KeyRound size={15} /> Сменить PIN-код</p>
              <div className="grid grid-cols-2 gap-2">
                <input className="input" type="password" inputMode="numeric" autoComplete="off" placeholder="Текущий" value={pins.cur} maxLength={8} onChange={(e) => setPins({ ...pins, cur: e.target.value.replace(/\D/g, '') })} aria-label="Текущий PIN" />
                <input className="input" type="password" inputMode="numeric" autoComplete="off" placeholder="Новый (4–8 цифр)" value={pins.next} maxLength={8} onChange={(e) => setPins({ ...pins, next: e.target.value.replace(/\D/g, '') })} aria-label="Новый PIN" />
              </div>
              {pinMsg && <p className={`mt-2 text-xs ${pinMsg.ok ? 'text-ok' : 'text-bad'}`}>{pinMsg.text}</p>}
              <button className="btn-ghost mt-2 w-full" type="submit" disabled={pins.cur.length < 4 || pins.next.length < 4}>Сменить PIN</button>
            </form>

            <div className="mt-5 grid gap-2 border-t border-white/10 pt-4 sm:grid-cols-2">
              <button className="btn-ghost" onClick={doExport}><Download size={16} /> Скачать копию</button>
              <button className="btn-ghost" onClick={() => fileRef.current?.click()}><Upload size={16} /> Восстановить</button>
              <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void doImport(e.target.files?.[0])} />
              <button className="btn-ghost" onClick={() => setConfirm('demo')} data-testid="load-demo"><FlaskConical size={16} /> Демо-история</button>
              <button className="btn-danger" onClick={() => setConfirm('clear')} data-testid="clear-history"><Trash2 size={16} /> Очистить историю</button>
            </div>
          </Section>
        </div>
      </div>

      {confirm === 'clear' && (
        <ConfirmDialog title="Очистить всю историю?" danger confirmLabel="Да, удалить всё"
          text="Будут удалены все отметки, XP и достижения всех сотрудников, а также журнал действий. Это нельзя отменить — сначала можно скачать резервную копию."
          onCancel={() => setConfirm(null)} onConfirm={() => { clearAllHistory(); setConfirm(null); }} />
      )}
      {confirm === 'demo' && (
        <ConfirmDialog title="Загрузить демо-историю?" confirmLabel="Загрузить"
          text="Добавит примерные отметки за последние 3 недели, чтобы увидеть календарь, рейтинг и достижения в работе. Существующие отметки сохранятся."
          onCancel={() => setConfirm(null)} onConfirm={() => { loadDemo(); setConfirm(null); }} />
      )}
    </div>
  );
}
