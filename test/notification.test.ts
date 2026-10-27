import { expect, test } from 'bun:test';
import { OPENED, isWorkerMessage, openInPlace } from '../src/browser/messages';
import { isSettled, reminderMessage, taggedOccurrence } from '../src/shared/notification';
import { applyOp, type Op } from '../src/shared/ops';
import type { Reminder } from '../src/shared/reminder';
import { HOUR_MS } from '../src/shared/time';

const ZONE = 'Asia/Kolkata';
const NOW = Date.UTC(2026, 9, 12, 10, 30);
const SNOOZE_ENDS = NOW + HOUR_MS;
const DUE = '2026-10-12T09:00';
const ID = 'reminder';
const clock = { now: NOW, zone: ZONE };

function reminder(daily: boolean, ...ops: Op[]): Reminder {
  const fields = {
    title: 'Water plants',
    notes: '',
    start: DUE,
    zone: null,
    repeat: daily ? { rule: 'FREQ=DAILY', anchor: 'schedule' as const } : null,
    important: false,
    alerts: [60],
  };
  let current = applyOp(undefined, { type: 'put', id: ID, fields }, { now: NOW - 48 * HOUR_MS, zone: ZONE });
  for (const op of ops) current = current && applyOp(current, op, clock);
  if (!current) throw new Error('reminder not created');
  return current;
}

const snoozed = reminder(false, { type: 'snooze', id: ID, due: DUE, until: SNOOZE_ENDS });
const done = reminder(false, { type: 'complete', id: ID, due: DUE });

test.each([
  ['still late', reminder(false), DUE, NOW, false],
  ['an early alert of the next occurrence', reminder(true), '2026-10-13T09:00', NOW, false],
  ['a reminder this replica has not synced yet', undefined, DUE, NOW, false],
  ['done once', done, DUE, NOW, true],
  ['done, and the series moved on', reminder(true, { type: 'complete', id: ID, due: DUE }), DUE, NOW, true],
  ['skipped', reminder(true, { type: 'skip', id: ID, due: DUE }), DUE, NOW, true],
  ['snoozed', snoozed, DUE, NOW, true],
  ['a snooze that has just run out', snoozed, DUE, SNOOZE_ENDS, false],
  ['deleted', reminder(false, { type: 'delete', id: ID }), DUE, NOW, true],
])('a notification goes away only once nothing is left to do: %s', (_, current, due, at, settled) => {
  expect(isSettled({ id: ID, due }, current, at)).toBe(settled);
});

test('a reminder notification names its occurrence in its tag, which iOS keeps when it drops the data', () => {
  const notice = { at: NOW, due: DUE, alert: 'due' as const, missed: 0 };
  const view = { origin: 'https://nudge.example', zone: ZONE, locale: 'en', badge: 0 };
  const { tag = '' } = reminderMessage(reminder(false), notice, view).notification;
  expect(taggedOccurrence(tag)).toEqual({ id: ID, due: DUE });
  expect(taggedOccurrence('test')).toBeNull();
});

test('a notification tap opens in place only where the window answers, so an older page is navigated instead', async () => {
  const capable = {
    postMessage(message: unknown, [port]: MessagePort[]) {
      if (isWorkerMessage(message) && message.kind === 'open') port?.postMessage(OPENED);
    },
  };
  const older = { postMessage: () => undefined };
  expect(await openInPlace(capable, '/?open=x', new Promise(() => undefined))).toBe(true);
  expect(await openInPlace(older, '/?open=x', Promise.resolve())).toBe(false);
});
