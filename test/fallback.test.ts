import { expect, test } from 'bun:test';
import { Fallback } from '../src/app/lib/fallback';
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

function harness(alreadySeen: string[] = [], busy: string[] = []) {
  const shown: string[] = [];
  const seen = new Set(alreadySeen);
  const claimed = new Set<string>(busy);
  const timers = new Set<() => Promise<void>>();
  const readiness: (() => void)[] = [];
  const fallback = new Fallback({
    ready: () =>
      new Promise((resolve) => {
        readiness.push(() =>
          resolve(async (content: NotificationContent) => {
            shown.push(content.title);
          }),
        );
      }),
    claim: async (fire) => {
      if (seen.has(fire)) return 'seen';
      if (claimed.has(fire)) return 'busy';
      claimed.add(fire);
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
    now: () => NOW,
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
  return { fallback, shown, timers, claimed, fire, ready };
}

test('a missed push is shown locally once', async () => {
  const { fallback, shown, fire, ready } = harness();
  fallback.schedule([lateReminder()], ZONE, true);
  await ready(fire());
  expect(shown).toEqual(['Pay rent']);
});

test('the server having planned a push does not stop the fallback; only this device having shown it does', async () => {
  const planned = { ...lateReminder(), firedThrough: NOW };
  const { fallback, shown, fire, ready } = harness();
  fallback.schedule([planned], ZONE, true);
  await ready(fire());
  expect(shown).toEqual(['Pay rent']);

  const again = harness([fireId(planned.id, DUE)]);
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
  const key = fireId(reminder.id, DUE);
  const { fallback, shown, timers, claimed, fire, ready } = harness([], [key]);
  fallback.schedule([reminder], ZONE, true);
  await ready(fire());
  expect(shown).toEqual([]);
  expect(timers.size).toBe(1);

  claimed.delete(key);
  await ready(fire());
  expect(shown).toEqual(['Pay rent']);
});
