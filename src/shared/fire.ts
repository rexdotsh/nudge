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
  /** Shares its instant with a notice for an earlier occurrence, which keeps the plain fire id. */
  alongside: boolean;
}

interface AlertStep {
  at: number;
  alert: Alert;
  due: string;
}

type Step = { at: number; roll: string } | { at: number; alerts: AlertStep[] };

function alertSteps(reminder: Reminder, due: number, wall: string): AlertStep[] {
  const quietUntil = reminder.snoozedUntil ?? -Infinity;
  const comesUp = Math.max(due, quietUntil);
  const steps: AlertStep[] = [
    ...reminder.alerts.map((minutes): AlertStep => ({ at: due - minutes * MINUTE_MS, alert: 'early', due: wall })),
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

function upcomingEarlySteps(reminder: Reminder, due: number, zone: string): AlertStep[] {
  const quietUntil = reminder.snoozedUntil ?? -Infinity;
  return reminder.alerts.flatMap((minutes) => {
    const lead = minutes * MINUTE_MS - UPCOMING_OFFSET_MS;
    const wall = occurrenceAfter(reminder, Math.max(due, reminder.firedThrough + lead), zone);
    if (wall === null) return [];
    const at = instantOf(reminder, wall, zone) - lead;
    return at >= quietUntil ? [{ at, alert: 'early' as const, due: wall }] : [];
  });
}

// Everything planned for the earliest instant goes together, since firedThrough moving to it passes all of it: an
// occurrence's nag and a later occurrence's early alert, or two later occurrences' early alerts, can share an instant.
// A roll at that instant goes first, on its own, because it changes what is planned.
function earliest(reminder: Reminder, zone: string): Step | null {
  const due = dueAt(reminder, zone);
  if (reminder.deleted || reminder.due === null || due === null) return null;
  const next = occurrenceAfter(reminder, due, zone);
  const roll = next === null ? null : { at: instantOf(reminder, next, zone), roll: next };
  const alerts = [...alertSteps(reminder, due, reminder.due), ...upcomingEarlySteps(reminder, due, zone)];
  const at = Math.min(roll?.at ?? Infinity, ...alerts.map((step) => step.at));
  if (roll && roll.at === at) return roll;
  return at === Infinity ? null : { at, alerts: alerts.filter((step) => step.at === at) };
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
    const consumesSnooze = step.at <= current.firedThrough || step.alerts.some(({ alert }) => alert === 'due');
    if (consumesSnooze && current.snoozedUntil !== null && current.snoozedUntil <= step.at) current.snoozedUntil = null;
    current.firedThrough = Math.max(current.firedThrough, step.at);
    current.revision += 1;
    const first = step.alerts.map(({ due }) => due).toSorted()[0];
    for (const { alert, at, due } of step.alerts) {
      latest.set(due, { alert, at, due, missed: current.missed, alongside: due !== first });
    }
  }
  const live = current.due;
  const notices = [...latest.values()].filter((notice) => live !== null && notice.due >= live);
  return { reminder: current, notices };
}
