import type { PushKeys } from '../shared/api';
import { BASE64URL } from '../shared/encoding';
import { request, vapidPublicKey } from './api';

function keysOf(subscription: PushSubscription): PushKeys {
  const { endpoint, keys } = subscription.toJSON();
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error('push subscription is missing keys');
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

function sameKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const current = subscription.options.applicationServerKey;
  return current !== null && new Uint8Array(current).toBase64(BASE64URL) === key.toBase64(BASE64URL);
}

export async function subscribePush(
  registration: ServiceWorkerRegistration,
  current: PushSubscription | null,
): Promise<void> {
  const key = Uint8Array.fromBase64(await vapidPublicKey(), BASE64URL);
  let subscription = current;
  if (subscription && !sameKey(subscription, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await request('subscribe', keysOf(subscription));
}
