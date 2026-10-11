import { request, vapidPublicKey } from '../browser/api';
import { get } from '../browser/kv';
import { acknowledge, currentZone, enqueue, wire } from '../browser/outbox';
import { BASE64URL } from '../shared/encoding';
import type { NotificationContent, PushData, PushMessage } from '../shared/notification';
import type { Op } from '../shared/ops';
import { MINUTE_MS } from '../shared/time';
import { isRecord } from '../shared/validate';

declare const self: ServiceWorkerGlobalScope;

const CACHE_PREFIX = 'nudge-';
export const CACHE = `${CACHE_PREFIX}${NUDGE_BUILD}`;
const SNOOZE_MINUTES = 15;
interface ActionButton {
  action: string;
  title: string;
}

const ACTIONS: ActionButton[] = [
  { action: 'done', title: 'Done' },
  { action: 'snooze', title: `Snooze ${SNOOZE_MINUTES} min` },
];

interface Shown extends PushData {
  navigate: string;
}

function isPushMessage(value: unknown): value is PushMessage {
  return (
    isRecord(value) && value.web_push === 8030 && isRecord(value.notification) && isRecord(value.notification.data)
  );
}

function isShown(value: unknown): value is Shown {
  return isRecord(value) && typeof value.fire === 'string' && typeof value.navigate === 'string';
}

function show(content: NotificationContent): Promise<void> {
  const data: Shown = { ...content.data, navigate: content.navigate };
  const options: NotificationOptions & { renotify: boolean; actions: ActionButton[] } = {
    body: content.body,
    tag: content.tag,
    data,
    icon: '/icons/icon-192.png',
    renotify: true,
    actions: content.data.id === null ? [] : ACTIONS,
  };
  return self.registration.showNotification(content.title, options);
}

async function confirm(fire: string): Promise<void> {
  await update('seen', (seen = []) => [...seen.slice(-SEEN_LIMIT), fire]);
  await request('receipt', { fire }).catch((error: unknown) =>
    console.warn('receipt failed; the server will resend once', error),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(NUDGE_PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request: incoming } = event;
  const url = new URL(incoming.url);
  if (incoming.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const key = incoming.mode === 'navigate' ? '/' : incoming;
  event.respondWith(caches.match(key, { cacheName: CACHE }).then((hit) => hit ?? fetch(incoming)));
});

self.addEventListener('push', (event) => {
  const message: unknown = event.data?.json();
  if (!isPushMessage(message)) return;
  const { notification } = message;
  // Safari shows declarative messages itself and exposes them as event.notification; other browsers need us to.
  const handledByBrowser = 'notification' in event;
  const badge = Number(notification.app_badge);
  event.waitUntil(
    Promise.all([
      handledByBrowser ? undefined : show(notification),
      Number.isFinite(badge) && 'setAppBadge' in self.navigator ? self.navigator.setAppBadge(badge) : undefined,
      confirm(notification.data.fire),
    ]),
  );
});

async function act(op: Op): Promise<void> {
  const change = await enqueue(op);
  const replica = await get('replica');
  await request('sync', { since: replica?.version ?? 0, zone: currentZone(), changes: wire([change]) })
    .then(() => acknowledge(new Set([change.opId])))
    .catch((error: unknown) => console.warn('action queued for the app to send', error));
  for (const client of await self.clients.matchAll()) client.postMessage({ kind: 'changed' }, { transfer: [] });
}

async function focus(navigate: string): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const existing = clients[0];
  if (existing) {
    await existing.focus();
    await existing.navigate(navigate);
  } else {
    await self.clients.openWindow(navigate);
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data: unknown = event.notification.data;
  if (!isShown(data)) return;
  if (data.id !== null && data.due !== null && (event.action === 'done' || event.action === 'snooze')) {
    const op: Op =
      event.action === 'done'
        ? { type: 'complete', id: data.id, due: data.due }
        : { type: 'snooze', id: data.id, due: data.due, until: Date.now() + SNOOZE_MINUTES * MINUTE_MS };
    event.waitUntil(act(op));
    return;
  }
  event.waitUntil(focus(data.navigate));
});

self.addEventListener('pushsubscriptionchange', (event) => {
  const change = event as Event & {
    newSubscription?: PushSubscription | null;
    waitUntil(promise: Promise<unknown>): void;
  };
  change.waitUntil(
    (async () => {
      const key = Uint8Array.fromBase64(await vapidPublicKey(), BASE64URL);
      const subscription =
        event.newSubscription ??
        (await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
      const { endpoint, keys } = subscription.toJSON();
      if (endpoint && keys?.p256dh && keys.auth)
        await request('subscribe', { endpoint, p256dh: keys.p256dh, auth: keys.auth });
    })(),
  );
});
