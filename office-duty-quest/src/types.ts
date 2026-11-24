/** Дата в локальном часовом поясе: YYYY-MM-DD */
export type ISODate = string;

export interface Employee {
  id: string;
  name: string;
}

export interface TaskDef {
  id: string;
  title: string;
  hint: string;
}

/** Отметка выполнения одного задания. Её наличие = «выполнено». */
export interface Mark {
  /** Точное время отметки (ISO-8601, UTC) */
  at: string;
  by: 'employee' | 'admin';
  /** Кто отметил (id сотрудника) — null для администратора */
  byId: string | null;
  /** true, если отмечено не в день дежурства (догоняющая отметка) */
  late: boolean;
}

/** День недели (0 = понедельник … 6 = воскресенье) → id сотрудника */
export type Assignments = Record<number, string>;

export interface ScheduleVersion {
  /** Дата, с которой действует эта версия расписания */
  from: ISODate;
  assignments: Assignments;
}

export type ActivityKind = 'mark' | 'unmark' | 'complete' | 'reset' | 'admin';

export interface ActivityItem {
  id: string;
  at: string;
  kind: ActivityKind;
  /** Дата дежурства, к которой относится событие */
  date?: ISODate;
  taskId?: string;
  /** Дежурный, которого касается событие */
  employeeId?: string;
  actor: 'employee' | 'admin' | 'system';
  /** Свободный текст для административных событий */
  detail?: string;
}

export interface Settings {
  /** Час (0–23), после которого незавершённое сегодняшнее дежурство считается просроченным */
  deadlineHour: number;
  /** SHA-256 PIN-кода администратора */
  pinHash: string;
}

export interface AppState {
  version: 1;
  /** Дата начала учёта — раньше неё дежурства не считаются пропущенными */
  startedOn: ISODate;
  employees: Employee[];
  scheduleVersions: ScheduleVersion[];
  /** Разовые замены дежурного на конкретную дату */
  overrides: Record<ISODate, string>;
  /** marks[дата][id задания] */
  marks: Record<ISODate, Record<string, Mark>>;
  activity: ActivityItem[];
  settings: Settings;
}

export type Actor = { role: 'admin' } | { role: 'employee'; employeeId: string };

export type DayStatus = 'future' | 'done' | 'partial' | 'missed' | 'pending' | 'before-start';
