import { fire, nextFireAt, type FollowUpSetting, type Notice } from '../src/shared/fire';
import { applyOp, type Clock, type Op } from '../src/shared/ops';
import type { Reminder, ReminderFields } from '../src/shared/reminder';
import { parseLocal, toInstant } from '../src/shared/time';

export const ZONE = 'Asia/Kolkata';
export const ID = '01JA0000000000000000000000';
export const daily = { rule: 'FREQ=DAILY', anchor: 'schedule' } as const;

export function at(wall: string, zone = ZONE): number {
  const parsed = parseLocal(wall);
  if (!parsed) throw new Error(wall);
  return toInstant(parsed, zone);
}

export function fields(overrides: Partial<ReminderFields> = {}): ReminderFields {
  return {
    title: 'Water the plants',
    notes: '',
    start: '2026-10-12T09:00',
    zone: null,
    repeat: null,
    important: false,
    alerts: [],
    ...overrides,
  };
}

export function apply(current: Reminder | undefined, op: Op, now: string, zone = ZONE): Reminder {
  const clock: Clock = { now: at(now, zone), zone };
  const next = applyOp(current, op, clock);
  if (!next) throw new Error(`op ${op.type} was rejected`);
  return next;
}

export function create(overrides: Partial<ReminderFields> = {}, now = '2026-10-11T20:00'): Reminder {
  return apply(undefined, { type: 'put', id: ID, fields: fields(overrides) }, now);
}

/** Fires a reminder the way the scheduler does, at each instant it plans, up to `until`. */
export function fireThrough(
  reminder: Reminder,
  until: number,
  zone = ZONE,
  followUp: FollowUpSetting = 'off',
): { reminder: Reminder; notices: Notice[] } {
  const notices: Notice[] = [];
  let current = reminder;
  for (
    let next = nextFireAt(current, zone, followUp);
    next !== null && next <= until;
    next = nextFireAt(current, zone, followUp)
  ) {
    const fired = fire(current, next, zone, followUp);
    notices.push(...fired.notices);
    current = fired.reminder;
  }
  return { reminder: current, notices };
}
