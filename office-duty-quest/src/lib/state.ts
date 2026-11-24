import type {
  ActivityItem, Actor, AppState, Assignments, Employee, ISODate, Mark, ScheduleVersion,
} from '../types';
import { addDays, compareDates, startOfWeek, toISODate, weekdayIndex } from './dates';
import { TASK_IDS, TASKS } from './tasks';

export const SCHEMA_VERSION = 1;
export const ACTIVITY_LIMIT = 300;
export const DEFAULT_EMPLOYEES: Employee[] = [
  { id: 'e-donat', name: 'Донат' },
  { id: 'e-mustafa', name: 'Мустафа' },
  { id: 'e-ziyabek', name: 'Зиябек' },
  { id: 'e-abubakr', name: 'Абубакр' },
  { id: 'e-medet', name: 'Медет' },
  { id: 'e-ramil', name: 'Рамиль' },
  { id: 'e-marlen', name: 'Марлен' },
];

export const uid = (): string => {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch { /* ignore */ }
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
};

export function createSeedState(today: ISODate, pinHash: string): AppState {
  const assignments: Assignments = {};
  DEFAULT_EMPLOYEES.forEach((e, i) => (assignments[i] = e.id));
  return {
    version: 1,
    startedOn: today,
    employees: DEFAULT_EMPLOYEES.map((e) => ({ ...e })),
    scheduleVersions: [{ from: '1970-01-01', assignments }],
    overrides: {},
    marks: {},
    activity: [],
    settings: { deadlineHour: 18, pinHash },
  };
}

// ───────────── Расписание ─────────────

export function assignmentsFor(state: AppState, date: ISODate): Assignments {
  let current = state.scheduleVersions[0];
  for (const v of state.scheduleVersions) {
    if (compareDates(v.from, date) <= 0) current = v;
    else break;
  }
  return current.assignments;
}

/** Id дежурного на дату (с учётом версий расписания и разовых замен) */
export function assigneeFor(state: AppState, date: ISODate): string {
  return state.overrides[date] ?? assignmentsFor(state, date)[weekdayIndex(date)];
}

export function employeeById(state: AppState, id: string | undefined): Employee | undefined {
  return state.employees.find((e) => e.id === id);
}

export function dutyEmployee(state: AppState, date: ISODate): Employee | undefined {
  return employeeById(state, assigneeFor(state, date));
}

/**
 * Новая версия расписания — действует с даты `from`, прошлое не меняется.
 * Дни, по которым уже есть отметки, остаются за прежним дежурным (через разовую замену),
 * чтобы изменение расписания не переносило чужие XP.
 */
export function withSchedule(state: AppState, assignments: Assignments, from: ISODate): AppState {
  const rest = state.scheduleVersions.filter((v) => v.from !== from);
  const next: ScheduleVersion[] = [...rest, { from, assignments: { ...assignments } }].sort((a, b) => compareDates(a.from, b.from));
  // самая ранняя версия покрывает любые прошлые даты
  if (next.length && next[0].from === from && rest.length === 0) next[0] = { from: '1970-01-01', assignments: { ...assignments } };
  const updated: AppState = { ...state, scheduleVersions: next };
  const overrides = { ...state.overrides };
  for (const date of Object.keys(state.marks)) {
    if (compareDates(date, from) < 0 || overrides[date]) continue;
    const before = assigneeFor(state, date);
    if (assigneeFor(updated, date) !== before) overrides[date] = before;
  }
  return { ...updated, overrides };
}

// ───────────── Отметки ─────────────

export type ToggleResult =
  | { ok: true; marked: boolean; completedNow: boolean; uncompleted: boolean; state: AppState }
  | { ok: false; error: string; state: AppState };

export function canEditDuty(state: AppState, actor: Actor | null, date: ISODate, today: ISODate): { ok: true } | { ok: false; reason: string } {
  if (compareDates(date, today) > 0) return { ok: false, reason: 'Дежурство ещё не наступило — отмечать нельзя' };
  if (!actor) return { ok: false, reason: 'Выберите, кто вы, чтобы отмечать задания' };
  if (actor.role === 'admin') return { ok: true };
  const duty = assigneeFor(state, date);
  if (actor.employeeId !== duty) {
    const name = employeeById(state, duty)?.name ?? 'другой сотрудник';
    return { ok: false, reason: `Это дежурство ${name}. Отмечать чужие задания может только администратор` };
  }
  return { ok: true };
}

export function dayDone(state: AppState, date: ISODate): number {
  const m = state.marks[date];
  return m ? TASK_IDS.filter((id) => m[id]).length : 0;
}

export function pushActivity(state: AppState, item: Omit<ActivityItem, 'id' | 'at'>, now: Date): AppState {
  const entry: ActivityItem = { ...item, id: uid(), at: now.toISOString() };
  return { ...state, activity: [entry, ...state.activity].slice(0, ACTIVITY_LIMIT) };
}

export function toggleTask(
  state: AppState,
  p: { date: ISODate; taskId: string; actor: Actor | null; now: Date },
): ToggleResult {
  const today = toISODate(p.now);
  if (!TASK_IDS.includes(p.taskId)) return { ok: false, error: 'Неизвестное задание', state };
  const perm = canEditDuty(state, p.actor, p.date, today);
  if (!perm.ok) return { ok: false, error: perm.reason, state };
  const actor = p.actor as Actor;
  const wasDone = dayDone(state, p.date);
  const dayMarks = { ...(state.marks[p.date] ?? {}) };
  const duty = assigneeFor(state, p.date);
  const marked = !dayMarks[p.taskId];

  if (marked) {
    const mark: Mark = {
      at: p.now.toISOString(),
      by: actor.role,
      byId: actor.role === 'employee' ? actor.employeeId : null,
      late: p.date !== today,
    };
    dayMarks[p.taskId] = mark;
  } else {
    delete dayMarks[p.taskId];
  }
  const marks = { ...state.marks };
  if (Object.keys(dayMarks).length) marks[p.date] = dayMarks;
  else delete marks[p.date];

  let next: AppState = { ...state, marks };
  const nowDone = dayDone(next, p.date);
  const completedNow = marked && wasDone < TASK_IDS.length && nowDone === TASK_IDS.length;
  const uncompleted = !marked && wasDone === TASK_IDS.length;
  next = pushActivity(next, { kind: marked ? 'mark' : 'unmark', date: p.date, taskId: p.taskId, employeeId: duty, actor: actor.role }, p.now);
  if (completedNow) next = pushActivity(next, { kind: 'complete', date: p.date, employeeId: duty, actor: actor.role }, p.now);
  return { ok: true, marked, completedNow, uncompleted, state: next };
}

export function resetDay(state: AppState, date: ISODate, now: Date): AppState {
  if (!state.marks[date]) return state;
  const marks = { ...state.marks };
  delete marks[date];
  return pushActivity({ ...state, marks }, { kind: 'reset', date, employeeId: assigneeFor(state, date), actor: 'admin' }, now);
}

export function renameEmployee(state: AppState, id: string, name: string, now: Date): AppState {
  const clean = name.trim().slice(0, 24);
  if (!clean) return state;
  const old = employeeById(state, id);
  if (!old || old.name === clean) return state;
  const s = { ...state, employees: state.employees.map((e) => (e.id === id ? { ...e, name: clean } : e)) };
  return pushActivity(s, { kind: 'admin', actor: 'admin', detail: `Сотрудник «${old.name}» переименован в «${clean}»` }, now);
}

export function setOverride(state: AppState, date: ISODate, employeeId: string | null, now: Date): AppState {
  const overrides = { ...state.overrides };
  if (employeeId === null) delete overrides[date];
  else overrides[date] = employeeId;
  const who = employeeId ? employeeById(state, employeeId)?.name : 'по расписанию';
  return pushActivity({ ...state, overrides }, { kind: 'admin', actor: 'admin', date, detail: `Замена дежурного на ${date}: ${who}` }, now);
}

// ───────────── Демо-история ─────────────

/** Детерминированный генератор — демо-история всегда одинаковая */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function withDemoHistory(state: AppState, today: ISODate, weeks = 3): AppState {
  const rand = rng(7);
  const start = addDays(startOfWeek(today), -7 * weeks);
  const marks: AppState['marks'] = {};
  const activity: ActivityItem[] = [];
  for (let d = start; compareDates(d, today) < 0; d = addDays(d, 1)) {
    const duty = assigneeFor(state, d);
    const roll = rand();
    // ~55% полностью, ~25% частично, ~20% пропуск
    const count = roll < 0.55 ? TASKS.length : roll < 0.8 ? 1 + Math.floor(rand() * 4) : 0;
    if (!count) continue;
    const [y, m, dd] = d.split('-').map(Number);
    const m2: Record<string, Mark> = {};
    TASKS.slice(0, count).forEach((t, i) => {
      const at = new Date(y, m - 1, dd, 9 + Math.floor(i * 1.6 + rand() * 1.5), Math.floor(rand() * 60), Math.floor(rand() * 60));
      m2[t.id] = { at: at.toISOString(), by: 'employee', byId: duty, late: false };
      activity.push({ id: uid(), at: at.toISOString(), kind: 'mark', date: d, taskId: t.id, employeeId: duty, actor: 'employee' });
    });
    marks[d] = m2;
  }
  activity.sort((a, b) => (a.at < b.at ? 1 : -1));
  return {
    ...state,
    startedOn: compareDates(start, state.startedOn) < 0 ? start : state.startedOn,
    marks: { ...state.marks, ...marks },
    activity: [...activity, ...state.activity].slice(0, ACTIVITY_LIMIT),
  };
}

export function clearHistory(state: AppState, today: ISODate, now: Date): AppState {
  return pushActivity({ ...state, marks: {}, overrides: {}, activity: [], startedOn: today }, { kind: 'admin', actor: 'admin', detail: 'История очищена' }, now);
}

// ───────────── Валидация / миграция ─────────────

export function isAppState(x: unknown): x is AppState {
  const s = x as AppState;
  return !!s && s.version === 1 && Array.isArray(s.employees) && s.employees.length > 0 && Array.isArray(s.scheduleVersions)
    && s.scheduleVersions.length > 0 && typeof s.marks === 'object' && s.marks !== null && Array.isArray(s.activity)
    && typeof s.startedOn === 'string' && !!s.settings && typeof s.settings.pinHash === 'string';
}

/** Чинит возможные пробелы в данных (например, удалённые сотрудники в расписании) */
export function sanitize(state: AppState): AppState {
  const ids = new Set(state.employees.map((e) => e.id));
  const fallback = state.employees[0].id;
  const fix = (a: Assignments): Assignments => {
    const out: Assignments = {};
    for (let i = 0; i < 7; i++) out[i] = ids.has(a[i]) ? a[i] : fallback;
    return out;
  };
  return {
    ...state,
    overrides: state.overrides ?? {},
    scheduleVersions: state.scheduleVersions
      .map((v) => ({ ...v, assignments: fix(v.assignments) }))
      .sort((a, b) => compareDates(a.from, b.from)),
    settings: { ...state.settings, deadlineHour: Number.isFinite(state.settings.deadlineHour) ? state.settings.deadlineHour : 18 },
  };
}
