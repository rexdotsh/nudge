import { request, vapidPublicKey } from '../../browser/api';
import type { PushKeys } from '../../shared/api';
import { BASE64URL } from '../../shared/encoding';

export type PushState = 'unsupported' | 'prompt' | 'denied' | 'enabled';

function keysOf(subscription: PushSubscription): PushKeys {
  const { endpoint, keys } = subscription.toJSON();
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error('push subscription is missing keys');
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

const sameKey = (subscription: PushSubscription, key: Uint8Array) => {
  const current = subscription.options.applicationServerKey;
  return current !== null && new Uint8Array(current).toBase64(BASE64URL) === key.toBase64(BASE64URL);
};

export function pushState(): PushState {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
    return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' ? 'enabled' : 'prompt';
}

export async function syncSubscription(): Promise<void> {
  if (pushState() !== 'enabled') return;
  const registration = await navigator.serviceWorker.ready;
  const key = Uint8Array.fromBase64(await vapidPublicKey(), BASE64URL);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await request('subscribe', keysOf(subscription));
}

export async function enablePush(): Promise<PushState> {
  if (pushState() === 'unsupported') return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'prompt';
  await syncSubscription();
  return 'enabled';
}
