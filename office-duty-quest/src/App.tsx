import { useEffect, useState } from 'react';
import { CalendarDays, Cloud, CloudOff, Home as HomeIcon, ListChecks, ShieldCheck, Trophy, User, Volume2, VolumeX } from 'lucide-react';
import { AppProvider, TABS, useApp, type Tab } from './store/AppContext';
import { formatLong } from './lib/dates';
import { employeeById } from './lib/state';
import { Avatar } from './components/Avatar';
import { FxLayer } from './components/FxLayer';
import { Logo } from './components/Logo';
import { UserPicker } from './components/UserPicker';
import { Home } from './views/Home';
import { Tasks } from './views/Tasks';
import { Rating } from './views/Rating';
import { History } from './views/History';
import { Admin } from './views/Admin';

const NAV: Record<Tab, { label: string; Icon: typeof HomeIcon }> = {
  home: { label: 'Главная', Icon: HomeIcon },
  tasks: { label: 'Задания', Icon: ListChecks },
  rating: { label: 'Рейтинг', Icon: Trophy },
  history: { label: 'История', Icon: CalendarDays },
  admin: { label: 'Админ', Icon: ShieldCheck },
};

function Shell() {
  const { tab, setTab, today, state, currentEmployeeId, isAdmin, soundOn, setSoundOn, mode, syncError, syncing } = useApp();
  const [picker, setPicker] = useState(false);
  const me = employeeById(state, currentEmployeeId ?? undefined);

  // при первом запуске предлагаем выбрать себя (один раз за сессию)
  useEffect(() => {
    if (currentEmployeeId) return;
    try {
      if (sessionStorage.getItem('odq:picker-shown')) return;
      sessionStorage.setItem('odq:picker-shown', '1');
    } catch { /* ignore */ }
    const t = setTimeout(() => setPicker(true), 600);
    return () => clearTimeout(t);
  }, [currentEmployeeId]);

  return (
    <div className="min-h-screen pb-28 md:pb-10">
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-900/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <button className="flex items-center gap-3" onClick={() => setTab('home')} aria-label="На главную">
            <Logo size={38} />
            <div className="text-left leading-tight">
              <p className="font-display text-[15px] font-extrabold tracking-[0.16em] text-white sm:text-lg" data-testid="app-title">OFFICE DUTY QUEST</p>
              <p className="text-[11px] text-slate-400 sm:text-xs" data-testid="header-date">{formatLong(today)}</p>
            </div>
          </button>

          <nav className="ml-6 hidden items-center gap-1 md:flex" aria-label="Разделы">
            {TABS.map((t) => {
              const { Icon, label } = NAV[t];
              const on = tab === t;
              return (
                <button key={t} onClick={() => setTab(t)} aria-current={on ? 'page' : undefined} data-testid={`tab-${t}`}
                  className={`flex min-h-[40px] items-center gap-2 rounded-xl px-3.5 text-sm font-semibold transition ${on ? 'bg-gradient-to-r from-volt/25 to-royal/25 text-white ring-1 ring-volt/40' : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'}`}>
                  <Icon size={16} />{label}{t === 'admin' && isAdmin && <span className="h-1.5 w-1.5 rounded-full bg-ok" />}
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {mode === 'supabase' && (
              <span title={syncError ? 'Нет связи с облаком' : 'Облако Supabase'} className={`hidden sm:grid h-9 w-9 place-items-center rounded-lg ${syncError ? 'text-bad' : 'text-ok'} ${syncing ? 'animate-pulse' : ''}`}>
                {syncError ? <CloudOff size={17} /> : <Cloud size={17} />}
              </span>
            )}
            <button className="grid h-10 w-10 place-items-center rounded-xl text-slate-400 hover:bg-white/[0.06] hover:text-white" onClick={() => setSoundOn(!soundOn)} aria-label={soundOn ? 'Выключить звук' : 'Включить звук'} aria-pressed={soundOn}>
              {soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
            <button className="flex min-h-[40px] items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 hover:bg-white/[0.08]" onClick={() => setPicker(true)} data-testid="user-chip" aria-label="Выбрать сотрудника">
              {me ? <Avatar name={me.name} id={me.id} size={26} /> : <User size={18} className="text-slate-400" />}
              <span className="hidden max-w-[110px] truncate text-sm font-semibold text-white sm:block">{me ? me.name : 'Войти'}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-5 sm:pt-6" key={tab}>
        <div className="animate-fadeIn">
          {tab === 'home' && <Home />}
          {tab === 'tasks' && <Tasks />}
          {tab === 'rating' && <Rating />}
          {tab === 'history' && <History />}
          {tab === 'admin' && <Admin />}
        </div>
      </main>

      <nav className="safe-b fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.08] bg-ink-900/90 backdrop-blur-xl md:hidden" aria-label="Разделы">
        <div className="mx-auto grid max-w-lg grid-cols-5 px-2 pt-1.5">
          {TABS.map((t) => {
            const { Icon, label } = NAV[t];
            const on = tab === t;
            return (
              <button key={t} onClick={() => setTab(t)} aria-current={on ? 'page' : undefined} data-testid={`mtab-${t}`}
                className={`relative flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition ${on ? 'text-white' : 'text-slate-500'}`}>
                {on && <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-gradient-to-r from-volt to-royal" />}
                <Icon size={21} className={on ? 'text-volt-400' : ''} />{label}
                {t === 'admin' && isAdmin && <span className="absolute right-4 top-2 h-1.5 w-1.5 rounded-full bg-ok" />}
              </button>
            );
          })}
        </div>
      </nav>

      <FxLayer />
      {picker && <UserPicker onClose={() => setPicker(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
