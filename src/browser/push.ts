import { subscribe } from 'declarative-web-push/client';
import { request, vapidPublicKey } from './api';

export async function subscribePush(
  registration: ServiceWorkerRegistration,
  current: PushSubscription | null,
): Promise<void> {
  await request('subscribe', await subscribe(registration, await vapidPublicKey(), current));
}
