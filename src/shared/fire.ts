import { dueAt, instantOf, occurrenceAfter, type Reminder } from './reminder';
import { MINUTE_MS } from './time';

export const NAG_INTERVAL_MS = 15 * MINUTE_MS;
export const NAG_LIMIT = 8;

type Alert = 'early' | 'due' | 'snoozed' | 'nag';

export interface Notice {
  alert: Alert;
  at: number;
  due: string;
  missed: number;
}

type Step = { at: number; alert: Alert; due: string } | { at: number; roll: string };

const earlySteps = (reminder: Reminder, due: number, wall: string): Step[] =>
  reminder.alerts.map((minutes) => ({ at: due - minutes * MINUTE_MS, alert: 'early', due: wall }));

function alertSteps(reminder: Reminder, due: number, wall: string): Step[] {
  const quietUntil = reminder.snoozedUntil ?? -Infinity;
  const comesUp = Math.max(due, quietUntil);
  const steps: Step[] = [
    ...earlySteps(reminder, due, wall),
    { at: comesUp, alert: comesUp > due ? 'snoozed' : 'due', due: wall },
    ...(reminder.important
      ? Array.from({ length: NAG_LIMIT }, (_, i) => ({
          at: comesUp + (i + 1) * NAG_INTERVAL_MS,
          alert: 'nag' as const,
          due: wall,
        }))
      : []),
  ];
  const eligible = steps.filter((step) => step.at >= quietUntil && step.at > reminder.firedThrough);
  // Flying west can push an occurrence that already notified later than now; a snooze of that notification must
  // still come back, even though it ends before the occurrence's new due time.
  const { snoozedUntil } = reminder;
  if (snoozedUntil !== null && snoozedUntil < due && reminder.firedThrough >= due) {
    eligible.push({ at: snoozedUntil, alert: 'snoozed' });
  }
  return eligible;
}

// An unfinished occurrence only rolls over when the next one is due, so the next one's early alerts have to be
// planned from here or they would be swallowed by the roll.
function earliest(reminder: Reminder, zone: string): Step | null {
  const due = dueAt(reminder, zone);
  if (reminder.deleted || reminder.due === null || due === null) return null;
  const next = occurrenceAfter(reminder, due, zone);
  const steps = alertSteps(reminder, due, reminder.due);
  if (next !== null) {
    const nextAt = instantOf(reminder, next, zone);
    steps.push({ at: nextAt, roll: next });
    steps.push(...earlySteps(reminder, nextAt, next).filter((step) => step.at > reminder.firedThrough));
  }
  let first: Step | null = null;
  for (const step of steps) {
    if (!first || step.at < first.at || (step.at === first.at && 'roll' in step)) first = step;
  }
  return first;
}

export function nextFireAt(reminder: Reminder, zone: string): number | null {
  return earliest(reminder, zone)?.at ?? null;
}

export function fire(reminder: Reminder, now: number, zone: string): { reminder: Reminder; notice: Notice | null } {
  const current = { ...reminder };
  let notice: Notice | null = null;
  for (let step = earliest(current, zone); step && step.at <= now; step = earliest(current, zone)) {
    if ('roll' in step) {
      current.due = step.roll;
      current.missed += 1;
      current.revision += 1;
      if (current.snoozedUntil !== null && current.snoozedUntil <= step.at) current.snoozedUntil = null;
      continue;
    }
    const consumesSnooze = step.at <= current.firedThrough || step.alert === 'due';
    if (consumesSnooze && current.snoozedUntil !== null && current.snoozedUntil <= step.at) current.snoozedUntil = null;
    current.firedThrough = Math.max(current.firedThrough, step.at);
    current.revision += 1;
    notice = { alert: step.alert, at: step.at, due: step.due, missed: current.missed };
  }
  return { reminder: current, notice };
}
