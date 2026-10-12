import type { NotificationContent, PushData } from '../shared/notification';
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
    renotify: content.renotify,
    requireInteraction: content.requireInteraction,
    actions: content.data.reminder ? ACTIONS : [],
  };
  return registration.showNotification(content.title, options);
}
