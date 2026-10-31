import { expect, test } from 'bun:test';
import { Fallback } from '../src/app/lib/fallback';
import { claimNotice, settleNotice } from '../src/browser/claims';
import { Replica } from '../src/browser/replica';
import { fire as fireReminder, movedZone, nextFireAt } from '../src/shared/fire';
import { fireId, noticeKey, type NotificationContent } from '../src/shared/notification';
import { applyOp } from '../src/shared/ops';
import type { Reminder } from '../src/shared/reminder';
import { DAY_MS, MINUTE_MS } from '../src/shared/time';
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

const recorded = (...shown: { fire: string; notice?: string }[]) =>
  shown.reduce((notices, one) => settleNotice(notices, one, true), { seen: [] as string[], claims: {} }).seen;

// Claims go through the production rules, on a store this harness holds instead of IndexedDB.
function harness(alreadySeen: string[] = [], busy: string[] = [], claiming = Promise.resolve(), now = NOW) {
  const shown: string[] = [];
  const shownFires: string[] = [];
  const store = { notices: { seen: alreadySeen, claims: Object.fromEntries(busy.map((key) => [key, now])) } };
  const clock = { now };
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
    claim: async (data) => {
      const { outcome, notices } = claimNotice(store.notices, data, clock.now, data.reminder);
      store.notices = notices;
      if (outcome !== 'won') return outcome;
      claimingStarted.resolve();
      await claiming;
      return outcome;
    },
    settle: async (data, displayed) => {
      store.notices = settleNotice(store.notices, data, displayed);
    },
    wait: (run) => {
      timers.add(run);
      return () => timers.delete(run);
    },
    now: () => clock.now,
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
  return { fallback, shown, shownFires, timers, store, clock, fire, ready, claimingStarted: claimingStarted.promise };
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
  const { fallback, shown, timers, store, fire, ready } = harness([], [key]);
  fallback.schedule([reminder], ZONE, true);
  await ready(fire());
  expect(shown).toEqual([]);
  expect(timers.size).toBe(1);

  store.notices = { ...store.notices, claims: {} };
  await ready(fire());
  expect(shown).toEqual(['Pay rent']);
});

test('settling a reminder while its fallback is claiming it does not show a stale notification', async () => {
  const claiming = Promise.withResolvers<void>();
  const { fallback, shown, store, fire, ready, claimingStarted } = harness([], [], claiming.promise);
  fallback.schedule([lateReminder()], ZONE, true);
  const showing = ready(fire());
  await claimingStarted;
  fallback.schedule([], ZONE, true);
  claiming.resolve();
  await showing;
  expect(shown).toEqual([]);
  expect(store.notices.claims).toEqual({});
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

const PAUSED_AT = Date.UTC(2026, 9, 12, 1, 30);
const BACK_AT = Date.UTC(2026, 9, 12, 3, 0);

const resumeByHand = (paused: Reminder) =>
  applyOp(paused, { type: 'resume', id: paused.id }, { now: BACK_AT, zone: ZONE });

// Daily at 09:00 with a one-hour warning, paused from 07:00 to 08:30, which held back the 08:00 warning.
function pausedThenBack(until: number | null, resume: (paused: Reminder) => Reminder | null): Reminder {
  const fields = {
    title: 'Water the plants',
    notes: '',
    start: '2026-10-12T09:00',
    zone: null,
    repeat: { rule: 'FREQ=DAILY', anchor: 'schedule' as const },
    important: false,
    alerts: [60],
  };
  const id = ulid();
  const created = applyOp(undefined, { type: 'put', id, fields }, { now: PAUSED_AT - 60 * MINUTE_MS, zone: ZONE });
  const paused = created && applyOp(created, { type: 'pause', id, until }, { now: PAUSED_AT, zone: ZONE });
  const resumed = paused && resume(paused);
  if (!resumed) throw new Error('pause or resume was rejected');
  return resumed;
}

test.each<[string, number | null, (paused: Reminder) => Reminder | null]>([
  ['by hand', null, resumeByHand],
  ['on its date', BACK_AT, (paused) => fireReminder(paused, BACK_AT, ZONE).reminder],
])(
  'a fallback after a pause ended %s shows nothing the pause held back, only what comes after',
  async (_, until, resume) => {
    const resumed = pausedThenBack(until, resume);
    expect(fireReminder(resumed, BACK_AT + MINUTE_MS, ZONE).notices).toEqual([]);

    const after = harness([], [], Promise.resolve(), BACK_AT + MINUTE_MS);
    after.fallback.schedule([resumed], ZONE, true);
    await after.ready(after.fire());
    expect(after.shown).toEqual([]);

    const due = Date.UTC(2026, 9, 12, 3, 30);
    const later = harness([], [], Promise.resolve(), due + MINUTE_MS);
    later.fallback.schedule([resumed], ZONE, true);
    await later.ready(later.fire());
    expect(later.shownFires).toEqual([fireId(resumed.id, { at: due, due: '2026-10-12T09:00' })]);
  },
);

test('after flying west, a fallback still keeps quiet the warning a pause held back, as the server does', async () => {
  const ny = 'America/New_York';
  const moved = movedZone(pausedThenBack(null, resumeByHand), ZONE, ny);
  const warning = Date.UTC(2026, 9, 12, 12, 0);
  expect(nextFireAt(moved, ny)).toBe(warning + 60 * MINUTE_MS);
  const device = harness([], [], Promise.resolve(), warning + 5 * MINUTE_MS);
  device.fallback.schedule([moved], ny, true);
  await device.ready(device.fire());
  expect(device.shown).toEqual([]);
});

const WEST = 'America/New_York';
const AT_NINE_WEST = Date.UTC(2026, 9, 12, 13);

// Delivered in UTC, an hour's warning at 08:00 and the 09:00 itself, before the zone was fixed west or this device
// went west; what it has seen is what the service worker recorded for the pushes that arrived.
function deliveredInUtc(arrived: readonly ('early' | 'due')[], legacy: boolean) {
  const fields = {
    title: 'Call the bank',
    notes: '',
    start: '2026-10-12T09:00',
    zone: null,
    repeat: null,
    important: false,
    alerts: [60],
  };
  const created = applyOp(undefined, { type: 'put', id: ulid(), fields }, { now: NOW - DAY_MS, zone: 'UTC' });
  if (!created) throw new Error('create failed');
  const early = fireReminder(created, Date.UTC(2026, 9, 12, 8), 'UTC');
  const due = fireReminder(early.reminder, Date.UTC(2026, 9, 12, 9), 'UTC');
  const pushes = { early: early.notices, due: due.notices };
  const shown = arrived.flatMap((alert) =>
    pushes[alert].map((notice) => ({
      fire: fireId(created.id, notice),
      notice: legacy ? undefined : noticeKey(created.id, notice),
    })),
  );
  const seen = recorded(...shown);
  return { server: due.reminder, seen, pushes };
}

const fixedWest = (server: Reminder) =>
  new Replica({ version: 1, reminders: [movedZone(server, 'UTC', WEST)], zone: { name: WEST, fixed: true } });

test.each([
  {
    name: 'the zone is fixed west after both pushes arrived',
    arrived: ['early', 'due'] as const,
    legacy: false,
    replica: fixedWest,
    now: AT_NINE_WEST + 5 * MINUTE_MS,
    shown: [] as number[],
  },
  {
    name: 'the zone is fixed west after only the warning arrived',
    arrived: ['early'] as const,
    legacy: false,
    replica: fixedWest,
    now: AT_NINE_WEST + 5 * MINUTE_MS,
    shown: [AT_NINE_WEST],
  },
  {
    name: 'the zone is fixed west after both pushes arrived, recorded by a service worker without occurrence keys',
    arrived: ['early', 'due'] as const,
    legacy: true,
    replica: fixedWest,
    now: AT_NINE_WEST + 5 * MINUTE_MS,
    shown: [] as number[],
  },
  {
    name: 'this device lands west offline and the server keeps its zone',
    arrived: ['early', 'due'] as const,
    legacy: false,
    replica: (server: Reminder) =>
      new Replica({ version: 1, reminders: [server], zone: { name: 'UTC', fixed: false } }),
    now: AT_NINE_WEST + 5 * MINUTE_MS,
    shown: [] as number[],
  },
  {
    name: 'an older tab saved the replica of a zone fixed west without the zone, on a device in UTC',
    arrived: [] as const,
    legacy: false,
    replica: (server: Reminder) => new Replica({ version: 1, reminders: [movedZone(server, 'UTC', WEST)] }),
    now: Date.UTC(2026, 9, 12, 9, 5),
    shown: [] as number[],
  },
])('when $name, the fallback shows only what never arrived, at its time', async (row) => {
  const { server, seen } = deliveredInUtc(row.arrived, row.legacy);
  const synced = row.replica(server);
  const device = harness(seen, [], Promise.resolve(), row.now);
  const zone = synced.plannedZone();
  device.fallback.schedule(synced.view([], zone ?? 'UTC'), zone, true);
  await device.ready(device.fire());
  expect(device.shownFires).toEqual(row.shown.map((at) => fireId(server.id, { at, due: '2026-10-12T09:00' })));
});

test('a push matching a fire id recorded alone gains its occurrence key, which still matches after a move', () => {
  const { server, pushes } = deliveredInUtc([], false);
  const [notice] = pushes.due;
  if (!notice) throw new Error('no due notice');
  const [fire, key] = [fireId(server.id, notice), noticeKey(server.id, notice)];
  const arrived = claimNotice({ seen: [fire], claims: {} }, { fire, notice: key }, NOW, null);
  const west = { fire: fireId(server.id, { at: AT_NINE_WEST, due: notice.due }), notice: key };
  expect([arrived.outcome, claimNotice(arrived.notices, west, NOW, null).outcome]).toEqual(['seen', 'seen']);
});

test('a warning seen before the zone moved and checked again after it does not hide a due push that never came', async () => {
  const { server, seen } = deliveredInUtc(['early'], false);
  const moved = movedZone(server, 'UTC', WEST);
  const device = harness(seen, [], Promise.resolve(), AT_NINE_WEST - 55 * MINUTE_MS);
  device.fallback.schedule([moved], WEST, true);
  await device.ready(device.fire());
  expect(device.shown).toEqual([]);
  device.clock.now = AT_NINE_WEST + 5 * MINUTE_MS;
  device.fallback.schedule([moved], WEST, true);
  await device.ready(device.fire());
  expect(device.shownFires).toEqual([fireId(server.id, { at: AT_NINE_WEST, due: '2026-10-12T09:00' })]);
});

// Another device moved the instance zone to New York; this one, left at home, must plan in New York like the server.
test.each([
  ["at this device's own 9:00", Date.UTC(2026, 9, 12, 3, 35)],
  ["at the instance zone's 9:00, after the server's push arrived", Date.UTC(2026, 9, 12, 13, 5)],
])('a device away from the instance zone plans its fallback there, so it shows nothing %s', async (_, now) => {
  const fields = {
    title: 'Call the bank',
    notes: '',
    start: '2026-10-12T09:00',
    zone: null,
    repeat: null,
    important: false,
    alerts: [],
  };
  const created = applyOp(undefined, { type: 'put', id: ulid(), fields }, { now: NOW - DAY_MS, zone: WEST });
  if (!created) throw new Error('create failed');
  const pushed = fireReminder(created, AT_NINE_WEST, WEST).notices.map((notice) => fireId(created.id, notice));
  expect(pushed).toHaveLength(1);
  const device = harness(pushed, [], Promise.resolve(), now);
  device.fallback.schedule([created], WEST, true);
  await device.ready(device.fire());
  expect(device.shown).toEqual([]);
});
