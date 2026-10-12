import { expect, test } from 'bun:test';
import { isSettled } from '../src/shared/notification';
import { applyOp, type Op } from '../src/shared/ops';
import type { Reminder } from '../src/shared/reminder';
import { HOUR_MS } from '../src/shared/time';

const ZONE = 'Asia/Kolkata';
const NOW = Date.UTC(2026, 9, 12, 10, 30);
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

test.each([
  ['still late', reminder(false), DUE, false],
  ['an early alert of the next occurrence', reminder(true), '2026-10-13T09:00', false],
  ['a reminder this replica has not synced yet', undefined, DUE, false],
  ['done once', reminder(false, { type: 'complete', id: ID, due: DUE }), DUE, true],
  ['done, and the series moved on', reminder(true, { type: 'complete', id: ID, due: DUE }), DUE, true],
  ['skipped', reminder(true, { type: 'skip', id: ID, due: DUE }), DUE, true],
  ['snoozed', reminder(false, { type: 'snooze', id: ID, due: DUE, until: NOW + HOUR_MS }), DUE, true],
  ['deleted', reminder(false, { type: 'delete', id: ID }), DUE, true],
])('a notification goes away only once nothing is left to do: %s', (_, current, due, settled) => {
  expect(isSettled({ id: ID, due }, current, NOW)).toBe(settled);
});
