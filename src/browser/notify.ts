import { showUnlessOnScreen } from 'declarative-web-push/worker';
import type { NotificationContent } from '../shared/notification';
import { isRecord } from '../shared/validate';
import type { Shown } from './shown';

export const SNOOZE_MINUTES = 15;

const ACTIONS = [
  { action: 'done', title: 'Done' },
  { action: 'snooze', title: `Snooze ${SNOOZE_MINUTES} min` },
];

// Safari shows declarative pushes before the service worker hears about them; an identical fire already on screen must
// not be shown (and alert) again, while other fires of the same occurrence still replace it.
export async function showNudge(registration: ServiceWorkerRegistration, content: NotificationContent): Promise<void> {
  const { fire, reminder } = content.data;
  const data: Shown = { ...content.data, navigate: content.navigate };
  await showUnlessOnScreen(registration, content, {
    isShowing: (shown) => isRecord(shown.data) && shown.data.fire === fire,
    options: { data, icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', actions: reminder ? ACTIONS : [] },
  });
}
