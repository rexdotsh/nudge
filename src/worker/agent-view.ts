import type { AgentReminder } from '../shared/api';
import { describeRepeat } from '../shared/describe';
import { dueAt, isLate, local, type Reminder } from '../shared/reminder';
import { formatInstant } from '../shared/time';

export function agentReminder(reminder: Reminder, now: number, zone: string, locale: string): AgentReminder {
  const own = reminder.zone ?? zone;
  const instant = (at: number) => formatInstant(at, zone);
  const due = dueAt(reminder, zone);
  const { title, notes, start, important, alerts, repeat, paused, snoozedUntil, completedAt } = reminder;
  return {
    id: reminder.id,
    rev: reminder.revision,
    title,
    due: reminder.due,
    dueAt: due === null ? null : formatInstant(due, own),
    late: isLate(reminder, now, zone),
    done: reminder.due === null,
    snoozedUntil: snoozedUntil !== null && snoozedUntil > now ? instant(snoozedUntil) : null,
    repeat: repeat && { ...repeat, text: describeRepeat(repeat, local(start), locale, own, { withTime: true }) },
    paused: paused && { since: instant(paused.at), until: paused.until === null ? null : instant(paused.until) },
    important,
    alerts,
    notes,
    start,
    zone: reminder.zone,
    deleted: reminder.deleted,
    completedAt: completedAt === null ? null : instant(completedAt),
    createdAt: instant(reminder.createdAt),
    updatedAt: instant(reminder.updatedAt),
  };
}
