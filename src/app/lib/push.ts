import { subscribePush } from '../../browser/push';
import type { Platform } from '../../shared/api';

export type PushState = 'unsupported' | 'prompt' | 'denied' | 'enabled';

export function pushState(): PushState {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' ? 'enabled' : 'prompt';
}

/** Once blocked, browsers never ask again: the person has to allow Nudge where the platform keeps the setting. */
export const UNBLOCK_STEPS: Record<Platform, string> = {
  ios: 'Open the Settings app, tap Notifications, then Nudge, and turn on Allow Notifications.',
  mac: 'In Safari, open Settings → Websites → Notifications and allow Nudge; for the Dock app, use System Settings → Notifications → Nudge. In Chrome or Edge, click the icon left of the address and allow notifications.',
  windows:
    'Open Nudge in your browser, click the icon left of the address and set Notifications to Allow. Windows Settings → System → Notifications must allow your browser too.',
  android:
    'For the installed app, long-press its icon and open App info → Notifications. In Chrome, open ⋮ → Settings → Site settings → Notifications and allow Nudge.',
  other: "Allow notifications for this site in your browser's site settings.",
};

/** Calls back when the notification permission changes outside the app, such as in site or system settings. */
export function watchPermission(changed: () => void): void {
  navigator.permissions
    ?.query({ name: 'notifications' })
    .then((status) => status.addEventListener('change', changed))
    .catch((error: unknown) => console.warn('notification permission changes cannot be watched here', error));
  window.addEventListener('focus', changed);
}

export async function syncSubscription(): Promise<void> {
  if (pushState() !== 'enabled') return;
  const registration = await navigator.serviceWorker.ready;
  await subscribePush(registration, await registration.pushManager.getSubscription());
}

export async function enablePush(): Promise<PushState> {
  if (pushState() === 'unsupported') return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'prompt';
  await syncSubscription();
  return 'enabled';
}
