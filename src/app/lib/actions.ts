import { SNOOZE_MINUTES } from '../../browser/notify';
import { parseQuickAdd, suggestedStart } from '../../shared/quick-add';
import { dueAt, firstDue, type Reminder, type ReminderFields } from '../../shared/reminder';
import { HOUR_MS, MINUTE_MS, epochDay, fromEpochDay, toInstant, toLocal, weekday } from '../../shared/time';
import { ulid } from '../../shared/ulid';
import { app } from './app.svelte';
import { pausedLabel, summaryWhen, whenLabel } from './format';
import { tick } from './haptics';
import { toasts } from './toasts.svelte';

export async function add(text: string): Promise<boolean> {
  const now = Date.now();
  const parsed = parseQuickAdd(text, now, app.zone);
  if (parsed.title === '') return false;
  const id = ulid(now);
  const fields: ReminderFields = {
    title: parsed.title,
    notes: '',
    start: parsed.start ?? suggestedStart(now, app.zone),
    zone: null,
    repeat: parsed.repeat,
    important: parsed.important,
    alerts: [],
  };
  const start = firstDue(fields, now, app.zone) ?? fields.start;
  const created = await app.apply({ type: 'put', id, fields: { ...fields, start } });
  const due = created ? dueAt(created, app.zone) : null;
  toasts.show(
    due === null ? 'Added' : `Added for ${summaryWhen(due, now, app.zone)}`,
    () => void app.apply({ type: 'delete', id }),
  );
  return true;
}

export async function complete(reminder: Reminder): Promise<void> {
  const due = reminder.due;
  if (due === null) return;
  tick();
  const after = await app.apply({ type: 'complete', id: reminder.id, due });
  toasts.show(
    reminder.repeat && after?.due ? 'Done — next one is scheduled' : 'Completed',
    after ? () => void app.apply({ type: 'reopen', id: reminder.id, due, revision: after.revision }) : undefined,
  );
}

/** Puts a finished one-off back where it was due, without alerting again for anything already past. */
export async function reopen(reminder: Reminder): Promise<void> {
  tick();
  await app.apply({ type: 'reopen', id: reminder.id, due: reminder.start, revision: reminder.revision });
  toasts.show('Back on your list');
}

export async function snooze(reminder: Reminder, until: number): Promise<void> {
  if (reminder.due === null) return;
  tick();
  await app.apply({ type: 'snooze', id: reminder.id, due: reminder.due, until });
  toasts.show(`Snoozed until ${whenLabel(until, Date.now(), app.zone)}`);
}

export async function pause(reminder: Reminder, until: number | null): Promise<void> {
  tick();
  const { id } = reminder;
  await app.apply({ type: 'pause', id, until });
  toasts.show(pausedLabel(until, Date.now(), app.zone), () => void app.apply({ type: 'resume', id }));
}

export async function resume(reminder: Reminder): Promise<void> {
  const { id, paused } = reminder;
  if (!paused) return;
  tick();
  const after = await app.apply({ type: 'resume', id });
  const due = after ? dueAt(after, app.zone) : null;
  toasts.show(
    due === null ? 'Resumed' : `Resumed, next one ${summaryWhen(due, Date.now(), app.zone)}`,
    () => void app.apply({ type: 'pause', id, until: paused.until }),
  );
}

export async function remove(...reminders: Reminder[]): Promise<void> {
  const ids = reminders.map((reminder) => reminder.id);
  await app.applyAll(ids.map((id) => ({ type: 'delete', id })));
  toasts.show(
    ids.length === 1 ? 'Deleted' : `Deleted ${ids.length} reminders`,
    () => void app.applyAll(ids.map((id) => ({ type: 'restore', id }))),
  );
}

export interface SnoozeOption {
  key: 'soon' | 'hour' | 'evening' | 'morning' | 'week';
  label: string;
  at: number;
}

export function snoozeFrom(reminder: Reminder, now: number, zone: string): number {
  return Math.max(now, dueAt(reminder, zone) ?? now);
}

export function snoozeOptions(reminder: Reminder, now: number, zone: string): SnoozeOption[] {
  const from = snoozeFrom(reminder, now, zone);
  const today = toLocal(now, zone);
  const at = (days: number, hour: number) => {
    const date = fromEpochDay(epochDay(today) + days);
    return toInstant({ ...date, hour, minute: 0 }, zone);
  };
  const options: SnoozeOption[] = [
    { key: 'soon', label: `${SNOOZE_MINUTES} minutes`, at: from + SNOOZE_MINUTES * MINUTE_MS },
    { key: 'hour', label: '1 hour', at: from + HOUR_MS },
  ];
  if (today.hour < 17) options.push({ key: 'evening', label: 'This evening', at: at(0, 18) });
  options.push({ key: 'morning', label: 'Tomorrow morning', at: at(1, 9) });
  const toMonday = (7 - weekday(epochDay(today))) % 7 || 7;
  options.push({ key: 'week', label: 'Next week', at: at(toMonday, 9) });
  return options.filter((option) => option.at > from + MINUTE_MS);
}
