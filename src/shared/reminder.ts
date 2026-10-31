import { memoize } from './memoize';
import { nextOccurrence } from './occurrences';
import { parseRule, type Frequency } from './rrule';
import {
  HOUR_MS,
  addMonthsClamped,
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

/** A paused series fires nothing from `at`, until `until` or, when that is null, until it is resumed. */
interface Pause {
  at: number;
  until: number | null;
  /** The wall times `at` and `until` stand for, kept from the first zone move on so further moves keep them exactly. */
  atWall?: string;
  untilWall?: string;
}

interface ReminderState {
  revision: number;
  due: string | null;
  missed: number;
  snoozedUntil: number | null;
  firedThrough: number;
  /** Notices after `firedThrough` that fired before a zone move reordered them, as `<due>/<slot>`. */
  alsoFired: string[];
  completedAt: number | null;
  paused: Pause | null;
  /** Nothing planned at or before this is ever shown, even by a device's fallback: it predates the reminder or a pause. */
  quietThrough: number;
}

export interface Reminder extends ReminderFields, ReminderState {
  id: string;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
}

/** A reminder as stored, which may predate pausing. */
export type StoredReminder = Omit<Reminder, 'paused' | 'quietThrough' | 'alsoFired'> &
  Partial<Pick<Reminder, 'paused' | 'quietThrough' | 'alsoFired'>>;

export function fromStored(stored: StoredReminder): Reminder {
  return {
    ...stored,
    paused: stored.paused ?? null,
    quietThrough: stored.quietThrough ?? stored.createdAt,
    alsoFired: stored.alsoFired ?? [],
  };
}

export function fieldsOf({ title, notes, start, zone, repeat, important, alerts }: ReminderFields): ReminderFields {
  return { title, notes, start, zone, repeat, important, alerts };
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

export function occurrenceAfter(fields: ReminderFields, after: number, currentZone: string): string | null {
  if (fields.repeat?.anchor !== 'schedule') return null;
  const schedule = parsedRule(fields.repeat.rule);
  const next = nextOccurrence(schedule, local(fields.start), zoneFor(fields, currentZone), after);
  return next === null ? null : formatLocal(toLocal(next.at, zoneFor(fields, currentZone)));
}

export function firstDue(fields: ReminderFields, now: number, currentZone: string): string | null {
  if (fields.repeat?.anchor !== 'schedule') return fields.start;
  return occurrenceAfter(fields, Math.max(instantOf(fields, fields.start, currentZone), now) - 1, currentZone);
}

export const ADVANCE_DATE: Record<Exclude<Frequency, 'HOURLY'>, (date: LocalDate, amount: number) => LocalDate> = {
  DAILY: (date, amount) => fromEpochDay(epochDay(date) + amount),
  WEEKLY: (date, amount) => fromEpochDay(epochDay(date) + amount * 7),
  MONTHLY: addMonthsClamped,
  YEARLY: (date, amount) => addMonthsClamped(date, amount * 12),
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
  const date = ADVANCE_DATE[freq](toLocal(completedAt, zoneFor(reminder, currentZone)), interval);
  return formatLocal({ year: date.year, month: date.month, day: date.day, hour, minute });
}

export function isSnoozed(reminder: Reminder, now: number): boolean {
  return reminder.snoozedUntil !== null && reminder.snoozedUntil > now;
}

export function snoozeFrom(reminder: Reminder, now: number, zone: string): number {
  return Math.max(now, dueAt(reminder, zone) ?? now);
}

export function shownAt(reminder: Reminder, now: number, currentZone: string): number | null {
  const due = dueAt(reminder, currentZone);
  const { snoozedUntil } = reminder;
  return due !== null && snoozedUntil !== null && snoozedUntil > now ? Math.max(due, snoozedUntil) : due;
}

export function isLate(reminder: Reminder, now: number, currentZone: string): boolean {
  const due = dueAt(reminder, currentZone);
  return due !== null && due <= now && !isSnoozed(reminder, now) && reminder.paused === null;
}

/**
 * Whatever came due while paused is dropped, as if skipped at `at`, so a resumed series is never late and never sends
 * a backlog; an occurrence that was already late when it was paused is left as it was.
 */
export function resumed(reminder: Reminder, at: number, currentZone: string): Reminder {
  const { paused, snoozedUntil } = reminder;
  if (paused === null) return reminder;
  const due = dueAt(reminder, currentZone);
  const first = due !== null && due > paused.at ? reminder.due : occurrenceAfter(reminder, paused.at, currentZone);
  const unpaused = {
    ...reminder,
    paused: null,
    revision: reminder.revision + 1,
    // A snooze is a span of elapsed time and `at` is a real instant, unlike the pause's start, which moves with the
    // wall clock: only a wake-up still ahead survives.
    snoozedUntil: snoozedUntil !== null && snoozedUntil >= at ? snoozedUntil : null,
    firedThrough: Math.max(reminder.firedThrough, at - 1),
    quietThrough: Math.max(reminder.quietThrough, at - 1),
  };
  if (first === null || instantOf(reminder, first, currentZone) >= at) return unpaused;
  // An occurrence exactly at `at` still counts as next, but an interval restarts from the day it resumes.
  const next =
    reminder.repeat?.anchor === 'completion'
      ? dueAfterCompletion(reminder, at, currentZone)
      : occurrenceAfter(reminder, at - 1, currentZone);
  return { ...unpaused, due: next, missed: 0, snoozedUntil: null };
}

export function lateCount(reminders: readonly Reminder[], now: number, currentZone: string): number {
  return reminders.filter((reminder) => !reminder.deleted && isLate(reminder, now, currentZone)).length;
}
