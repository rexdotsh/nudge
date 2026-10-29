import { expect, test } from 'bun:test';
import { recentlyCompleted } from '../src/app/lib/sections';
import { triage } from '../src/shared/triage';
import { applyOp } from '../src/shared/ops';
import type { Reminder } from '../src/shared/reminder';
import { HOUR_MS } from '../src/shared/time';
import { ulid } from '../src/shared/ulid';

const ZONE = 'Asia/Kolkata';
const NOW = Date.UTC(2026, 9, 12, 10, 30);

function reminder(start: string, overrides: Partial<Reminder> = {}): Reminder {
  const fields = { title: start, notes: '', start, zone: null, repeat: null, important: false, alerts: [] };
  const created = applyOp(undefined, { type: 'put', id: ulid(), fields }, { now: NOW - 48 * HOUR_MS, zone: ZONE });
  if (!created) throw new Error('create failed');
  return { ...created, ...overrides };
}

test.each([
  ['nothing', []],
  ['only later', ['2026-10-14T09:00', '2026-11-01T09:00']],
  ['late and soon', ['2026-10-12T09:00', '2026-10-12T16:30', '2026-10-12T17:00', '2026-10-13T08:00']],
  ['only late', ['2026-10-11T09:00', '2026-10-12T10:00']],
  ['today but not soon', ['2026-10-12T23:00', '2026-10-12T22:00']],
])('every open reminder shows up exactly once: %s', (_, starts) => {
  const reminders = [
    ...starts.map((start) => reminder(start)),
    reminder('2026-10-12T18:00', { deleted: true }),
    reminder('2026-10-10T09:00', { due: null }),
    reminder('2026-10-12T09:30', { paused: { at: NOW - HOUR_MS, until: null } }),
  ];
  const { focus, late, today, later, paused } = triage(reminders, NOW, ZONE);
  const shown = [
    ...[focus, ...late, ...today, ...later].flatMap((entry) => (entry ? [entry.reminder.id] : [])),
    ...paused.map(({ id }) => id),
  ];
  const open = reminders.filter((item) => !item.deleted && item.due !== null).map((item) => item.id);
  expect(shown.toSorted()).toEqual(open.toSorted());
});

test('Completed offers only finished reminders, so clearing it can never end a repeating series', () => {
  const clock = { now: NOW, zone: ZONE };
  const complete = (item: Reminder) => applyOp(item, { type: 'complete', id: item.id, due: item.due ?? '' }, clock);
  const once = complete(reminder('2026-10-12T09:00'));
  const series = complete(reminder('2026-10-12T09:00', { repeat: { rule: 'FREQ=DAILY', anchor: 'schedule' } }));
  if (!once || !series) throw new Error('complete failed');
  expect(series.due).not.toBeNull();
  expect(recentlyCompleted([once, series], NOW).map((entry) => entry.reminder.id)).toEqual([once.id]);
});
