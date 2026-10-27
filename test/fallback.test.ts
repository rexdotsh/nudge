import { expect, test } from 'bun:test';
import { Fallback } from '../src/app/lib/fallback';
import { fire as fireReminder, nextFireAt } from '../src/shared/fire';
import { fireId, type NotificationContent } from '../src/shared/notification';
import { applyOp } from '../src/shared/ops';
import { MINUTE_MS } from '../src/shared/time';
import { ulid } from '../src/shared/ulid';

const ZONE = 'Asia/Kolkata';
const NOW = Date.UTC(2026, 9, 12, 4, 0);
const DUE = Date.UTC(2026, 9, 12, 3, 50);

function lateReminder() {
  const fields = {
    title: 'Pay rent',
    notes: '',
    start: '2026-10-12T09:20',
    zone: null,
    repeat: null,
    important: false,
    alerts: [],
  };
  const created = applyOp(undefined, { type: 'put', id: ulid(), fields }, { now: NOW - 60 * MINUTE_MS, zone: ZONE });
  if (!created) throw new Error('create failed');
  return created;
}

function harness(alreadySeen: string[] = [], busy: string[] = [], claiming = Promise.resolve(), now = NOW) {
  const shown: string[] = [];
  const shownFires: string[] = [];
  const seen = new Set(alreadySeen);
  const claimed = new Set<string>(busy);
  const claimingStarted = Promise.withResolvers<void>();
  const timers = new Set<() => Promise<void>>();
  const readiness: (() => void)[] = [];
  const fallback = new Fallback({
    ready: () =>
      new Promise((resolve) => {
        readiness.push(() =>
          resolve(async (content: NotificationContent) => {
            shown.push(content.title);
            shownFires.push(content.data.fire);
          }),
        );
      }),
    claim: async (fire) => {
      if (seen.has(fire)) return 'seen';
      if (claimed.has(fire)) return 'busy';
      claimed.add(fire);
      claimingStarted.resolve();
      await claiming;
      return 'won';
    },
    settle: async (fire, displayed) => {
      claimed.delete(fire);
      if (displayed) seen.add(fire);
    },
    wait: (run) => {
      timers.add(run);
      return () => timers.delete(run);
    },
    now: () => now,
    origin: 'https://nudge.example',
    locale: 'en',
  });
  const fire = () => {
    const runs = [...timers];
    timers.clear();
    return runs.map((run) => run());
  };
  const ready = async (checks: Promise<void>[]) => {
    for (const release of readiness.splice(0)) release();
    await Promise.all(checks);
  };
  return { fallback, shown, shownFires, timers, claimed, fire, ready, claimingStarted: claimingStarted.promise };
}

test('the server having planned a push does not stop the fallback; only this device having shown it does', async () => {
  const planned = { ...lateReminder(), firedThrough: NOW };
  const { fallback, shown, fire, ready } = harness();
  fallback.schedule([planned], ZONE, true);
  await ready(fire());
  expect(shown).toEqual(['Pay rent']);

  const again = harness([fireId(planned.id, { at: DUE, due: '2026-10-12T09:20' })]);
  again.fallback.schedule([planned], ZONE, true);
  await again.ready(again.fire());
  expect(again.shown).toEqual([]);
});

test.each([
  ['disabled', false],
  ['replaced', true],
])('a check %s before the service worker is ready leaves the notice for the current schedule', async (_, enabled) => {
  const { fallback, shown, timers, fire, ready } = harness();
  const reminders = [lateReminder()];
  fallback.schedule(reminders, ZONE, true);
  const stale = fire();
  fallback.schedule(reminders, ZONE, enabled);
  await ready(stale);
  expect(shown).toEqual([]);
  expect(timers.size).toBe(enabled ? 1 : 0);

  fallback.schedule(reminders, ZONE, true);
  await ready(fire());
  expect(shown).toEqual(['Pay rent']);
});

test('a fire another context is still showing is not consumed, and is retried', async () => {
  const reminder = lateReminder();
  const key = fireId(reminder.id, { at: DUE, due: '2026-10-12T09:20' });
  const { fallback, shown, timers, claimed, fire, ready } = harness([], [key]);
  fallback.schedule([reminder], ZONE, true);
  await ready(fire());
  expect(shown).toEqual([]);
  expect(timers.size).toBe(1);

  claimed.delete(key);
  await ready(fire());
  expect(shown).toEqual(['Pay rent']);
});

test('settling a reminder while its fallback is claiming it does not show a stale notification', async () => {
  const claiming = Promise.withResolvers<void>();
  const { fallback, shown, claimed, fire, ready, claimingStarted } = harness([], [], claiming.promise);
  fallback.schedule([lateReminder()], ZONE, true);
  const showing = ready(fire());
  await claimingStarted;
  fallback.schedule([], ZONE, true);
  claiming.resolve();
  await showing;
  expect(shown).toEqual([]);
  expect(claimed.size).toBe(0);
});

const ROLL = Date.UTC(2026, 9, 29, 10, 0);

// The server warns for 10:00 and 11:00 together at 09:30; after 10:00 rolls in, the fallback rebuilds that instant from
// the 10:00 occurrence instead, and must still agree with the server on which warning is which.
test.each([
  ['shows nothing the device already received', 'early-10', []],
  ['shows the warning the device missed', 'early-11', ['early-11']],
])('after a roll, a fallback rebuilding the earlier warnings %s', async (_, missed, shown) => {
  const fields = {
    title: 'Stand up',
    notes: '',
    start: '2026-10-29T09:00',
    zone: null,
    repeat: { rule: 'FREQ=HOURLY', anchor: 'schedule' as const },
    important: false,
    alerts: [30, 90],
  };
  const start = Date.UTC(2026, 9, 29, 9, 0);
  const created = applyOp(undefined, { type: 'put', id: ulid(start), fields }, { now: start, zone: 'UTC' });
  if (!created) throw new Error('create failed');
  let server = created;
  const sent = new Map<string, string>();
  for (let next = nextFireAt(server, 'UTC'); next !== null && next <= ROLL; next = nextFireAt(server, 'UTC')) {
    const fired = fireReminder(server, next, 'UTC');
    for (const notice of fired.notices)
      sent.set(`${notice.alert}-${notice.due.slice(11, 13)}`, fireId(server.id, notice));
    server = fired.reminder;
  }
  const seen = [...sent].filter(([label]) => label !== missed).map(([, id]) => id);
  const device = harness(seen, [], Promise.resolve(), ROLL + MINUTE_MS);
  device.fallback.schedule([server], 'UTC', true);
  await device.ready(device.fire());
  expect([...sent.keys()]).toEqual(['early-10', 'early-11', 'due-10']);
  const labels = new Map([...sent].map(([label, id]) => [id, label]));
  expect(device.shownFires.map((id) => labels.get(id))).toEqual(shown);
});
