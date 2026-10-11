import { dueAt, instantOf, occurrenceAfter, type Reminder } from './reminder';
import { MINUTE_MS } from './time';

export const NAG_INTERVAL_MS = 15 * MINUTE_MS;
export const NAG_LIMIT = 8;

export type Alert = 'early' | 'due' | 'snoozed' | 'nag';

export interface Notice {
  alert: Alert;
  at: number;
  due: string;
  missed: number;
}

type Step = { at: number; alert: Alert } | { at: number; roll: string };

function alertSteps(reminder: Reminder, due: number): Step[] {
  const { snoozedUntil } = reminder;
  const nagFrom = Math.max(due, snoozedUntil ?? due);
  const steps: Step[] = [
    ...reminder.alerts.map((minutes) => ({ at: due - minutes * MINUTE_MS, alert: 'early' as const })),
    { at: due, alert: 'due' },
    ...(reminder.important
      ? Array.from({ length: NAG_LIMIT }, (_, i) => ({
          at: nagFrom + (i + 1) * NAG_INTERVAL_MS,
          alert: 'nag' as const,
        }))
      : []),
  ];
  const quiet = snoozedUntil === null ? steps : steps.filter((step) => step.at >= snoozedUntil);
  const wake: Step[] = snoozedUntil === null ? [] : [{ at: snoozedUntil, alert: 'snoozed' }];
  return [...quiet, ...wake].filter((step) => step.at > reminder.firedThrough);
}

function earliest(reminder: Reminder, zone: string): Step | null {
  const due = dueAt(reminder, zone);
  if (reminder.deleted || due === null) return null;
  const next = occurrenceAfter(reminder, due, zone);
  const steps = alertSteps(reminder, due);
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
    current.firedThrough = step.at;
    current.revision += 1;
    if (current.due !== null) notice = { alert: step.alert, at: step.at, due: current.due, missed: current.missed };
  }
  return { reminder: current, notice };
}
