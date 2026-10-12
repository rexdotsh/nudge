import { Unreachable, request } from '../browser/api';
import { get } from '../browser/kv';
import { SNOOZE_MINUTES, isShown, showUnlessOnScreen } from '../browser/notify';
import { batch } from '../browser/batch';
import { commit, currentZone, enqueue } from '../browser/outbox';
import { subscribePush } from '../browser/push';
import { Replica } from '../browser/replica';
import { EMPTY_LOCAL } from '../browser/schema';
import { claim, isSeen, settle } from '../browser/seen';
import { MAX_REQUEST_BYTES } from '../shared/api';
import type { NotificationContent, PushMessage } from '../shared/notification';
import type { Op } from '../shared/ops';
import { MINUTE_MS } from '../shared/time';
import { isRecord } from '../shared/validate';

declare const self: ServiceWorkerGlobalScope;

const CACHE_PREFIX = 'nudge-';
const CACHE = `${CACHE_PREFIX}${NUDGE_BUILD}`;
function isPushMessage(value: unknown): value is PushMessage {
  return (
    isRecord(value) && value.web_push === 8030 && isRecord(value.notification) && isRecord(value.notification.data)
  );
}

// The receipt goes out only once the notification is really on screen; a resend of a fire already shown is confirmed
// again without alerting twice.
async function present(notification: NotificationContent, shownByBrowser: boolean): Promise<void> {
  const { fire } = notification.data;
  if (shownByBrowser) {
    await settle(fire, true);
  } else if ((await claim(fire, Date.now())) === 'won') {
    await showUnlessOnScreen(self.registration, notification).then(
      () => settle(fire, true),
      async (error: unknown) => {
        await settle(fire, false);
        throw error;
      },
    );
  }
  if (!(await isSeen(fire))) return;
  await request('receipt', { fire }).catch((error: unknown) => {
    if (!(error instanceof Unreachable)) throw error;
    console.warn('receipt failed; the server will resend and this device will confirm then', error);
  });
}

// Where the browser supports it, launches and hashed assets are answered straight from the cache without waiting for this
// worker to start.
const ROUTES: RouterRule[] = [
  { condition: { urlPattern: { pathname: '/', search: '' }, requestMode: 'navigate' }, source: { cacheName: CACHE } },
  { condition: { urlPattern: { pathname: '/assets/*' } }, source: { cacheName: CACHE } },
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([caches.open(CACHE).then((cache) => cache.addAll(NUDGE_PRECACHE)), event.addRoutes?.(ROUTES)]).then(
      () => self.skipWaiting(),
    ),
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
      present(notification, handledByBrowser),
      Number.isFinite(badge) && 'setAppBadge' in self.navigator ? self.navigator.setAppBadge(badge) : undefined,
    ]),
  );
});

// Sends the outbox in order, so an action never overtakes the change that created what it acts on.
async function drain(): Promise<void> {
  const local = (await get('local')) ?? EMPTY_LOCAL;
  const changes = batch(local.pending, MAX_REQUEST_BYTES);
  const response = await request('sync', { since: local.replica.version, zone: currentZone(), changes });
  const replica = new Replica(local.replica);
  replica.receive(response);
  const { pending } = await commit(replica.snapshot(), new Set(changes.map((change) => change.opId)));
  if (pending.length > 0) await drain();
}

async function act(op: Op): Promise<void> {
  await enqueue([op]);
  try {
    await drain().catch((error: unknown) => {
      if (!(error instanceof Unreachable)) throw error;
      console.warn('action queued for the app to send', error);
    });
  } finally {
    for (const client of await self.clients.matchAll()) client.postMessage({ kind: 'changed' }, { transfer: [] });
  }
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
  const { reminder } = data;
  if (reminder !== null && (event.action === 'done' || event.action === 'snooze')) {
    const op: Op =
      event.action === 'done'
        ? { type: 'complete', id: reminder.id, due: reminder.due }
        : { type: 'snooze', id: reminder.id, due: reminder.due, until: Date.now() + SNOOZE_MINUTES * MINUTE_MS };
    event.waitUntil(act(op));
    return;
  }
  event.waitUntil(focus(data.navigate));
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(subscribePush(self.registration, event.newSubscription));
});
