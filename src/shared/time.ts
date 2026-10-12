import { memoize } from './memoize';

export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

export interface LocalDateTime extends LocalDate {
  hour: number;
  minute: number;
}

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export function epochDay({ year, month, day }: LocalDate): number {
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

export function fromEpochDay(days: number): LocalDate {
  const date = new Date(days * DAY_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

export function weekday(days: number): number {
  return (((days + 3) % 7) + 7) % 7;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isRealDate(date: LocalDate): boolean {
  const actual = fromEpochDay(epochDay(date));
  return actual.year === date.year && actual.month === date.month && actual.day === date.day;
}

export function monthIndex({ year, month }: Pick<LocalDate, 'year' | 'month'>): number {
  return year * 12 + month - 1;
}

export function fromMonthIndex(index: number): Pick<LocalDate, 'year' | 'month'> {
  const year = Math.floor(index / 12);
  return { year, month: index - year * 12 + 1 };
}

/** Keeps the day of the month, so the result can be past the end of a shorter month, like February 31. */
export function addMonths(date: LocalDate, months: number): LocalDate {
  return { ...fromMonthIndex(monthIndex(date) + months), day: date.day };
}

export function addMonthsClamped(date: LocalDate, months: number): LocalDate {
  const { year, month, day } = addMonths(date, months);
  return { year, month, day: Math.min(day, daysInMonth(year, month)) };
}

export function wallMs(local: LocalDateTime): number {
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
}

function fromWallMs(ms: number): LocalDateTime {
  const date = new Date(ms);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

function addMinutes(local: LocalDateTime, minutes: number): LocalDateTime {
  return fromWallMs(wallMs(local) + minutes * MINUTE_MS);
}

const formatter = memoize(
  (zone) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    }),
);

export function isTimeZone(zone: string): boolean {
  try {
    formatter(zone);
    return true;
  } catch {
    return false;
  }
}

export function toLocal(instant: number, zone: string): LocalDateTime {
  const parts: Record<string, number> = {};
  for (const { type, value } of formatter(zone).formatToParts(instant)) parts[type] = Number(value);
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 0,
    day: parts.day ?? 0,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
  };
}

function offsetAt(instant: number, zone: string): number {
  return wallMs(toLocal(instant, zone)) - Math.floor(instant / MINUTE_MS) * MINUTE_MS;
}

/** Ambiguous times resolve to the earlier instant; nonexistent ones move forward by the gap, like Temporal's "compatible". */
export function toInstant(local: LocalDateTime, zone: string): number {
  const wall = wallMs(local);
  const before = wall - offsetAt(wall - DAY_MS, zone);
  const after = wall - offsetAt(wall + DAY_MS, zone);
  const valid = [before, after].filter((instant) => wallMs(toLocal(instant, zone)) === wall);
  return valid.length > 0 ? Math.min(...valid) : before;
}

export function wallAtOrAfter(instant: number, zone: string): LocalDateTime {
  const target = Math.ceil(instant / MINUTE_MS) * MINUTE_MS;
  let local = toLocal(target, zone);
  while (toInstant(local, zone) < target) local = addMinutes(local, 1);
  return local;
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

export function formatDate(date: LocalDate): string {
  return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;
}

export function formatClock({ hour, minute }: Pick<LocalDateTime, 'hour' | 'minute'>): string {
  return `${pad(hour)}:${pad(minute)}`;
}

export function formatLocal(local: LocalDateTime): string {
  return `${formatDate(local)}T${formatClock(local)}`;
}

export function parseLocal(text: string): LocalDateTime | null {
  const instant = Date.parse(`${text}:00Z`);
  if (Number.isNaN(instant)) return null;
  const local = fromWallMs(instant);
  return formatLocal(fromWallMs(wallMs(local))) === text ? local : null;
}
