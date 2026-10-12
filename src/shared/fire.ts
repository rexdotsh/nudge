import { dueAt, instantOf, occurrenceAfter, type Reminder } from './reminder';
import { HOUR_MS, MINUTE_MS } from './time';

export const NAG_INTERVAL_MS = 5 * MINUTE_MS;
export const NAG_LIMIT = (2 * HOUR_MS) / NAG_INTERVAL_MS;

type Alert = 'early' | 'due' | 'snoozed' | 'nag';

export interface Notice {
  alert: Alert;
  at: number;
  due: string;
  missed: number;
}

type Step = { at: number; alert: Alert; due: string } | { at: number; roll: string };

function alertSteps(reminder: Reminder, due: number, wall: string): Step[] {
  const quietUntil = reminder.snoozedUntil ?? -Infinity;
  const comesUp = Math.max(due, quietUntil);
  const steps: Step[] = [
    ...reminder.alerts.map((minutes): Step => ({ at: due - minutes * MINUTE_MS, alert: 'early', due: wall })),
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
    eligible.push({ at: snoozedUntil, alert: 'snoozed', due: wall });
  }
  return eligible;
}

// Later occurrences need their early alerts before the current one rolls over. The millisecond offset keeps a shared
// minute (today's due and tomorrow's 24-hour alert) from being swallowed by the single firedThrough watermark.
const UPCOMING_OFFSET_MS = 1;

function upcomingEarlySteps(reminder: Reminder, due: number, zone: string): Step[] {
  const quietUntil = reminder.snoozedUntil ?? -Infinity;
  return reminder.alerts.flatMap((minutes) => {
    const lead = minutes * MINUTE_MS - UPCOMING_OFFSET_MS;
    const wall = occurrenceAfter(reminder, Math.max(due, reminder.firedThrough + lead), zone);
    if (wall === null) return [];
    const at = instantOf(reminder, wall, zone) - lead;
    return at >= quietUntil ? [{ at, alert: 'early' as const, due: wall }] : [];
  });
}

function earliest(reminder: Reminder, zone: string): Step | null {
  const due = dueAt(reminder, zone);
  if (reminder.deleted || reminder.due === null || due === null) return null;
  const next = occurrenceAfter(reminder, due, zone);
  const steps = [...alertSteps(reminder, due, reminder.due), ...upcomingEarlySteps(reminder, due, zone)];
  if (next !== null) steps.push({ at: instantOf(reminder, next, zone), roll: next });
  let first: Step | null = null;
  for (const step of steps) {
    if (!first || step.at < first.at || (step.at === first.at && 'roll' in step)) first = step;
  }
  return first;
}

export function nextFireAt(reminder: Reminder, zone: string): number | null {
  return earliest(reminder, zone)?.at ?? null;
}

// A late run sends at most one notice per occurrence (the latest step), not a burst, and only for occurrences that are
// still current or upcoming; ones it rolled past are not announced.
export function fire(reminder: Reminder, now: number, zone: string): { reminder: Reminder; notices: Notice[] } {
  const current = { ...reminder };
  const latest = new Map<string, Notice>();
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
    latest.set(step.due, { alert: step.alert, at: step.at, due: step.due, missed: current.missed });
  }
  const live = current.due;
  const notices = [...latest.values()].filter((notice) => live !== null && notice.due >= live);
  return { reminder: current, notices };
}
