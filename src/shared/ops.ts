import { dueAfterCompletion, firstDue, type Reminder, type ReminderFields } from './reminder';

export type Op =
  | { type: 'put'; id: string; fields: ReminderFields }
  | { type: 'complete'; id: string; due: string }
  | { type: 'skip'; id: string; due: string }
  | { type: 'snooze'; id: string; due: string; until: number }
  | { type: 'reopen'; id: string; due: string }
  | { type: 'delete'; id: string }
  | { type: 'restore'; id: string };

export interface Clock {
  now: number;
  zone: string;
}

const sameSchedule = (a: ReminderFields, b: ReminderFields) =>
  a.start === b.start && a.zone === b.zone && JSON.stringify(a.repeat) === JSON.stringify(b.repeat);

function put(current: Reminder | undefined, id: string, fields: ReminderFields, { now, zone }: Clock): Reminder {
  if (current && sameSchedule(current, fields)) {
    return { ...current, ...fields, firedThrough: Math.max(current.firedThrough, now), updatedAt: now };
  }
  return {
    ...fields,
    id,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    deleted: current?.deleted ?? false,
    due: firstDue(fields, now, zone),
    missed: 0,
    snoozedUntil: null,
    firedThrough: Math.max(current?.firedThrough ?? now, now),
    completedAt: null,
  };
}

function settle(current: Reminder, due: string | null, now: number): Reminder {
  return {
    ...current,
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
  switch (op.type) {
    case 'complete':
      if (current.due !== op.due) return null;
      return { ...settle(current, dueAfterCompletion(current, now, zone), now), completedAt: now };
    case 'skip':
      if (current.due !== op.due || !current.repeat) return null;
      return settle(current, dueAfterCompletion(current, now, zone), now);
    case 'snooze':
      if (current.due !== op.due) return null;
      return { ...current, snoozedUntil: op.until, firedThrough: Math.max(current.firedThrough, now), updatedAt: now };
    case 'reopen':
      return { ...settle(current, op.due, now), completedAt: null };
    case 'delete':
    case 'restore':
      return { ...current, deleted: op.type === 'delete', updatedAt: now };
    default: {
      const unhandled: never = op;
      return unhandled;
    }
  }
}
