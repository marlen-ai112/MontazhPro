import type { AppState, DayStatus, Employee, ISODate } from '../types';
import { addDays, compareDates, diffDays, startOfWeek, toISODate, weekDates } from './dates';
import { assigneeFor, dayDone } from './state';
import { TASK_IDS } from './tasks';

export const XP_PER_TASK = 20;
export const XP_DUTY_BONUS = 50;
export const TOTAL_TASKS = TASK_IDS.length;

export const LEVELS = [
  { name: 'Новичок', min: 0 },
  { name: 'Сотрудник порядка', min: 150 },
  { name: 'Специалист', min: 450 },
  { name: 'Профи', min: 900 },
  { name: 'Легенда офиса', min: 1500 },
] as const;

export interface LevelInfo {
  index: number;
  name: string;
  min: number;
  nextName: string | null;
  nextMin: number | null;
  /** 0..1 — прогресс до следующего уровня */
  progress: number;
  toNext: number;
}

export function levelFor(xp: number): LevelInfo {
  let index = 0;
  LEVELS.forEach((l, i) => { if (xp >= l.min) index = i; });
  const cur = LEVELS[index];
  const next = LEVELS[index + 1];
  return {
    index,
    name: cur.name,
    min: cur.min,
    nextName: next?.name ?? null,
    nextMin: next?.min ?? null,
    progress: next ? (xp - cur.min) / (next.min - cur.min) : 1,
    toNext: next ? next.min - xp : 0,
  };
}

// ───────────── День ─────────────

export function dayXp(state: AppState, date: ISODate): number {
  const done = dayDone(state, date);
  return done * XP_PER_TASK + (done === TOTAL_TASKS ? XP_DUTY_BONUS : 0);
}

export const dayPercent = (state: AppState, date: ISODate) => Math.round((dayDone(state, date) / TOTAL_TASKS) * 100);
export const isDayComplete = (state: AppState, date: ISODate) => dayDone(state, date) === TOTAL_TASKS;

export function dayStatus(state: AppState, date: ISODate, today: ISODate): DayStatus {
  const cmp = compareDates(date, today);
  if (cmp > 0) return 'future';
  const done = dayDone(state, date);
  if (done === TOTAL_TASKS) return 'done';
  if (compareDates(date, state.startedOn) < 0 && done === 0) return 'before-start';
  if (done > 0) return 'partial';
  return cmp === 0 ? 'pending' : 'missed';
}

/** Просрочено: прошедший день не закрыт полностью, либо сегодня после дедлайна */
export function isOverdue(state: AppState, date: ISODate, now: Date): boolean {
  const today = toISODate(now);
  if (isDayComplete(state, date)) return false;
  const cmp = compareDates(date, today);
  if (cmp > 0) return false;
  if (cmp < 0) return compareDates(date, state.startedOn) >= 0 || dayDone(state, date) > 0;
  return now.getHours() >= state.settings.deadlineHour;
}

// ───────────── XP и рейтинг ─────────────

/** XP сотрудника за диапазон дат (включительно). Считается из отметок → повторное начисление невозможно */
export function xpFor(state: AppState, employeeId: string, range?: { from: ISODate; to: ISODate }): number {
  let xp = 0;
  for (const date of Object.keys(state.marks)) {
    if (range && (compareDates(date, range.from) < 0 || compareDates(date, range.to) > 0)) continue;
    if (assigneeFor(state, date) === employeeId) xp += dayXp(state, date);
  }
  return xp;
}

export interface RankRow {
  employee: Employee;
  xp: number;
  level: LevelInfo;
  tasks: number;
  fullDuties: number;
  rank: number;
}

export function ranking(state: AppState, scope: 'week' | 'all', weekStart: ISODate): RankRow[] {
  const range = scope === 'week' ? { from: weekStart, to: addDays(weekStart, 6) } : undefined;
  const allXp = (id: string) => xpFor(state, id);
  const rows = state.employees.map((employee) => {
    let tasks = 0;
    let fullDuties = 0;
    for (const date of Object.keys(state.marks)) {
      if (range && (compareDates(date, range.from) < 0 || compareDates(date, range.to) > 0)) continue;
      if (assigneeFor(state, date) !== employee.id) continue;
      const d = dayDone(state, date);
      tasks += d;
      if (d === TOTAL_TASKS) fullDuties++;
    }
    return { employee, xp: xpFor(state, employee.id, range), level: levelFor(allXp(employee.id)), tasks, fullDuties, rank: 0 };
  });
  rows.sort((a, b) => b.xp - a.xp || b.fullDuties - a.fullDuties || a.employee.name.localeCompare(b.employee.name, 'ru'));
  rows.forEach((r, i) => {
    r.rank = i > 0 && rows[i - 1].xp === r.xp ? rows[i - 1].rank : i + 1;
  });
  return rows;
}

export function weekProgress(state: AppState, weekStart: ISODate, today: ISODate) {
  const dates = weekDates(weekStart);
  const counted = dates.filter((d) => compareDates(d, today) <= 0);
  const done = dates.reduce((n, d) => n + dayDone(state, d), 0);
  const fullDays = dates.filter((d) => isDayComplete(state, d)).length;
  return {
    done,
    total: dates.length * TOTAL_TASKS,
    percent: Math.round((done / (dates.length * TOTAL_TASKS)) * 100),
    fullDays,
    elapsedDays: counted.length,
  };
}

// ───────────── Достижения ─────────────

export interface Achievement {
  id: string;
  title: string;
  description: string;
  reward: string;
  unlocked: boolean;
  /** сколько раз получено (для «Мастера порядка» — по неделям) */
  count: number;
}

/** Недели (по понедельнику), в которых сотрудник отдежурил без пропусков и вовремя */
export function masterWeeks(state: AppState, employeeId: string, today: ISODate): ISODate[] {
  const byWeek = new Map<ISODate, { all: boolean }>();
  for (let d = startOfWeek(state.startedOn); compareDates(d, today) <= 0; d = addDays(d, 1)) {
    if (compareDates(d, state.startedOn) < 0 && !state.marks[d]) continue;
    if (assigneeFor(state, d) !== employeeId) continue;
    const w = startOfWeek(d);
    const ok = isDayComplete(state, d) && Object.values(state.marks[d]).every((m) => !m.late);
    const rec = byWeek.get(w) ?? { all: true };
    rec.all = rec.all && ok;
    byWeek.set(w, rec);
  }
  return [...byWeek.entries()].filter(([, r]) => r.all).map(([w]) => w).sort();
}

export function perfectWeeks(state: AppState, today: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const thisWeek = startOfWeek(today);
  for (let w = startOfWeek(state.startedOn); compareDates(w, thisWeek) < 0; w = addDays(w, 7)) {
    if (weekDates(w).every((d) => isDayComplete(state, d))) out.push(w);
  }
  return out;
}

export function achievementsFor(state: AppState, employeeId: string, today: ISODate): Achievement[] {
  const myDates = Object.keys(state.marks).filter((d) => assigneeFor(state, d) === employeeId);
  const totalXp = xpFor(state, employeeId);
  const full = myDates.filter((d) => isDayComplete(state, d));
  const masters = masterWeeks(state, employeeId, today);
  const early = full.filter((d) => {
    const ms = Object.values(state.marks[d]);
    return ms.every((m) => !m.late && new Date(m.at).getHours() < 12);
  });
  let bestStreak = 0, run = 0, prev: ISODate | null = null;
  for (const w of masters) {
    run = prev && diffDays(prev, w) === 7 ? run + 1 : 1;
    bestStreak = Math.max(bestStreak, run);
    prev = w;
  }
  const lvl = levelFor(totalXp).index;
  const mk = (id: string, title: string, description: string, reward: string, count: number): Achievement =>
    ({ id, title, description, reward, count, unlocked: count > 0 });
  return [
    mk('first', 'Первый шаг', 'Отметить своё первое задание', 'Значок «Первый шаг»', myDates.length > 0 ? 1 : 0),
    mk('full', 'Полный комплект', 'Закрыть все 5 заданий за одно дежурство', 'Значок + бонус 50 XP за каждое дежурство', full.length),
    mk('master', 'Мастер порядка', 'Закрыть все задания недели без пропусков и в день дежурства', 'Золотой титул «Мастер порядка»', masters.length),
    mk('early', 'Ранняя пташка', 'Закрыть все 5 заданий до 12:00', 'Значок «Ранняя пташка»', early.length),
    mk('streak', 'Железная дисциплина', '3 недели подряд — «Мастер порядка»', 'Фиолетовая рамка профиля', bestStreak >= 3 ? 1 : 0),
    mk('pro', 'Профи', 'Достичь уровня «Профи» (900 XP)', 'Титул «Профи»', lvl >= 3 ? 1 : 0),
    mk('legend', 'Легенда офиса', 'Достичь максимального уровня (1500 XP)', 'Легендарный статус', lvl >= 4 ? 1 : 0),
  ];
}

export const ACHIEVEMENT_COUNT = 7;

export interface EmployeeStats {
  employee: Employee;
  /** Дежурств с начала учёта (до сегодняшнего дня включительно, только прошедшие и сегодняшнее) */
  duties: number;
  fullDuties: number;
  missedDuties: number;
  tasksDone: number;
  lateMarks: number;
  /** Процент выполненных заданий от всех назначенных за период */
  completionRate: number;
  xp: number;
  level: LevelInfo;
  achievements: number;
}

export function employeeStats(state: AppState, today: ISODate): EmployeeStats[] {
  const acc = new Map(state.employees.map((e) => [e.id, { duties: 0, full: 0, missed: 0, tasks: 0, late: 0 }]));
  const first = Object.keys(state.marks).reduce((m, d) => (compareDates(d, m) < 0 ? d : m), state.startedOn);
  for (let d = first; compareDates(d, today) <= 0; d = addDays(d, 1)) {
    const a = acc.get(assigneeFor(state, d));
    if (!a) continue;
    const done = dayDone(state, d);
    const isPast = compareDates(d, today) < 0;
    if (!isPast && done === 0) continue; // сегодняшний день ещё идёт
    a.duties++;
    a.tasks += done;
    if (done === TOTAL_TASKS) a.full++;
    else if (isPast) a.missed++;
    a.late += Object.values(state.marks[d] ?? {}).filter((m) => m.late).length;
  }
  return state.employees.map((employee) => {
    const a = acc.get(employee.id)!;
    const xp = xpFor(state, employee.id);
    return {
      employee, duties: a.duties, fullDuties: a.full, missedDuties: a.missed, tasksDone: a.tasks, lateMarks: a.late,
      completionRate: a.duties ? Math.round((a.tasks / (a.duties * TOTAL_TASKS)) * 100) : 0,
      xp, level: levelFor(xp), achievements: achievementsFor(state, employee.id, today).filter((x) => x.unlocked).length,
    };
  });
}
