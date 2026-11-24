import type { ISODate } from '../types';

const pad = (n: number) => String(n).padStart(2, '0');

/** Локальная дата → YYYY-MM-DD */
export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYY-MM-DD → Date (локальная полночь) */
export function parseISODate(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = parseISODate(s);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** Индекс дня недели: 0 = понедельник … 6 = воскресенье */
export function weekdayIndex(s: ISODate): number {
  return (parseISODate(s).getDay() + 6) % 7;
}

export function startOfWeek(s: ISODate): ISODate {
  return addDays(s, -weekdayIndex(s));
}

export function weekDates(s: ISODate): ISODate[] {
  const start = startOfWeek(s);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function diffDays(a: ISODate, b: ISODate): number {
  const ms = Date.UTC(...ymd(b)) - Date.UTC(...ymd(a));
  return Math.round(ms / 86400000);
}

function ymd(s: ISODate): [number, number, number] {
  const [y, m, d] = s.split('-').map(Number);
  return [y, m - 1, d];
}

export const WEEKDAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'] as const;
export const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export const weekdayName = (s: ISODate) => WEEKDAYS[weekdayIndex(s)];
export const weekdayShort = (s: ISODate) => WEEKDAYS_SHORT[weekdayIndex(s)];

/** «24 ноября 2026» */
export function formatFull(s: ISODate): string {
  const d = parseISODate(s);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;
}

/** «24 ноября» */
export function formatDayMonth(s: ISODate): string {
  const d = parseISODate(s);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
}

/** «Вторник, 24 ноября 2026» */
export function formatLong(s: ISODate): string {
  return `${weekdayName(s)}, ${formatFull(s)}`;
}

export function monthTitle(year: number, month: number): string {
  return `${MONTHS[month]} ${year}`;
}

/** «24 ноя – 30 ноя 2026» */
export function formatWeekRange(start: ISODate): string {
  const a = parseISODate(start);
  const b = parseISODate(addDays(start, 6));
  const sh = (d: Date) => `${d.getDate()} ${MONTHS_GEN[d.getMonth()].slice(0, 3)}`;
  return `${sh(a)} – ${sh(b)} ${b.getFullYear()}`;
}

/** «14:05» из ISO-метки времени */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** «14:05:09» */
export function formatTimeSec(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** «24.11 14:05» */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function relativeTime(iso: string, now: Date): string {
  const sec = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (sec < 45) return 'только что';
  if (sec < 3600) return `${Math.round(sec / 60)} мин назад`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} ч назад`;
  const days = Math.floor(sec / 86400);
  return days === 1 ? 'вчера' : `${days} дн. назад`;
}
