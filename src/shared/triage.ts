import { isLate, shownAt, type Reminder } from './reminder';
import { HOUR_MS, daysFromToday } from './time';

export interface Entry {
  reminder: Reminder;
  at: number;
  late: boolean;
}

interface Sections {
  late: Entry[];
  today: Entry[];
  later: Entry[];
  paused: Reminder[];
}

export interface Triage extends Sections {
  focus: Entry | null;
}

const FOCUS_WINDOW_MS = 3 * HOUR_MS;

const backAt = ({ paused }: Reminder) => paused?.until ?? Number.MAX_SAFE_INTEGER;

export function sections(reminders: readonly Reminder[], now: number, zone: string): Sections {
  const open = reminders.filter((reminder) => !reminder.deleted && reminder.due !== null);
  const entries = open
    .filter((reminder) => reminder.paused === null)
    .map((reminder) => ({ reminder, at: shownAt(reminder, now, zone) ?? now, late: isLate(reminder, now, zone) }))
    .toSorted((a, b) => a.at - b.at);
  const upcoming = entries.filter((entry) => !entry.late);
  return {
    late: entries.filter((entry) => entry.late),
    today: upcoming.filter((entry) => daysFromToday(entry.at, now, zone) <= 0),
    later: upcoming.filter((entry) => daysFromToday(entry.at, now, zone) > 0),
    paused: open
      .filter((reminder) => reminder.paused !== null)
      .toSorted((a, b) => backAt(a) - backAt(b) || a.title.localeCompare(b.title)),
  };
}

export function triage(reminders: readonly Reminder[], now: number, zone: string): Triage {
  const { late, today, later, paused } = sections(reminders, now, zone);
  const upcoming = today[0] ?? later[0];
  const soon = upcoming && upcoming.at - now <= FOCUS_WINDOW_MS ? upcoming : undefined;
  const focus = soon ?? late[0] ?? null;
  const unfocused = (entries: Entry[]) => entries.filter((entry) => entry !== focus);
  return { focus, late: unfocused(late), today: unfocused(today), later: unfocused(later), paused };
}
