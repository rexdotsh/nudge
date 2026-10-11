import { parseQuickAdd, suggestedStart } from '../../shared/quick-add';
import { dueAt, type Reminder } from '../../shared/reminder';
import { DAY_MS, HOUR_MS, MINUTE_MS, epochDay, fromEpochDay, toInstant, toLocal, weekday } from '../../shared/time';
import { ulid } from '../../shared/ulid';
import { app } from './app.svelte';
import { whenLabel } from './format';
import { tick } from './haptics';
import { toasts } from './toasts.svelte';

export async function add(text: string): Promise<boolean> {
  const now = Date.now();
  const parsed = parseQuickAdd(text, now, app.zone);
  if (parsed.title === '') return false;
  const id = ulid(now);
  const created = await app.apply({
    type: 'put',
    id,
    fields: {
      title: parsed.title,
      notes: '',
      start: parsed.start ?? suggestedStart(now, app.zone),
      zone: null,
      repeat: parsed.repeat,
      important: parsed.important,
      alerts: [],
    },
  });
  const due = created ? dueAt(created, app.zone) : null;
  toasts.show(
    due === null ? 'Added' : `Added for ${whenLabel(due, now, app.zone)}`,
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

export async function snooze(reminder: Reminder, until: number, label: string): Promise<void> {
  if (reminder.due === null) return;
  tick();
  await app.apply({ type: 'snooze', id: reminder.id, due: reminder.due, until });
  toasts.show(`Snoozed until ${label}`);
}

export async function remove(reminder: Reminder): Promise<void> {
  await app.apply({ type: 'delete', id: reminder.id });
  toasts.show('Deleted', () => void app.apply({ type: 'restore', id: reminder.id }));
}

export interface SnoozeOption {
  label: string;
  at: number;
}

export function snoozeOptions(now: number, zone: string): SnoozeOption[] {
  const today = toLocal(now, zone);
  const at = (days: number, hour: number) => {
    const date = fromEpochDay(epochDay(today) + days);
    return toInstant({ ...date, hour, minute: 0 }, zone);
  };
  const options: SnoozeOption[] = [
    { label: '15 minutes', at: now + 15 * MINUTE_MS },
    { label: '1 hour', at: now + HOUR_MS },
  ];
  if (today.hour < 17) options.push({ label: 'This evening', at: at(0, 18) });
  options.push({ label: 'Tomorrow morning', at: at(1, 9) });
  const toMonday = (7 - weekday(epochDay(today))) % 7 || 7;
  options.push({ label: 'Next week', at: at(toMonday, 9) });
  return options.filter((option) => option.at > now + MINUTE_MS && option.at - now < 8 * DAY_MS);
}
