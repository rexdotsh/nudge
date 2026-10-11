import { isOverdue, type Reminder } from '../../shared/reminder';
import { DAY_MS, HOUR_MS } from '../../shared/time';
import { daysFromToday, shownAt, shortWhen } from './format';

export interface Entry {
  reminder: Reminder;
  at: number;
  late: boolean;
}

export interface Triage {
  focus: Entry | null;
  late: Entry[];
  today: Entry[];
  later: Entry[];
}

const FOCUS_WINDOW_MS = 3 * HOUR_MS;

export function triage(reminders: readonly Reminder[], now: number, zone: string): Triage {
  const entries = reminders
    .filter((reminder) => !reminder.deleted && reminder.due !== null)
    .map((reminder) => ({ reminder, at: shownAt(reminder, now, zone) ?? now, late: isOverdue(reminder, now, zone) }))
    .toSorted((a, b) => a.at - b.at);
  const late = entries.filter((entry) => entry.late);
  const upcoming = entries.filter((entry) => !entry.late);
  const soon = upcoming[0] && upcoming[0].at - now <= FOCUS_WINDOW_MS ? upcoming[0] : undefined;
  const focus = soon ?? late[0] ?? null;
  const rest = upcoming.filter((entry) => entry !== focus);
  return {
    focus,
    late: late.filter((entry) => entry !== focus),
    today: rest.filter((entry) => daysFromToday(entry.at, now, zone) <= 0),
    later: rest.filter((entry) => daysFromToday(entry.at, now, zone) > 0),
  };
}

export function quietSummary({ today, later }: Triage, now: number, zone: string): { lead: string; rest: string } {
  const next = today[0] ?? later[0];
  if (!next) return { lead: 'Nothing coming up.', rest: 'Add a reminder below, the way you would say it.' };
  const lead = today[0]
    ? `Nothing for the next ${Math.floor((next.at - now) / HOUR_MS)} hours.`
    : 'Nothing else today.';
  return { lead, rest: `Next is ${next.reminder.title} · ${shortWhen(next.at, now, zone)}` };
}

export function recentlyCompleted(reminders: readonly Reminder[], now: number): Reminder[] {
  return reminders
    .filter(
      (reminder) => !reminder.deleted && reminder.completedAt !== null && now - reminder.completedAt < 30 * DAY_MS,
    )
    .toSorted((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
}
