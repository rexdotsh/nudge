import type { Reminder } from '../../shared/reminder';
import type { Triage } from '../../shared/triage';
import { DAY_MS, HOUR_MS } from '../../shared/time';
import { shortWhen } from './format';

export function quietSummary({ today, later }: Triage, now: number, zone: string): { lead: string; rest: string } {
  const next = today[0] ?? later[0];
  if (!next) return { lead: 'Nothing coming up.', rest: 'Add a reminder below, the way you would say it.' };
  const lead = today[0]
    ? `Nothing for the next ${Math.floor((next.at - now) / HOUR_MS)} hours.`
    : 'Nothing else today.';
  return { lead, rest: `Next is ${next.reminder.title} · ${shortWhen(next.at, now, zone)}` };
}

/** Only finished reminders: a repeating one is still live, and deleting it from here would end the whole series. */
export function recentlyCompleted(reminders: readonly Reminder[], now: number): { reminder: Reminder; at: number }[] {
  return reminders
    .flatMap((reminder) => {
      const at = reminder.completedAt;
      const finished = !reminder.deleted && reminder.due === null && at !== null;
      return finished && now - at < 30 * DAY_MS ? [{ reminder, at }] : [];
    })
    .toSorted((a, b) => b.at - a.at);
}
