import { memoize } from './memoize';
import { nextOccurrence, parseRule, type Frequency, type Rule } from './rrule';
import {
  HOUR_MS,
  daysInMonth,
  epochDay,
  formatLocal,
  fromEpochDay,
  parseLocal,
  toInstant,
  toLocal,
  wallAtOrAfter,
  type LocalDate,
  type LocalDateTime,
} from './time';

export interface Repeat {
  rule: string;
  anchor: 'schedule' | 'completion';
}

export interface ReminderFields {
  title: string;
  notes: string;
  start: string;
  zone: string | null;
  repeat: Repeat | null;
  important: boolean;
  alerts: number[];
}

interface ReminderState {
  revision: number;
  due: string | null;
  missed: number;
  snoozedUntil: number | null;
  firedThrough: number;
  completedAt: number | null;
}

export interface Reminder extends ReminderFields, ReminderState {
  id: string;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
}

const parsedRule = memoize(parseRule);

export function local(text: string): LocalDateTime {
  const parsed = parseLocal(text);
  if (!parsed) throw new Error(`invalid local date-time ${text}`);
  return parsed;
}

function zoneFor(fields: ReminderFields, currentZone: string): string {
  return fields.zone ?? currentZone;
}

export function instantOf(fields: ReminderFields, wall: string, currentZone: string): number {
  return toInstant(local(wall), zoneFor(fields, currentZone));
}

export function dueAt(reminder: Reminder, currentZone: string): number | null {
  return reminder.due === null ? null : instantOf(reminder, reminder.due, currentZone);
}

function wallOf(fields: ReminderFields, instant: number, currentZone: string): string {
  return formatLocal(toLocal(instant, zoneFor(fields, currentZone)));
}

function scheduleRule(fields: ReminderFields): Rule | null {
  return fields.repeat?.anchor === 'schedule' ? parsedRule(fields.repeat.rule) : null;
}

export function occurrenceAfter(fields: ReminderFields, after: number, currentZone: string): string | null {
  const schedule = scheduleRule(fields);
  if (!schedule) return null;
  const next = nextOccurrence(schedule, local(fields.start), zoneFor(fields, currentZone), after);
  return next === null ? null : wallOf(fields, next, currentZone);
}

export function firstDue(fields: ReminderFields, now: number, currentZone: string): string | null {
  if (!scheduleRule(fields)) return fields.start;
  return occurrenceAfter(fields, Math.max(instantOf(fields, fields.start, currentZone), now) - 1, currentZone);
}

function shiftMonths(date: LocalDate, months: number): LocalDate {
  const index = date.year * 12 + date.month - 1 + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

const ADVANCE: Record<Exclude<Frequency, 'HOURLY'>, (date: LocalDate, amount: number) => LocalDate> = {
  DAILY: (date, amount) => fromEpochDay(epochDay(date) + amount),
  WEEKLY: (date, amount) => fromEpochDay(epochDay(date) + amount * 7),
  MONTHLY: shiftMonths,
  YEARLY: (date, amount) => shiftMonths(date, amount * 12),
};

export function dueAfterCompletion(reminder: Reminder, completedAt: number, currentZone: string): string | null {
  const { repeat } = reminder;
  if (!repeat) return null;
  if (repeat.anchor === 'schedule') {
    const due = dueAt(reminder, currentZone) ?? completedAt;
    return occurrenceAfter(reminder, Math.max(due, completedAt), currentZone);
  }
  const { freq, interval } = parsedRule(repeat.rule);
  if (freq === 'HOURLY') {
    return formatLocal(wallAtOrAfter(completedAt + interval * HOUR_MS, zoneFor(reminder, currentZone)));
  }
  const { hour, minute } = local(reminder.start);
  const date = ADVANCE[freq](toLocal(completedAt, zoneFor(reminder, currentZone)), interval);
  return formatLocal({ year: date.year, month: date.month, day: date.day, hour, minute });
}

export function isSnoozed(reminder: Reminder, now: number): boolean {
  return reminder.snoozedUntil !== null && reminder.snoozedUntil > now;
}

export function shownAt(reminder: Reminder, now: number, currentZone: string): number | null {
  return reminder.snoozedUntil !== null && isSnoozed(reminder, now)
    ? reminder.snoozedUntil
    : dueAt(reminder, currentZone);
}

export function isLate(reminder: Reminder, now: number, currentZone: string): boolean {
  const due = dueAt(reminder, currentZone);
  return due !== null && due <= now && !isSnoozed(reminder, now);
}

export function lateCount(reminders: readonly Reminder[], now: number, currentZone: string): number {
  return reminders.filter((reminder) => !reminder.deleted && isLate(reminder, now, currentZone)).length;
}
