import { expect, test } from 'bun:test';
import { Fallback } from '../src/app/lib/fallback';
import type { NotificationContent } from '../src/shared/notification';
import { applyOp } from '../src/shared/ops';
import { MINUTE_MS, formatLocal, toLocal } from '../src/shared/time';
import { ulid } from '../src/shared/ulid';

const ZONE = 'Asia/Kolkata';

function lateReminder() {
  const now = Date.now();
  const start = formatLocal(toLocal(now - 10 * MINUTE_MS, ZONE));
  const fields = { title: 'Pay rent', notes: '', start, zone: null, repeat: null, important: false, alerts: [] };
  const created = applyOp(undefined, { type: 'put', id: ulid(), fields }, { now: now - 60 * MINUTE_MS, zone: ZONE });
  if (!created) throw new Error('create failed');
  return created;
}

function harness() {
  const shown: string[] = [];
  const timers: (() => void)[] = [];
  const releases: (() => void)[] = [];
  const fallback = new Fallback({
    ready: () =>
      new Promise((resolve) =>
        releases.push(() =>
          resolve(async (content: NotificationContent) => {
            shown.push(content.title);
          }),
        ),
      ),
    wait: (run) => {
      timers.push(run);
      return () => {};
    },
    origin: 'https://nudge.example',
    locale: 'en',
  });
  const settle = async () => {
    for (const release of releases.splice(0)) release();
    await Bun.sleep(0);
  };
  return { fallback, shown, timers, settle };
}

test('a missed push is shown locally once', async () => {
  const { fallback, shown, timers, settle } = harness();
  const reminders = [lateReminder()];
  fallback.schedule(reminders, ZONE, true);
  timers.shift()?.();
  await settle();
  expect(shown).toEqual(['Pay rent']);
});

test('disabling cancels a display still waiting for the service worker, and keeps the notice for later', async () => {
  const { fallback, shown, timers, settle } = harness();
  const reminders = [lateReminder()];
  fallback.schedule(reminders, ZONE, true);
  timers.shift()?.();
  fallback.schedule(reminders, ZONE, false);
  await settle();
  expect(shown).toEqual([]);

  fallback.schedule(reminders, ZONE, true);
  timers.at(-1)?.();
  await settle();
  expect(shown).toEqual(['Pay rent']);
});
