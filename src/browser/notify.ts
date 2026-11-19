import { closeNotifications, showUnlessOnScreen, type Tray } from 'declarative-web-push/worker';
import type { NotificationContent, PushData } from '../shared/notification';
import { isRecord } from '../shared/validate';
import type { Shown } from './shown';

export const SNOOZE_MINUTES = 15;

const ACTIONS = [
  { action: 'done', title: 'Done' },
  { action: 'snooze', title: `Snooze ${SNOOZE_MINUTES} min` },
];

/**
 * A follow-up takes the place of what its occurrence showed before, which iOS never replaces by tag. Safari shows a
 * declarative follow-up once its push event settles, so closing during that event leaves it alone. iOS keeps anything
 * younger than 30 seconds, and anything that arrived immutable, so this is best effort.
 */
export async function makeRoom(tray: Tray, { followUp }: PushData, tag: string | undefined): Promise<void> {
  if (followUp) await closeNotifications(tray, (shown) => shown === tag);
}

// Safari shows declarative pushes before the service worker hears about them; an identical fire already on screen must
// not be shown (and alert) again, while other fires of the same occurrence still replace it.
export async function showNudge(registration: ServiceWorkerRegistration, content: NotificationContent): Promise<void> {
  const { fire, reminder } = content.data;
  const data: Shown = { ...content.data, navigate: content.navigate };
  await makeRoom(registration, content.data, content.tag);
  await showUnlessOnScreen(registration, content, {
    isShowing: (shown) => isRecord(shown.data) && shown.data.fire === fire,
    options: { data, icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', actions: reminder ? ACTIONS : [] },
  });
}
