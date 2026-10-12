import { isSettled, type NotificationContent, type PushData } from '../shared/notification';
import type { Reminder } from '../shared/reminder';
import { isRecord } from '../shared/validate';

export const SNOOZE_MINUTES = 15;

interface ActionButton {
  action: string;
  title: string;
}

const ACTIONS: ActionButton[] = [
  { action: 'done', title: 'Done' },
  { action: 'snooze', title: `Snooze ${SNOOZE_MINUTES} min` },
];

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

// Safari shows declarative pushes before the service worker hears about them; an identical fire already on screen must
// not be shown (and alert) again, while other fires of the same occurrence still replace it.
export async function showUnlessOnScreen(
  registration: ServiceWorkerRegistration,
  content: NotificationContent,
): Promise<void> {
  const current = await registration.getNotifications({ tag: content.tag });
  const { fire } = content.data;
  const onScreen = current.some((notification) => {
    const data: unknown = notification.data;
    return isRecord(data) && data.fire === fire;
  });
  if (onScreen) return;
  await show(registration, content);
}

function show(registration: ServiceWorkerRegistration, content: NotificationContent): Promise<void> {
  const data: Shown = { ...content.data, navigate: content.navigate };
  const options: NotificationOptions & { renotify: boolean; actions: ActionButton[] } = {
    body: content.body,
    tag: content.tag,
    data,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    renotify: content.renotify,
    requireInteraction: content.requireInteraction,
    actions: content.data.reminder ? ACTIONS : [],
  };
  return registration.showNotification(content.title, options);
}

// Android's launcher badges the icon with the notifications still showing, and every platform keeps them in its list,
// so what was settled on any device goes away once this one has synced.
export async function dismissSettled(
  registration: ServiceWorkerRegistration,
  reminders: readonly Reminder[],
  now: number,
): Promise<void> {
  const byId = new Map(reminders.map((reminder) => [reminder.id, reminder]));
  for (const notification of await registration.getNotifications()) {
    const data: unknown = notification.data;
    if (isShown(data) && data.reminder && isSettled(data.reminder, byId.get(data.reminder.id), now)) {
      notification.close();
    }
  }
}
