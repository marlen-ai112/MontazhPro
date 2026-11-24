import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ActivityItem, AppState, Mark } from '../types';
import { sanitize } from '../lib/state';
import { diffState } from './diff';
import type { Repository } from './types';

type Row = Record<string, unknown>;

/**
 * Облачное хранилище на Supabase (PostgreSQL). Схема — в supabase/schema.sql.
 * Приложение работает с единым AppState; в базу уходит только разница (diff).
 */
export class SupabaseRepository implements Repository {
  readonly kind = 'supabase' as const;
  private client: SupabaseClient;

  constructor(url: string, anonKey: string) {
    this.client = createClient(url, anonKey, { auth: { persistSession: false } });
  }

  private async must<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>, what: string): Promise<T> {
    const { data, error } = await p;
    if (error) throw new Error(`Supabase (${what}): ${error.message}`);
    return (data ?? ([] as unknown)) as T;
  }

  async load(): Promise<AppState | null> {
    const c = this.client;
    const [emps, sched, ovr, marks, act, settings] = await Promise.all([
      this.must<Row[]>(c.from('employees').select('*').order('position'), 'employees'),
      this.must<Row[]>(c.from('schedule_versions').select('*').order('effective_from'), 'schedule'),
      this.must<Row[]>(c.from('schedule_overrides').select('*'), 'overrides'),
      this.must<Row[]>(c.from('task_marks').select('*'), 'marks'),
      this.must<Row[]>(c.from('activity').select('*').order('at', { ascending: false }).limit(300), 'activity'),
      this.must<Row[]>(c.from('settings').select('*'), 'settings'),
    ]);
    if (!emps.length || !sched.length) return null; // пустая база — приложение создаст демо-данные

    const set = Object.fromEntries(settings.map((r) => [r.key as string, r.value]));
    const state: AppState = {
      version: 1,
      startedOn: (set.startedOn as string) ?? new Date().toISOString().slice(0, 10),
      employees: emps.map((e) => ({ id: e.id as string, name: e.name as string })),
      scheduleVersions: sched.map((v) => ({ from: v.effective_from as string, assignments: v.assignments as Record<number, string> })),
      overrides: Object.fromEntries(ovr.map((o) => [o.date as string, o.employee_id as string])),
      marks: {},
      activity: act.map((a): ActivityItem => ({
        id: a.id as string, at: a.at as string, kind: a.kind as ActivityItem['kind'], actor: a.actor as ActivityItem['actor'],
        date: (a.duty_date as string) ?? undefined, taskId: (a.task_id as string) ?? undefined,
        employeeId: (a.employee_id as string) ?? undefined, detail: (a.detail as string) ?? undefined,
      })),
      settings: { deadlineHour: Number(set.deadlineHour ?? 18), pinHash: (set.pinHash as string) ?? '' },
    };
    for (const m of marks) {
      const d = m.duty_date as string;
      (state.marks[d] ??= {})[m.task_id as string] = { at: m.marked_at as string, by: m.marked_by as Mark['by'], byId: (m.marked_by_id as string) ?? null, late: !!m.late };
    }
    return sanitize(state);
  }

  async save(prev: AppState | null, next: AppState): Promise<void> {
    const ops = diffState(prev, next);
    const c = this.client;
    // порядок важен: сначала справочники, потом зависимые строки
    if (ops.employeesUpsert.length) {
      const pos = new Map(next.employees.map((e, i) => [e.id, i]));
      await this.must(c.from('employees').upsert(ops.employeesUpsert.map((e) => ({ id: e.id, name: e.name, position: pos.get(e.id) }))), 'employees');
    }
    if (ops.scheduleUpsert.length) await this.must(c.from('schedule_versions').upsert(ops.scheduleUpsert.map((v) => ({ effective_from: v.from, assignments: v.assignments }))), 'schedule');
    if (ops.scheduleDelete.length) await this.must(c.from('schedule_versions').delete().in('effective_from', ops.scheduleDelete), 'schedule');
    if (ops.overridesUpsert.length) await this.must(c.from('schedule_overrides').upsert(ops.overridesUpsert), 'overrides');
    if (ops.overridesDelete.length) await this.must(c.from('schedule_overrides').delete().in('date', ops.overridesDelete), 'overrides');
    if (ops.marksUpsert.length) {
      await this.must(c.from('task_marks').upsert(ops.marksUpsert.map((m) => ({
        duty_date: m.duty_date, task_id: m.task_id, marked_at: m.mark.at, marked_by: m.mark.by, marked_by_id: m.mark.byId, late: m.mark.late,
      }))), 'marks');
    }
    for (const m of ops.marksDelete) await this.must(c.from('task_marks').delete().eq('duty_date', m.duty_date).eq('task_id', m.task_id), 'marks');
    if (ops.activityInsert.length) {
      await this.must(c.from('activity').upsert(ops.activityInsert.map((a) => ({
        id: a.id, at: a.at, kind: a.kind, actor: a.actor, duty_date: a.date ?? null, task_id: a.taskId ?? null, employee_id: a.employeeId ?? null, detail: a.detail ?? null,
      }))), 'activity');
    }
    if (ops.activityDelete.length) await this.must(c.from('activity').delete().in('id', ops.activityDelete), 'activity');
    if (ops.settingsUpsert.length) await this.must(c.from('settings').upsert(ops.settingsUpsert), 'settings');
  }
}
