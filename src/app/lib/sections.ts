import { isOverdue, type Reminder } from '../../shared/reminder';
import { DAY_MS } from '../../shared/time';
import { daysFromToday, shownAt } from './format';

export interface Entry {
  reminder: Reminder;
  at: number;
  overdue: boolean;
}

export interface Section {
  key: 'overdue' | 'today' | 'tomorrow' | 'week' | 'later';
  title: string;
  entries: Entry[];
}

const TITLES: Record<Section['key'], string> = {
  overdue: 'Overdue',
  today: 'Today',
  tomorrow: 'Tomorrow',
  week: 'This week',
  later: 'Later',
};

function keyFor(entry: Entry, now: number, zone: string): Section['key'] {
  if (entry.overdue) return 'overdue';
  const days = daysFromToday(entry.at, now, zone);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return days < 7 ? 'week' : 'later';
}

export function upcoming(reminders: readonly Reminder[], now: number, zone: string): Section[] {
  const entries = reminders
    .filter((reminder) => !reminder.deleted && reminder.due !== null)
    .map((reminder) => ({ reminder, at: shownAt(reminder, now, zone) ?? now, overdue: isOverdue(reminder, now, zone) }))
    .toSorted((a, b) => a.at - b.at);
  const sections = new Map<Section['key'], Section>();
  for (const entry of entries) {
    const key = keyFor(entry, now, zone);
    const section = sections.get(key) ?? { key, title: TITLES[key], entries: [] };
    section.entries.push(entry);
    sections.set(key, section);
  }
  return (['overdue', 'today', 'tomorrow', 'week', 'later'] as const).flatMap((key) => sections.get(key) ?? []);
}

export function recentlyCompleted(reminders: readonly Reminder[], now: number): Reminder[] {
  return reminders
    .filter(
      (reminder) => !reminder.deleted && reminder.completedAt !== null && now - reminder.completedAt < 30 * DAY_MS,
    )
    .toSorted((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
}
