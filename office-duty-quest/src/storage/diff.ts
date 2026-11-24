import type { ActivityItem, AppState, Employee, Mark, ScheduleVersion } from '../types';

/** Операции над таблицами Supabase, вычисленные как разница между двумя состояниями */
export interface SyncOps {
  employeesUpsert: Employee[];
  scheduleUpsert: ScheduleVersion[];
  scheduleDelete: string[];
  overridesUpsert: { date: string; employee_id: string }[];
  overridesDelete: string[];
  marksUpsert: { duty_date: string; task_id: string; mark: Mark }[];
  marksDelete: { duty_date: string; task_id: string }[];
  activityInsert: ActivityItem[];
  activityDelete: string[];
  settingsUpsert: { key: string; value: unknown }[];
  startedOnChanged: boolean;
}

const flat = (s: AppState) => {
  const m = new Map<string, { duty_date: string; task_id: string; mark: Mark }>();
  for (const [d, tasks] of Object.entries(s.marks)) for (const [t, mark] of Object.entries(tasks)) m.set(`${d}|${t}`, { duty_date: d, task_id: t, mark });
  return m;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function diffState(prev: AppState | null, next: AppState): SyncOps {
  const p: AppState | null = prev;
  const ops: SyncOps = {
    employeesUpsert: [], scheduleUpsert: [], scheduleDelete: [], overridesUpsert: [], overridesDelete: [],
    marksUpsert: [], marksDelete: [], activityInsert: [], activityDelete: [], settingsUpsert: [], startedOnChanged: false,
  };

  const pe = new Map((p?.employees ?? []).map((e) => [e.id, e]));
  ops.employeesUpsert = next.employees.filter((e) => !same(pe.get(e.id), e));

  const ps = new Map((p?.scheduleVersions ?? []).map((v) => [v.from, v]));
  const ns = new Map(next.scheduleVersions.map((v) => [v.from, v]));
  ops.scheduleUpsert = next.scheduleVersions.filter((v) => !same(ps.get(v.from), v));
  ops.scheduleDelete = [...ps.keys()].filter((k) => !ns.has(k));

  const po = p?.overrides ?? {};
  ops.overridesUpsert = Object.entries(next.overrides).filter(([d, e]) => po[d] !== e).map(([date, employee_id]) => ({ date, employee_id }));
  ops.overridesDelete = Object.keys(po).filter((d) => !(d in next.overrides));

  const pm = p ? flat(p) : new Map();
  const nm = flat(next);
  for (const [k, v] of nm) if (!same(pm.get(k)?.mark, v.mark)) ops.marksUpsert.push(v);
  for (const [k, v] of pm) if (!nm.has(k)) ops.marksDelete.push({ duty_date: v.duty_date, task_id: v.task_id });

  const pa = new Set((p?.activity ?? []).map((a) => a.id));
  const na = new Set(next.activity.map((a) => a.id));
  ops.activityInsert = next.activity.filter((a) => !pa.has(a.id));
  ops.activityDelete = [...pa].filter((id) => !na.has(id));

  if (!p || p.settings.deadlineHour !== next.settings.deadlineHour) ops.settingsUpsert.push({ key: 'deadlineHour', value: next.settings.deadlineHour });
  if (!p || p.settings.pinHash !== next.settings.pinHash) ops.settingsUpsert.push({ key: 'pinHash', value: next.settings.pinHash });
  if (!p || p.startedOn !== next.startedOn) { ops.startedOnChanged = true; ops.settingsUpsert.push({ key: 'startedOn', value: next.startedOn }); }
  return ops;
}
