import { closeNotifications, readPush, waitUntilWithin } from 'declarative-web-push/worker';
import { Unreachable, request } from '../browser/api';
import { openInPlace, type WorkerMessage } from '../browser/messages';
import { SNOOZE_MINUTES, showNudge } from '../browser/notify';
import { isShown } from '../browser/shown';
import { batch } from '../browser/batch';
import { commit, currentZone, enqueue, readLocal } from '../browser/outbox';
import { subscribePush } from '../browser/push';
import { Replica } from '../browser/replica';
import { claim, isSeen, settle } from '../browser/seen';
import { get, update } from '../browser/kv';
import { instanceZone, receivedZone } from '../browser/zone';
import { MAX_REQUEST_BYTES, type SyncRequest } from '../shared/api';
import { lateCount } from '../shared/reminder';
import { isSettledTag, type PushData } from '../shared/notification';
import type { Op } from '../shared/ops';
import { MINUTE_MS } from '../shared/time';
import { isRecord } from '../shared/validate';

declare const self: ServiceWorkerGlobalScope;

const CACHE_PREFIX = 'nudge-';
const CACHE = `${CACHE_PREFIX}${NUDGE_BUILD}`;
function isPushData(value: unknown): value is PushData {
  return isRecord(value) && typeof value.fire === 'string';
}

async function present(fire: string, show?: () => Promise<void>): Promise<void> {
  if (!show) {
    await settle(fire, true);
  } else if ((await claim(fire, Date.now())) === 'won') {
    await show().then(
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

const ROUTES: RouterRule[] = [
  { condition: { urlPattern: { pathname: '/', search: '' }, requestMode: 'navigate' }, source: { cacheName: CACHE } },
  { condition: { urlPattern: { pathname: '/assets/*' } }, source: { cacheName: CACHE } },
];

// The server may already run a newer build, whose launch page would point at files this one never cached; caching
// that mix would launch nothing, so this build only installs when the page it fetched is its own.
async function precache(): Promise<void> {
  const responses = await Promise.all(NUDGE_PRECACHE.map((url) => fetch(url, { cache: 'no-cache' })));
  const [page] = responses;
  if (!page || responses.some((response) => !response.ok)) throw new Error('a precached file is missing');
  const linked = (await page.clone().text()).match(/\/assets\/[^"'\s)]+/g) ?? [];
  if (linked.some((url) => !NUDGE_PRECACHE.includes(url))) throw new Error('the server runs another build');
  const cache = await caches.open(CACHE);
  await Promise.all(NUDGE_PRECACHE.map((url, i) => cache.put(url, responses[i] ?? page)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(Promise.all([precache(), event.addRoutes?.(ROUTES)]).then(() => self.skipWaiting()));
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

const SHOW_WITHIN_MS = 3000;

self.addEventListener('push', (event) => {
  const push = readPush(event, isPushData);
  if (!push) return;
  if (push.kind === 'declarative') {
    waitUntilWithin(event, Promise.all([present(push.data.fire), tidy()]), SHOW_WITHIN_MS);
    return;
  }
  const { message } = push;
  const { notification } = message;
  const badge = Number(message.app_badge);
  event.waitUntil(
    Promise.all([
      present(notification.data.fire, () => showNudge(self.registration, notification)),
      tidy(),
      Number.isFinite(badge) && 'setAppBadge' in self.navigator ? self.navigator.setAppBadge(badge) : undefined,
    ]),
  );
});

// Sends the outbox in order, so an action never overtakes the change that created what it acts on.
async function drain(): Promise<void> {
  const [local, zone] = await Promise.all([readLocal(), get('instanceZone')]);
  const changes = batch(local.pending, MAX_REQUEST_BYTES);
  const sent: SyncRequest = {
    since: local.replica.version,
    zone: currentZone(),
    changes,
    theme: null,
    zoneChoice: zone?.pending ?? null,
  };
  const response = await request('sync', sent);
  const [{ pending }] = await Promise.all([
    commit(response, sent.since, new Set(changes.map((change) => change.opId))),
    update('instanceZone', (state) => receivedZone(state, sent, response)),
  ]);
  if (pending.length > 0) await drain();
}

async function planned() {
  const [local, state] = await Promise.all([readLocal(), get('instanceZone')]);
  const zone = instanceZone(state, currentZone()).name;
  return { reminders: new Replica(local.replica).view(local.pending, zone), zone };
}

// A device with Nudge closed runs nothing but this worker, so each push is its chance to drop notifications for
// reminders settled elsewhere since.
async function tidy(): Promise<void> {
  await drain().catch((error: unknown) => {
    if (!(error instanceof Unreachable)) throw error;
  });
  const { reminders } = await planned();
  await closeNotifications(self.registration, (tag) => isSettledTag(tag, reminders, Date.now()));
}

async function recount(): Promise<void> {
  if (!('setAppBadge' in self.navigator)) return;
  const { reminders, zone } = await planned();
  await self.navigator.setAppBadge(lateCount(reminders, Date.now(), zone));
}

async function act(op: Op): Promise<void> {
  await enqueue([op]);
  try {
    await drain().catch((error: unknown) => {
      if (!(error instanceof Unreachable)) throw error;
      console.warn('action queued for the app to send', error);
    });
  } finally {
    const changed: WorkerMessage = { kind: 'changed' };
    for (const client of await self.clients.matchAll()) client.postMessage(changed, { transfer: [] });
  }
  await recount();
}

const OPEN_ANSWER_MS = 1000;

// Navigating an open window would push a history entry per notification, which Android's back gesture then walks
// through, so the window shows the link itself when it can.
async function focus(navigate: string): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const existing = clients[0];
  if (!existing) {
    await self.clients.openWindow(navigate);
    return;
  }
  await existing.focus();
  const deadline = new Promise<void>((resolve) => setTimeout(resolve, OPEN_ANSWER_MS));
  if (await openInPlace(existing, navigate, deadline)) return;
  // Only windows this worker controls can be navigated.
  await existing.navigate(navigate).catch(async (error: unknown) => {
    if (!(error instanceof TypeError)) throw error;
    await self.clients.openWindow(navigate);
  });
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
