import { isSettled, type PushData } from '../shared/notification';
import type { Reminder } from '../shared/reminder';
import { isRecord } from '../shared/validate';

export interface Shown extends PushData {
  navigate: string;
}

export function isShown(value: unknown): value is Shown {
  if (!isRecord(value) || typeof value.fire !== 'string' || typeof value.navigate !== 'string') return false;
  const { reminder } = value;
  return (
    reminder === null || (isRecord(reminder) && typeof reminder.id === 'string' && typeof reminder.due === 'string')
  );
}

interface OnScreen {
  readonly data: unknown;
  close(): void;
}

interface Tray {
  getNotifications(): Promise<readonly OnScreen[]>;
}

// Android badges the app icon with the notifications still showing, so what was settled on any device goes away once
// this one has synced. Meanwhile an undo or a newer sync can change the reminders and a snooze can run out, so both are
// read only once the notifications are listed; `current` is null once this run has been overtaken.
export async function dismissSettled(
  tray: Tray,
  current: () => readonly Reminder[] | null,
  now: () => number,
): Promise<void> {
  const showing = await tray.getNotifications();
  const reminders = current();
  if (!reminders) return;
  const at = now();
  const byId = new Map(reminders.map((reminder) => [reminder.id, reminder]));
  for (const notification of showing) {
    const { data } = notification;
    if (isShown(data) && data.reminder && isSettled(data.reminder, byId.get(data.reminder.id), at)) {
      notification.close();
    }
  }
}
