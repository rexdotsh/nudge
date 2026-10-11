import { subscribePush } from '../../browser/push';

export type PushState = 'unsupported' | 'prompt' | 'denied' | 'enabled';

export function pushState(): PushState {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' ? 'enabled' : 'prompt';
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
