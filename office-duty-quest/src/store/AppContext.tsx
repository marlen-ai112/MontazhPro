import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Actor, AppState, Assignments, ISODate } from '../types';
import { toISODate } from '../lib/dates';
import { levelFor, XP_DUTY_BONUS, XP_PER_TASK, xpFor } from '../lib/game';
import { DEFAULT_PIN, hashPin, isValidPin, verifyPin } from '../lib/pin';
import { sfx, setSoundEnabled } from '../lib/sound';
import {
  assigneeFor, clearHistory, createSeedState, dutyEmployee, employeeById, isAppState, pushActivity, renameEmployee,
  resetDay as resetDayLogic, sanitize, setOverride as setOverrideLogic, toggleTask as toggleTaskLogic, withDemoHistory, withSchedule,
} from '../lib/state';
import { taskById } from '../lib/tasks';
import { Splash } from '../components/Splash';
import { createRepository, localMirror } from '../storage';
import { LocalRepository } from '../storage/local';
import type { Repository } from '../storage/types';

export type Tab = 'home' | 'tasks' | 'rating' | 'history' | 'admin';
export const TABS: Tab[] = ['home', 'tasks', 'rating', 'history', 'admin'];

export interface Toast { id: number; kind: 'success' | 'error' | 'info' | 'xp'; text: string; sub?: string }
export interface XpFloat { id: number; x: number; y: number; text: string; gold?: boolean }
export interface Victory { employeeId: string; date: ISODate; xp: number; levelUp: string | null }

interface Prefs { employeeId: string | null; sound: boolean; notifiedDate: ISODate | null }
const PREFS_KEY = 'odq:prefs';
const ADMIN_KEY = 'odq:admin-session';

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    return { employeeId: p.employeeId ?? null, sound: p.sound ?? true, notifiedDate: p.notifiedDate ?? null };
  } catch {
    return { employeeId: null, sound: true, notifiedDate: null };
  }
}
function savePrefs(p: Prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

interface Ctx {
  ready: boolean;
  bootError: string | null;
  state: AppState;
  now: Date;
  today: ISODate;
  mode: 'local' | 'supabase';
  syncing: boolean;
  syncError: boolean;

  currentEmployeeId: string | null;
  setCurrentEmployee: (id: string | null) => void;
  isAdmin: boolean;
  actor: Actor | null;
  loginAdmin: (pin: string) => Promise<boolean>;
  logoutAdmin: () => void;

  tab: Tab;
  setTab: (t: Tab) => void;
  selectedDate: ISODate;
  openTasks: (date: ISODate) => void;

  toggleTask: (date: ISODate, taskId: string, origin?: { x: number; y: number }) => void;
  resetDay: (date: ISODate) => void;
  renameEmployee: (id: string, name: string) => void;
  saveSchedule: (a: Assignments, from: ISODate) => void;
  setOverride: (date: ISODate, employeeId: string | null) => void;
  setDeadline: (hour: number) => void;
  changePin: (current: string, next: string) => Promise<string | null>;
  loadDemo: () => void;
  clearAllHistory: () => void;
  exportData: () => string;
  importData: (text: string) => string | null;

  toasts: Toast[];
  toast: (kind: Toast['kind'], text: string, sub?: string) => void;
  dismissToast: (id: number) => void;
  floats: XpFloat[];
  victory: Victory | null;
  closeVictory: () => void;
  soundOn: boolean;
  setSoundOn: (v: boolean) => void;
  dutyBanner: { employeeId: string; mine: boolean } | null;
  dismissDutyBanner: () => void;
}

const AppCtx = createContext<Ctx | null>(null);
export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp вне AppProvider');
  return c;
}

const tabFromHash = (): Tab => {
  const h = window.location.hash.replace('#/', '').replace('#', '') as Tab;
  return TABS.includes(h) ? h : 'home';
};

let nextId = 1;

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [minSplash, setMinSplash] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const [isAdmin, setIsAdmin] = useState(() => { try { return sessionStorage.getItem(ADMIN_KEY) === '1'; } catch { return false; } });
  const [tab, setTabState] = useState<Tab>(tabFromHash);
  const [selectedDate, setSelectedDate] = useState<ISODate>(() => toISODate(new Date()));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [floats, setFloats] = useState<XpFloat[]>([]);
  const [victory, setVictory] = useState<Victory | null>(null);
  const [dutyBanner, setDutyBanner] = useState<Ctx['dutyBanner']>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);

  const repoRef = useRef<Repository | null>(null);
  const stateRef = useRef<AppState | null>(null);
  const syncedRef = useRef<AppState | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const today = toISODate(now);

  // ── тосты ──
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((kind: Toast['kind'], text: string, sub?: string) => {
    const id = nextId++;
    setToasts((t) => [...t.slice(-3), { id, kind, text, sub }]);
    window.setTimeout(() => dismissToast(id), kind === 'error' ? 5200 : 3200);
  }, [dismissToast]);

  // ── время ──
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 15000);
    const onVis = () => setNow(new Date());
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  // ── хранение ──
  const flush = useCallback(() => {
    const repo = repoRef.current;
    if (!repo || repo.kind !== 'supabase') return;
    queueRef.current = queueRef.current.then(async () => {
      const target = stateRef.current;
      if (!target || target === syncedRef.current) return;
      setSyncing(true);
      try {
        await repo.save(syncedRef.current, target);
        syncedRef.current = target;
        setSyncError(false);
      } catch (e) {
        setSyncError(true);
        toast('error', 'Нет связи с облаком — изменения сохранены на устройстве и отправятся позже', (e as Error).message);
      } finally {
        setSyncing(false);
      }
    });
  }, [toast]);

  const commit = useCallback((next: AppState) => {
    const prev = stateRef.current;
    stateRef.current = next;
    setState(next);
    const repo = repoRef.current;
    if (!repo) return;
    if (repo.kind === 'local') {
      repo.save(prev, next).catch((e: Error) => toast('error', 'Ошибка сохранения', e.message));
    } else {
      localMirror.save(prev, next).catch(() => undefined);
      flush();
    }
  }, [flush, toast]);

  // ── загрузка ──
  useEffect(() => {
    let cancelled = false;
    const splashTimer = window.setTimeout(() => setMinSplash(true), 1700);
    (async () => {
      const repo = createRepository();
      repoRef.current = repo;
      let loaded: AppState | null = null;
      let fromCloudFailed = false;
      try {
        loaded = await repo.load();
        if (repo instanceof LocalRepository && repo.recovered) {
          window.setTimeout(() => toast('error', 'Сохранённые данные были повреждены', 'Создана резервная копия, загружены демо-данные'), 2000);
        }
      } catch (e) {
        if (repo.kind === 'supabase') {
          fromCloudFailed = true;
          try { loaded = await localMirror.load(); } catch { /* ignore */ }
          window.setTimeout(() => toast('error', 'Облако недоступно — работаем с локальной копией', (e as Error).message), 2000);
        } else {
          if (!cancelled) setBootError((e as Error).message);
          return;
        }
      }
      let created = false;
      if (!loaded) {
        loaded = createSeedState(toISODate(new Date()), await hashPin(DEFAULT_PIN));
        created = true;
      }
      if (cancelled) return;
      stateRef.current = loaded;
      // облачный режим: считаем облако «синхронизированным» только если оно ответило
      syncedRef.current = repo.kind === 'supabase' && !fromCloudFailed ? (created ? null : loaded) : loaded;
      setState(loaded);
      if (created) {
        if (repo.kind === 'local') repo.save(null, loaded).catch((e: Error) => toast('error', 'Ошибка сохранения', e.message));
        else { localMirror.save(null, loaded).catch(() => undefined); flush(); }
      }
    })();
    return () => { cancelled = true; window.clearTimeout(splashTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // облако: повторная отправка и подтягивание чужих изменений
  useEffect(() => {
    if (!state || repoRef.current?.kind !== 'supabase') return;
    const t = window.setInterval(async () => {
      if (stateRef.current !== syncedRef.current) { flush(); return; }
      try {
        const remote = await repoRef.current!.load();
        if (remote && stateRef.current === syncedRef.current && JSON.stringify(remote) !== JSON.stringify(stateRef.current)) {
          stateRef.current = remote; syncedRef.current = remote; setState(remote);
        }
      } catch { /* сеть пропала — попробуем позже */ }
    }, 20000);
    return () => window.clearInterval(t);
  }, [state === null, flush]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── настройки устройства ──
  const setPrefs = useCallback((patch: Partial<Prefs>) => setPrefsState((p) => { const n = { ...p, ...patch }; savePrefs(n); return n; }), []);
  useEffect(() => { setSoundEnabled(prefs.sound); }, [prefs.sound]);

  // ── навигация ──
  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    try { window.history.pushState(null, '', `#/${t}`); } catch { /* ignore */ }
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const on = () => setTabState(tabFromHash());
    window.addEventListener('hashchange', on);
    window.addEventListener('popstate', on);
    return () => { window.removeEventListener('hashchange', on); window.removeEventListener('popstate', on); };
  }, []);
  const openTasks = useCallback((d: ISODate) => { setSelectedDate(d); setTab('tasks'); }, [setTab]);

  // выбранный день «прилипает» к сегодняшнему при смене даты
  const lastToday = useRef(today);
  useEffect(() => {
    if (lastToday.current !== today) {
      setSelectedDate((d) => (d === lastToday.current ? today : d));
      lastToday.current = today;
    }
  }, [today]);

  // ── сотрудник и админ ──
  const currentEmployeeId = state && prefs.employeeId && employeeById(state, prefs.employeeId) ? prefs.employeeId : null;
  const actor: Actor | null = isAdmin ? { role: 'admin' } : currentEmployeeId ? { role: 'employee', employeeId: currentEmployeeId } : null;

  const loginAdmin = useCallback(async (pin: string) => {
    const s = stateRef.current;
    if (!s) return false;
    const ok = await verifyPin(pin, s.settings.pinHash);
    if (ok) {
      setIsAdmin(true);
      try { sessionStorage.setItem(ADMIN_KEY, '1'); } catch { /* ignore */ }
      toast('success', 'Режим администратора включён');
    }
    return ok;
  }, [toast]);
  const logoutAdmin = useCallback(() => {
    setIsAdmin(false);
    try { sessionStorage.removeItem(ADMIN_KEY); } catch { /* ignore */ }
    toast('info', 'Режим администратора выключен');
    setTabState((t) => (t === 'admin' ? 'home' : t));
  }, [toast]);

  // ── уведомление о новом дежурстве ──
  useEffect(() => {
    if (!state || !minSplash) return;
    if (prefs.notifiedDate === today) return;
    const duty = assigneeFor(state, today);
    const mine = duty === currentEmployeeId;
    setPrefs({ notifiedDate: today });
    setDutyBanner({ employeeId: duty, mine });
    sfx.notify();
    const name = employeeById(state, duty)?.name ?? '';
    toast('info', mine ? 'Сегодня ваше дежурство!' : `Новое дежурство: ${name}`, mine ? 'Выполните 5 заданий и получите XP' : 'Сегодня порядок в офисе — на нём');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state !== null, minSplash, today]);

  // ── действия ──
  const addFloat = useCallback((origin: { x: number; y: number } | undefined, text: string, gold = false) => {
    const id = nextId++;
    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    setFloats((f) => [...f, { id, x, y, text, gold }]);
    window.setTimeout(() => setFloats((f) => f.filter((i) => i.id !== id)), 1400);
  }, []);

  const toggleTask: Ctx['toggleTask'] = useCallback((date, taskId, origin) => {
    const s = stateRef.current;
    if (!s) return;
    const when = new Date();
    const res = toggleTaskLogic(s, { date, taskId, actor, now: when });
    if (!res.ok) { toast('error', res.error); sfx.error(); return; }
    const duty = assigneeFor(s, date);
    const before = levelFor(xpFor(s, duty));
    commit(res.state);
    const after = levelFor(xpFor(res.state, duty));
    const title = taskById(taskId)?.title ?? '';
    if (res.marked) {
      sfx.check();
      addFloat(origin, `+${XP_PER_TASK} XP`);
      toast('success', `Выполнено: ${title}`, `+${XP_PER_TASK} XP · ${dutyEmployee(res.state, date)?.name}`);
    } else {
      sfx.undo();
      toast('info', `Отметка отменена: ${title}`, `−${XP_PER_TASK}${res.uncompleted ? ` и −${XP_DUTY_BONUS} бонус` : ''} XP`);
    }
    if (res.completedNow) {
      const levelUp = after.index > before.index ? after.name : null;
      window.setTimeout(() => {
        sfx.victory();
        addFloat(origin, `+${XP_DUTY_BONUS} XP бонус`, true);
        setVictory({ employeeId: duty, date, xp: XP_PER_TASK * 5 + XP_DUTY_BONUS, levelUp });
        if (levelUp) window.setTimeout(() => sfx.levelUp(), 900);
      }, 350);
    } else if (res.marked && after.index > before.index) {
      sfx.levelUp();
      toast('xp', `Новый уровень: ${after.name}!`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor?.role, (actor as { employeeId?: string } | null)?.employeeId, commit, toast, addFloat]);

  const guardAdmin = () => {
    if (!isAdmin) { toast('error', 'Нужен режим администратора'); return false; }
    return true;
  };

  const resetDay = useCallback((date: ISODate) => {
    if (!guardAdmin() || !stateRef.current) return;
    commit(resetDayLogic(stateRef.current, date, new Date()));
    toast('success', 'Отметки дня сброшены');
    sfx.undo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, commit, toast]);

  const rename = useCallback((id: string, name: string) => {
    if (!guardAdmin() || !stateRef.current) return;
    const next = renameEmployee(stateRef.current, id, name, new Date());
    if (next === stateRef.current) return;
    commit(next);
    toast('success', 'Имя сохранено');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, commit, toast]);

  const saveSchedule = useCallback((a: Assignments, from: ISODate) => {
    if (!guardAdmin() || !stateRef.current) return;
    const s = withSchedule(stateRef.current, a, from);
    commit(pushActivity(s, { kind: 'admin', actor: 'admin', detail: `Расписание обновлено, действует с ${from}` }, new Date()));
    toast('success', 'Расписание сохранено', 'История прошлых дат не изменилась');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, commit, toast]);

  const setOverride = useCallback((date: ISODate, employeeId: string | null) => {
    if (!guardAdmin() || !stateRef.current) return;
    commit(setOverrideLogic(stateRef.current, date, employeeId, new Date()));
    toast('success', employeeId ? 'Дежурный на день заменён' : 'Замена снята');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, commit, toast]);

  const setDeadline = useCallback((hour: number) => {
    if (!guardAdmin() || !stateRef.current) return;
    commit({ ...stateRef.current, settings: { ...stateRef.current.settings, deadlineHour: hour } });
    toast('success', `Срок сдачи дежурства: до ${String(hour).padStart(2, '0')}:00`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, commit, toast]);

  const changePin = useCallback(async (current: string, next: string) => {
    const s = stateRef.current;
    if (!s || !isAdmin) return 'Нужен режим администратора';
    if (!(await verifyPin(current, s.settings.pinHash))) return 'Текущий PIN неверный';
    if (!isValidPin(next)) return 'Новый PIN: от 4 до 8 цифр';
    commit({ ...stateRef.current!, settings: { ...stateRef.current!.settings, pinHash: await hashPin(next) } });
    toast('success', 'PIN-код изменён');
    return null;
  }, [isAdmin, commit, toast]);

  const loadDemo = useCallback(() => {
    if (!guardAdmin() || !stateRef.current) return;
    commit(withDemoHistory(stateRef.current, toISODate(new Date())));
    toast('success', 'Демо-история за 3 недели загружена');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, commit, toast]);

  const clearAllHistory = useCallback(() => {
    if (!guardAdmin() || !stateRef.current) return;
    commit(clearHistory(stateRef.current, toISODate(new Date()), new Date()));
    toast('success', 'История очищена');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, commit, toast]);

  const exportData = useCallback(() => JSON.stringify(stateRef.current, null, 2), []);
  const importData = useCallback((text: string) => {
    if (!guardAdmin()) return 'Нужен режим администратора';
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isAppState(parsed)) return 'Файл не похож на резервную копию Office Duty Quest';
      commit(sanitize(parsed));
      toast('success', 'Данные восстановлены из резервной копии');
      return null;
    } catch {
      return 'Не удалось прочитать файл (неверный JSON)';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, commit, toast]);

  const value = useMemo<Ctx | null>(() => {
    if (!state) return null;
    return {
      ready: minSplash, bootError, state, now, today, mode: repoRef.current?.kind ?? 'local', syncing, syncError,
      currentEmployeeId,
      setCurrentEmployee: (id) => setPrefs({ employeeId: id }),
      isAdmin, actor, loginAdmin, logoutAdmin,
      tab, setTab, selectedDate, openTasks,
      toggleTask, resetDay, renameEmployee: rename, saveSchedule, setOverride, setDeadline, changePin, loadDemo, clearAllHistory, exportData, importData,
      toasts, toast, dismissToast, floats, victory, closeVictory: () => setVictory(null),
      soundOn: prefs.sound, setSoundOn: (v) => setPrefs({ sound: v }),
      dutyBanner, dismissDutyBanner: () => setDutyBanner(null),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, minSplash, bootError, now, syncing, syncError, currentEmployeeId, isAdmin, tab, selectedDate, toasts, floats, victory, prefs.sound, dutyBanner, toggleTask, rename, saveSchedule, setOverride, setDeadline, changePin, loadDemo, clearAllHistory, resetDay]);

  // пока данные не загружены или идёт заставка — показываем только Splash (он не зависит от контекста)
  return (
    <AppCtx.Provider value={value as Ctx}>
      {value && value.ready ? children : <Splash error={bootError} />}
    </AppCtx.Provider>
  );
}
