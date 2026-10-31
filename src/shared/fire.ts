import { dueAt, instantOf, local, occurrenceAfter, resumed, type Reminder } from './reminder';
import { DAY_MS, HOUR_MS, MINUTE_MS, formatLocal, toInstant, toLocal } from './time';

export const NAG_INTERVAL_MS = 5 * MINUTE_MS;
export const NAG_LIMIT = (2 * HOUR_MS) / NAG_INTERVAL_MS;

type Alert = 'early' | 'due' | 'snoozed' | 'nag';

export interface Notice {
  alert: Alert;
  at: number;
  due: string;
  missed: number;
  /**
   * Where the notice sits in its occurrence, the same in every zone: its distance from the due time, or, for what a
   * snooze brings back, its instant. With the reminder and the due wall time it names the notice wherever it is planned.
   */
  slot: string;
}

interface AlertStep {
  at: number;
  alert: Alert;
  due: string;
  slot: string;
}

type Step = { at: number; roll: string } | { at: number; resume: true } | { at: number; alerts: AlertStep[] };

const slotKey = ({ due, slot }: Pick<AlertStep, 'due' | 'slot'>) => `${due}/${slot}`;

function consumed(reminder: Reminder, step: AlertStep): boolean {
  return step.at <= reminder.firedThrough || reminder.alsoFired.includes(slotKey(step));
}

/** Every notice the current occurrence can have, fired or not, a snooze's included. */
function occurrenceSteps(reminder: Reminder, due: number, wall: string): AlertStep[] {
  const quietUntil = reminder.snoozedUntil ?? -Infinity;
  const comesUp = Math.max(due, quietUntil);
  const slot = (at: number) => (comesUp > due && at >= comesUp ? `@${at}` : String(at - due));
  const planned = (at: number, alert: Alert): AlertStep => ({ at, alert, due: wall, slot: slot(at) });
  return [
    ...reminder.alerts.map((minutes) => planned(due - minutes * MINUTE_MS, 'early')),
    planned(comesUp, comesUp > due ? 'snoozed' : 'due'),
    ...(reminder.important
      ? Array.from({ length: NAG_LIMIT }, (_, i) => planned(comesUp + (i + 1) * NAG_INTERVAL_MS, 'nag'))
      : []),
  ];
}

function alertSteps(reminder: Reminder, due: number, wall: string): AlertStep[] {
  const quietUntil = reminder.snoozedUntil ?? -Infinity;
  const steps = occurrenceSteps(reminder, due, wall);
  const eligible = steps.filter((step) => step.at >= quietUntil && !consumed(reminder, step));
  // Flying west can push an occurrence that already notified later than now; a snooze of that notification must
  // still come back, even though it ends before the occurrence's new due time.
  const { snoozedUntil } = reminder;
  const dueStep = steps.find((step) => step.alert === 'due');
  if (snoozedUntil !== null && snoozedUntil < due && dueStep && consumed(reminder, dueStep)) {
    const snoozed: AlertStep = { at: snoozedUntil, alert: 'snoozed', due: wall, slot: `@${snoozedUntil}` };
    if (!reminder.alsoFired.includes(slotKey(snoozed))) eligible.push(snoozed);
  }
  return eligible;
}

function earlyStep(reminder: Reminder, wall: string, minutes: number, zone: string): AlertStep {
  const lead = minutes * MINUTE_MS;
  return { at: instantOf(reminder, wall, zone) - lead, alert: 'early', due: wall, slot: String(-lead) };
}

// Later occurrences need their early alerts before the current one rolls over.
function upcomingEarlySteps(reminder: Reminder, due: number, zone: string): AlertStep[] {
  const quietUntil = reminder.snoozedUntil ?? -Infinity;
  return reminder.alerts.flatMap((minutes) => {
    let wall = occurrenceAfter(reminder, Math.max(due, reminder.firedThrough + minutes * MINUTE_MS), zone);
    while (wall !== null && consumed(reminder, earlyStep(reminder, wall, minutes, zone))) {
      wall = occurrenceAfter(reminder, instantOf(reminder, wall, zone), zone);
    }
    const step = wall === null ? null : earlyStep(reminder, wall, minutes, zone);
    return step && step.at >= quietUntil ? [step] : [];
  });
}

// Everything planned for the earliest instant goes together, since firedThrough moving to it passes all of it: today's
// due and tomorrow's one-day alert, a nag and a later occurrence's early alert, or two later occurrences' early alerts
// can share an instant. A roll at that instant goes first, on its own, because it changes what is planned.
function earliest(reminder: Reminder, zone: string): Step | null {
  const due = dueAt(reminder, zone);
  if (reminder.deleted || reminder.due === null || due === null) return null;
  if (reminder.paused) return reminder.paused.until === null ? null : { at: reminder.paused.until, resume: true };
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
  let current = { ...reminder };
  const latest = new Map<string, Notice>();
  for (let step = earliest(current, zone); step && step.at <= now; step = earliest(current, zone)) {
    if ('resume' in step) {
      current = resumed(current, step.at, zone);
      continue;
    }
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
    for (const { alert, at, due, slot } of step.alerts)
      latest.set(due, { alert, at, due, slot, missed: current.missed });
  }
  const live = current.due;
  const notices = [...latest.values()].filter((notice) => live !== null && notice.due >= live);
  return { reminder: current, notices };
}

const MOVE_REACH_MS = DAY_MS;

/** The current occurrence's notices and later occurrences' early alerts, whose instants in `zone` reach up to `until`. */
function plannable(reminder: Reminder, zone: string, until: number): AlertStep[] {
  const due = dueAt(reminder, zone);
  if (reminder.due === null || due === null) return [];
  const steps = occurrenceSteps(reminder, due, reminder.due);
  const { snoozedUntil } = reminder;
  if (snoozedUntil !== null)
    steps.push({ at: snoozedUntil, alert: 'snoozed', due: reminder.due, slot: `@${snoozedUntil}` });
  const longest = Math.max(0, ...reminder.alerts) * MINUTE_MS;
  let wall = longest > 0 ? occurrenceAfter(reminder, due, zone) : null;
  while (wall !== null && instantOf(reminder, wall, zone) - longest <= until) {
    const later = wall;
    steps.push(...reminder.alerts.map((minutes) => earlyStep(reminder, later, minutes, zone)));
    wall = occurrenceAfter(reminder, instantOf(reminder, later, zone), zone);
  }
  return steps;
}

/**
 * A floating reminder keeps its wall times when the zone changes, so what it has fired must move with them: otherwise
 * flying west re-fires a notice and flying east skips one. Notices of different occurrences can move by different
 * amounts across a daylight saving change, so no one instant can mark them all; each notice near the move keeps
 * whether it fired, as a watermark just below the first one that has not and the names of any fired ones above it.
 * What the fallback keeps quiet stays quiet, at the cost of a few notices it no longer backs up. A pause's start and
 * end are wall times, like the occurrences they bound, so they keep those.
 */
export function movedZone(reminder: Reminder, from: string, to: string): Reminder {
  const shift = (dueAt(reminder, to) ?? 0) - (dueAt(reminder, from) ?? 0);
  const before = (step: AlertStep) =>
    step.slot.startsWith('@') ? step.at : instantOf(reminder, step.due, from) + Number(step.slot);
  const near = (watermark: number) =>
    plannable(reminder, to, watermark + MOVE_REACH_MS).filter((step) => step.at >= watermark - MOVE_REACH_MS);
  const around = reminder.firedThrough + shift;
  const firedBefore = (step: AlertStep) => consumed(reminder, { ...step, at: before(step) });
  const steps = near(around);
  const firedThrough = Math.min(around, ...steps.filter((step) => !firedBefore(step)).map((step) => step.at - 1));
  const alsoFired = steps.filter((step) => firedBefore(step) && step.at > firedThrough).map(slotKey);
  const quiet = near(reminder.quietThrough + shift).filter((step) => before(step) <= reminder.quietThrough);
  const quietThrough = Math.max(reminder.quietThrough + shift, ...quiet.map((step) => step.at));
  return { ...reminder, firedThrough, alsoFired, quietThrough, paused: movedPause(reminder.paused, from, to) };
}

function movedWall(instant: number, kept: string | undefined, from: string, to: string) {
  const wall = kept ?? formatLocal(toLocal(instant, from));
  return { instant: toInstant(local(wall), to) + (instant % MINUTE_MS), wall };
}

function movedPause(paused: Reminder['paused'], from: string, to: string): Reminder['paused'] {
  if (!paused) return null;
  const start = movedWall(paused.at, paused.atWall, from, to);
  const end = paused.until === null ? null : movedWall(paused.until, paused.untilWall, from, to);
  return { at: start.instant, atWall: start.wall, until: end?.instant ?? null, untilWall: end?.wall };
}
