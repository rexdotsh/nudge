import { dueAfterCompletion, dueAt, firstDue, resumed, type Reminder, type ReminderFields } from './reminder';

export type Op =
  | { type: 'put'; id: string; fields: ReminderFields }
  | { type: 'complete'; id: string; due: string }
  | { type: 'skip'; id: string; due: string }
  | { type: 'snooze'; id: string; due: string; until: number }
  | { type: 'reopen'; id: string; due: string; revision: number }
  | { type: 'pause'; id: string; until: number | null }
  | { type: 'resume'; id: string }
  | { type: 'unpause'; id: string; revision: number }
  | { type: 'delete'; id: string }
  | { type: 'restore'; id: string };

export interface Clock {
  now: number;
  zone: string;
}

const sameSchedule = (a: ReminderFields, b: ReminderFields) =>
  a.start === b.start && a.zone === b.zone && JSON.stringify(a.repeat) === JSON.stringify(b.repeat);

const sameAlerts = (a: ReminderFields, b: ReminderFields) => a.alerts.join() === b.alerts.join();

function put(current: Reminder | undefined, id: string, fields: ReminderFields, { now, zone }: Clock): Reminder {
  if (current && sameSchedule(current, fields)) {
    const due = dueAt(current, zone);
    const firedThrough =
      sameAlerts(current, fields) || due === null
        ? current.firedThrough
        : Math.max(current.firedThrough, Math.min(now, due - 1));
    return { ...current, ...fields, firedThrough, revision: current.revision + 1, updatedAt: now };
  }
  const due = firstDue(fields, now, zone);
  return {
    ...fields,
    id,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    deleted: current?.deleted ?? false,
    revision: (current?.revision ?? 0) + 1,
    due,
    missed: 0,
    snoozedUntil: null,
    firedThrough: Math.max(current?.firedThrough ?? now, now),
    completedAt: null,
    paused: fields.repeat && due !== null ? (current?.paused ?? null) : null,
    quietThrough: current?.quietThrough ?? now,
  };
}

function settle(current: Reminder, due: string | null, now: number): Reminder {
  return {
    ...current,
    revision: current.revision + 1,
    due,
    missed: 0,
    snoozedUntil: null,
    firedThrough: Math.max(current.firedThrough, now),
    updatedAt: now,
  };
}

export function applyOp(current: Reminder | undefined, op: Op, clock: Clock): Reminder | null {
  const { now, zone } = clock;
  if (op.type === 'put') return put(current, op.id, op.fields, clock);
  if (!current) return null;
  // A paused series has no current occurrence to act on.
  const isCurrent = (due: string) => current.due === due && current.paused === null;
  switch (op.type) {
    case 'complete':
      if (!isCurrent(op.due)) return null;
      return { ...settle(current, dueAfterCompletion(current, now, zone), now), completedAt: now };
    case 'skip':
      if (!isCurrent(op.due) || !current.repeat) return null;
      return settle(current, dueAfterCompletion(current, now, zone), now);
    case 'snooze':
      if (!isCurrent(op.due)) return null;
      return { ...current, snoozedUntil: op.until, revision: current.revision + 1, updatedAt: now };
    case 'reopen':
      if (current.revision !== op.revision) return null;
      return { ...settle(current, op.due, now), completedAt: null };
    case 'pause':
      if (!current.repeat || current.due === null || (op.until !== null && op.until <= now)) return null;
      return {
        ...current,
        paused: { at: current.paused?.at ?? now, until: op.until },
        revision: current.revision + 1,
        updatedAt: now,
      };
    case 'resume':
      return current.paused ? { ...resumed(current, now, zone), updatedAt: now } : null;
    // Undoes a pause exactly, keeping what came due meanwhile, unless anything changed since.
    case 'unpause':
      if (!current.paused || current.revision !== op.revision) return null;
      return { ...current, paused: null, revision: current.revision + 1, updatedAt: now };
    case 'delete':
    case 'restore':
      return { ...current, deleted: op.type === 'delete', revision: current.revision + 1, updatedAt: now };
    default: {
      const unhandled: never = op;
      return unhandled;
    }
  }
}
