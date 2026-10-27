import { pushPermission, requestPushPermission, type PushPermission } from 'declarative-web-push/client';
import { subscribePush } from '../../browser/push';
import type { Platform } from '../../shared/api';

export const UNBLOCK_STEPS: Record<Platform, string> = {
  ios: 'Open the Settings app, tap Notifications, then Nudge, and turn on Allow Notifications.',
  mac: 'In Safari, open Settings → Websites → Notifications and allow Nudge; for the Dock app, use System Settings → Notifications → Nudge. In Chrome or Edge, click the icon left of the address and allow notifications.',
  windows:
    'Open Nudge in your browser, click the icon left of the address and set Notifications to Allow. Windows Settings → System → Notifications must allow your browser too.',
  android:
    'For the installed app, long-press its icon and open App info → Notifications. In Chrome, open ⋮ → Settings → Site settings → Notifications and allow Nudge.',
  other: "Allow notifications for this site in your browser's site settings.",
};

export function watchPermission(changed: () => void): void {
  navigator.permissions
    ?.query({ name: 'notifications' })
    .then((status) => status.addEventListener('change', changed))
    .catch((error: unknown) => console.warn('notification permission changes cannot be watched here', error));
  window.addEventListener('focus', changed);
}

let subscribing: Promise<void> | null = null;

export function syncSubscription(): Promise<void> {
  if (pushPermission() !== 'granted') return Promise.resolve();
  subscribing ??= navigator.serviceWorker.ready
    .then(async (registration) => subscribePush(registration, await registration.pushManager.getSubscription()))
    .finally(() => (subscribing = null));
  return subscribing;
}

export async function enablePush(): Promise<PushPermission> {
  const permission = await requestPushPermission();
  if (permission !== 'granted') return permission;
  await syncSubscription();
  return pushPermission();
}
