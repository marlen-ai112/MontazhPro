import { describe, expect, it } from 'vitest';
import type { Actor, AppState } from '../types';
import { diffState } from '../storage/diff';
import { addDays, startOfWeek, toISODate, weekdayIndex } from './dates';
import { achievementsFor, dayStatus, dayXp, isOverdue, levelFor, masterWeeks, ranking, xpFor } from './game';
import { assigneeFor, createSeedState, resetDay, setOverride, toggleTask, withDemoHistory, withSchedule } from './state';
import { TASK_IDS } from './tasks';

// вторник 24 ноября 2026 — дежурит Мустафа
const NOW = new Date(2026, 10, 24, 11, 30, 0);
const TODAY = toISODate(NOW);
const seed = (): AppState => createSeedState(addDays(TODAY, -30), 'h');
const admin: Actor = { role: 'admin' };
const emp = (id: string): Actor => ({ role: 'employee', employeeId: id });

function mark(s: AppState, date: string, ids: string[], actor: Actor, now = NOW) {
  let cur = s;
  for (const taskId of ids) {
    const r = toggleTask(cur, { date, taskId, actor, now });
    if (!r.ok) throw new Error(r.error);
    cur = r.state;
  }
  return cur;
}

describe('расписание', () => {
  it('Пн–Вс: Донат, Мустафа, Зиябек, Абубакр, Медет, Рамиль, Марлен', () => {
    const s = seed();
    const names = Array.from({ length: 7 }, (_, i) => s.employees.find((e) => e.id === assigneeFor(s, addDays('2026-11-23', i)))!.name);
    expect(names).toEqual(['Донат', 'Мустафа', 'Зиябек', 'Абубакр', 'Медет', 'Рамиль', 'Марлен']);
    expect(weekdayIndex(TODAY)).toBe(1);
  });
  it('новая версия расписания не меняет прошлые даты', () => {
    const s = seed();
    const past = addDays(TODAY, -7);
    const before = assigneeFor(s, past);
    const a = { ...s.scheduleVersions[0].assignments, 1: 'e-donat' };
    const s2 = withSchedule(s, a, TODAY);
    expect(assigneeFor(s2, TODAY)).toBe('e-donat');
    expect(assigneeFor(s2, past)).toBe(before);
    expect(assigneeFor(s2, addDays(TODAY, 7))).toBe('e-donat');
  });
  it('смена расписания не переносит XP за день, где уже есть отметки', () => {
    const s = mark(seed(), TODAY, ['toilet'], emp('e-mustafa'));
    const s2 = withSchedule(s, { ...s.scheduleVersions[0].assignments, 1: 'e-donat' }, TODAY);
    expect(assigneeFor(s2, TODAY)).toBe('e-mustafa');
    expect(xpFor(s2, 'e-mustafa')).toBe(20);
    expect(assigneeFor(s2, addDays(TODAY, 7))).toBe('e-donat');
  });
  it('разовая замена', () => {
    const s = setOverride(seed(), TODAY, 'e-marlen', NOW);
    expect(assigneeFor(s, TODAY)).toBe('e-marlen');
    expect(assigneeFor(setOverride(s, TODAY, null, NOW), TODAY)).toBe('e-mustafa');
  });
});

describe('отметки и права', () => {
  it('дежурный отмечает своё, чужое — нельзя', () => {
    const s = seed();
    expect(toggleTask(s, { date: TODAY, taskId: 'toilet', actor: emp('e-mustafa'), now: NOW }).ok).toBe(true);
    const bad = toggleTask(s, { date: TODAY, taskId: 'toilet', actor: emp('e-donat'), now: NOW });
    expect(bad.ok).toBe(false);
    expect(toggleTask(s, { date: TODAY, taskId: 'toilet', actor: null, now: NOW }).ok).toBe(false);
  });
  it('админ может править любые дни, будущее — нельзя никому', () => {
    const s = seed();
    expect(toggleTask(s, { date: addDays(TODAY, -3), taskId: 'dishes', actor: admin, now: NOW }).ok).toBe(true);
    expect(toggleTask(s, { date: addDays(TODAY, 1), taskId: 'dishes', actor: admin, now: NOW }).ok).toBe(false);
    expect(toggleTask(s, { date: 'bad', taskId: 'nope', actor: admin, now: NOW }).ok).toBe(false);
  });
  it('время отметки сохраняется, повторный клик отменяет', () => {
    let s = mark(seed(), TODAY, ['kitchen'], emp('e-mustafa'));
    expect(s.marks[TODAY].kitchen.at).toBe(NOW.toISOString());
    expect(s.marks[TODAY].kitchen.late).toBe(false);
    s = mark(s, TODAY, ['kitchen'], emp('e-mustafa'));
    expect(s.marks[TODAY]).toBeUndefined();
  });
  it('отметка в другой день помечается late', () => {
    const d = addDays(TODAY, -1);
    const s = mark(seed(), d, ['kitchen'], emp(assigneeFor(seed(), d)));
    expect(s.marks[d].kitchen.late).toBe(true);
  });
  it('сброс дня', () => {
    const s = resetDay(mark(seed(), TODAY, TASK_IDS, emp('e-mustafa')), TODAY, NOW);
    expect(s.marks[TODAY]).toBeUndefined();
    expect(xpFor(s, 'e-mustafa')).toBe(0);
  });
});

describe('XP', () => {
  it('20 за задание, +50 за все пять', () => {
    let s = mark(seed(), TODAY, TASK_IDS.slice(0, 3), emp('e-mustafa'));
    expect(xpFor(s, 'e-mustafa')).toBe(60);
    s = mark(s, TODAY, TASK_IDS.slice(3), emp('e-mustafa'));
    expect(xpFor(s, 'e-mustafa')).toBe(150);
    expect(dayXp(s, TODAY)).toBe(150);
  });
  it('нельзя накрутить: отмена и повтор не меняют итог', () => {
    let s = seed();
    for (let i = 0; i < 5; i++) s = mark(s, TODAY, ['toilet'], emp('e-mustafa'));
    expect(xpFor(s, 'e-mustafa')).toBe(20);
    const full = mark(seed(), TODAY, TASK_IDS, emp('e-mustafa'));
    expect(xpFor(full, 'e-mustafa')).toBe(150);
    const undone = mark(full, TODAY, ['toilet'], emp('e-mustafa'));
    expect(xpFor(undone, 'e-mustafa')).toBe(80);
  });
  it('completedNow срабатывает ровно один раз', () => {
    let s = mark(seed(), TODAY, TASK_IDS.slice(0, 4), emp('e-mustafa'));
    const r = toggleTask(s, { date: TODAY, taskId: 'self', actor: emp('e-mustafa'), now: NOW });
    expect(r.ok && r.completedNow).toBe(true);
    s = (r as { state: AppState }).state;
    const again = toggleTask(s, { date: TODAY, taskId: 'self', actor: emp('e-mustafa'), now: NOW });
    expect(again.ok && again.completedNow).toBe(false);
  });
  it('перезагрузка (JSON туда-обратно) не меняет XP', () => {
    const s = mark(seed(), TODAY, TASK_IDS, emp('e-mustafa'));
    const copy = JSON.parse(JSON.stringify(s)) as AppState;
    expect(xpFor(copy, 'e-mustafa')).toBe(xpFor(s, 'e-mustafa'));
  });
  it('уровни', () => {
    expect(levelFor(0).name).toBe('Новичок');
    expect(levelFor(150).name).toBe('Сотрудник порядка');
    expect(levelFor(449).name).toBe('Сотрудник порядка');
    expect(levelFor(450).name).toBe('Специалист');
    expect(levelFor(900).name).toBe('Профи');
    expect(levelFor(1500).name).toBe('Легенда офиса');
    expect(levelFor(5000).progress).toBe(1);
  });
});

describe('статусы, просрочка, рейтинг', () => {
  it('цвета календаря', () => {
    let s = seed();
    const y = addDays(TODAY, -1);
    expect(dayStatus(s, y, TODAY)).toBe('missed');
    expect(dayStatus(s, TODAY, TODAY)).toBe('pending');
    expect(dayStatus(s, addDays(TODAY, 1), TODAY)).toBe('future');
    expect(dayStatus(s, addDays(TODAY, -40), TODAY)).toBe('before-start');
    s = mark(s, y, ['toilet'], admin);
    expect(dayStatus(s, y, TODAY)).toBe('partial');
    s = mark(s, y, TASK_IDS.slice(1), admin);
    expect(dayStatus(s, y, TODAY)).toBe('done');
  });
  it('просрочено: прошлый неполный день и сегодня после дедлайна', () => {
    const s = seed();
    expect(isOverdue(s, addDays(TODAY, -1), NOW)).toBe(true);
    expect(isOverdue(s, TODAY, NOW)).toBe(false);
    expect(isOverdue(s, TODAY, new Date(2026, 10, 24, 18, 0))).toBe(true);
    expect(isOverdue(mark(s, TODAY, TASK_IDS, admin), TODAY, new Date(2026, 10, 24, 20, 0))).toBe(false);
    expect(isOverdue(s, addDays(TODAY, 1), NOW)).toBe(false);
  });
  it('рейтинг недели и всего времени', () => {
    let s = mark(seed(), TODAY, TASK_IDS, emp('e-mustafa'));
    const lastWeek = addDays(startOfWeek(TODAY), -7); // Донат
    s = mark(s, lastWeek, TASK_IDS.slice(0, 2), admin);
    const week = ranking(s, 'week', startOfWeek(TODAY));
    expect(week[0].employee.id).toBe('e-mustafa');
    expect(week[0].xp).toBe(150);
    const all = ranking(s, 'all', startOfWeek(TODAY));
    expect(all.find((r) => r.employee.id === 'e-donat')!.xp).toBe(40);
    expect(week.find((r) => r.employee.id === 'e-donat')!.xp).toBe(0);
  });
});

describe('достижения', () => {
  it('Мастер порядка: дежурство закрыто полностью и в день дежурства', () => {
    let s = seed();
    expect(masterWeeks(s, 'e-mustafa', TODAY)).toHaveLength(0);
    s = mark(s, TODAY, TASK_IDS, emp('e-mustafa'));
    expect(masterWeeks(s, 'e-mustafa', TODAY)).toEqual([startOfWeek(TODAY)]);
    const a = achievementsFor(s, 'e-mustafa', TODAY);
    expect(a.find((x) => x.id === 'master')!.unlocked).toBe(true);
    expect(a.find((x) => x.id === 'full')!.unlocked).toBe(true);
    expect(a.find((x) => x.id === 'early')!.unlocked).toBe(true); // 11:30 < 12:00
  });
  it('закрытие «задним числом» мастера не даёт', () => {
    const d = addDays(TODAY, -1);
    const s = mark(seed(), d, TASK_IDS, admin);
    expect(masterWeeks(s, assigneeFor(s, d), TODAY)).toHaveLength(0);
  });
  it('демо-история детерминирована и не пересекается с сегодняшним днём', () => {
    const a = withDemoHistory(seed(), TODAY);
    const b = withDemoHistory(seed(), TODAY);
    expect(Object.keys(a.marks).sort()).toEqual(Object.keys(b.marks).sort());
    expect(a.marks[TODAY]).toBeUndefined();
    expect(Object.keys(a.marks).length).toBeGreaterThan(5);
  });
});

describe('diff для облака', () => {
  it('сообщает только об изменениях', () => {
    const s = seed();
    const next = mark(s, TODAY, ['toilet'], emp('e-mustafa'));
    const ops = diffState(s, next);
    expect(ops.marksUpsert).toHaveLength(1);
    expect(ops.marksDelete).toHaveLength(0);
    expect(ops.activityInsert).toHaveLength(1);
    expect(ops.employeesUpsert).toHaveLength(0);
    const back = diffState(next, s);
    expect(back.marksDelete).toEqual([{ duty_date: TODAY, task_id: 'toilet' }]);
    expect(diffState(null, s).employeesUpsert).toHaveLength(7);
  });
});
