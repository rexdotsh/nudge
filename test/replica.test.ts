import { expect, test } from 'bun:test';
import { Replica } from '../src/browser/replica';
import type { Change } from '../src/shared/api';
import { isSettledTag } from '../src/shared/notification';
import { applyOp } from '../src/shared/ops';
import type { Reminder, ReminderFields } from '../src/shared/reminder';
import { ulid } from '../src/shared/ulid';

const ZONE = 'Asia/Kolkata';
const INSTANCE = { name: ZONE, fixed: false };
const NOW = Date.UTC(2026, 9, 11, 14, 0);
const ID = ulid(NOW);

const fields: ReminderFields = {
  title: 'Pay rent',
  notes: '',
  start: '2026-10-12T09:00',
  zone: null,
  repeat: null,
  important: false,
  alerts: [],
};

function server(): Reminder {
  const created = applyOp(undefined, { type: 'put', id: ID, fields }, { now: NOW, zone: ZONE });
  if (!created) throw new Error('create failed');
  return created;
}

const complete: Change = {
  opId: ulid(),
  op: { type: 'complete', id: ID, due: '2026-10-12T09:00' },
  at: NOW + 1,
};

test('pending changes are layered over the server state until the server acknowledges them', () => {
  const replica = new Replica({ version: 1, reminders: [server()] });
  expect(replica.view([complete], ZONE)[0]?.due).toBeNull();

  replica.receive({
    version: 2,
    reminders: [{ ...server(), title: 'Pay rent (edited elsewhere)' }],
    reset: false,
    theme: 'classic',
    zone: INSTANCE,
  });
  expect(replica.view([complete], ZONE)[0]).toMatchObject({ title: 'Pay rent (edited elsewhere)', due: null });
  expect(replica.view([], ZONE)[0]?.due).toBe('2026-10-12T09:00');
});

test('a reset drops everything the server no longer has', () => {
  const replica = new Replica({ version: 5, reminders: [server()] });
  replica.receive({ version: 3, reminders: [], reset: true, theme: 'classic', zone: INSTANCE });
  expect(replica.view([], ZONE)).toEqual([]);
  expect(replica.version).toBe(3);
});

test('a slower, older sync response never rolls the replica back', () => {
  const replica = new Replica({ version: 1, reminders: [server()] });
  replica.receive({
    version: 3,
    reminders: [{ ...server(), title: 'Newer' }],
    reset: false,
    theme: 'classic',
    zone: INSTANCE,
  });
  replica.receive({
    version: 2,
    reminders: [{ ...server(), title: 'Older' }],
    reset: false,
    theme: 'classic',
    zone: INSTANCE,
  });
  expect(replica.version).toBe(3);
  expect(replica.view([], ZONE)[0]?.title).toBe('Newer');
});

test.each([
  [10, 10, 3],
  [11, 10, 3],
  [4, 10, 4],
])(
  'a reset to version 3 from version %i reconciles against the sent version %i, zone included',
  (version, since, expected) => {
    const kept = { name: 'America/New_York', fixed: true };
    const replica = new Replica({ version, reminders: [server()], zone: kept });
    replica.receive({ version: 3, reminders: [], reset: true, theme: 'classic', zone: INSTANCE }, since);
    expect(replica.version).toBe(expected);
    expect(replica.view([], ZONE)).toHaveLength(expected === 3 ? 0 : 1);
    expect(replica.zone).toEqual(expected === 3 ? INSTANCE : kept);
  },
);

test('a snapshot saved before pausing existed loads as not paused, so its notifications are not taken as settled', () => {
  const { paused: _, ...stored } = server();
  const [loaded] = new Replica({ version: 1, reminders: [stored] }).view([], ZONE);
  expect(loaded?.paused).toBeNull();
  expect(isSettledTag(`${ID}:2026-10-12T09:00`, loaded ? [loaded] : [], NOW)).toBe(false);
});
