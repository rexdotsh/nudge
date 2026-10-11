import { describe, expect, test } from 'bun:test';
import { NAG_INTERVAL_MS, NAG_LIMIT, fire, nextFireAt } from '../src/shared/fire';
import { parseFields, parseOp } from '../src/shared/input';
import { applyOp, type Clock, type Op } from '../src/shared/ops';
import { dueAt, isOverdue, type Reminder, type ReminderFields } from '../src/shared/reminder';
import { MINUTE_MS, toInstant, parseLocal } from '../src/shared/time';

const ZONE = 'Asia/Kolkata';
const ID = '01JA0000000000000000000000';

function at(wall: string, zone = ZONE): number {
  const parsed = parseLocal(wall);
  if (!parsed) throw new Error(wall);
  return toInstant(parsed, zone);
}

function fields(overrides: Partial<ReminderFields> = {}): ReminderFields {
  return {
    title: 'Water the plants',
    notes: '',
    start: '2026-10-12T09:00',
    zone: null,
    repeat: null,
    important: false,
    alerts: [],
    ...overrides,
  };
}

function apply(current: Reminder | undefined, op: Op, now: string): Reminder {
  const clock: Clock = { now: at(now), zone: ZONE };
  const next = applyOp(current, op, clock);
  if (!next) throw new Error(`op ${op.type} was rejected`);
  return next;
}

function create(overrides: Partial<ReminderFields> = {}, now = '2026-10-11T20:00'): Reminder {
  return apply(undefined, { type: 'put', id: ID, fields: fields(overrides) }, now);
}

const daily = { rule: 'FREQ=DAILY', anchor: 'schedule' } as const;

describe('put', () => {
  test('a one-off is due at its start, even in the past', () => {
    expect(create().due).toBe('2026-10-12T09:00');
    expect(create({ start: '2026-10-10T09:00' }).due).toBe('2026-10-10T09:00');
  });

  test('a repeating reminder starts at its first occurrence that is not in the past', () => {
    expect(create({ start: '2026-10-01T09:00', repeat: daily }, '2026-10-11T20:00').due).toBe('2026-10-12T09:00');
    expect(create({ start: '2026-10-11T21:00', repeat: daily }, '2026-10-11T20:00').due).toBe('2026-10-11T21:00');
  });

  test('editing text keeps the occurrence state; editing the schedule resets it', () => {
    const snoozed = apply(
      create(),
      { type: 'snooze', id: ID, due: '2026-10-12T09:00', until: at('2026-10-12T10:00') },
      '2026-10-12T09:01',
    );
    const renamed = apply(
      snoozed,
      { type: 'put', id: ID, fields: fields({ title: 'Water the monstera' }) },
      '2026-10-12T09:02',
    );
    expect(renamed.title).toBe('Water the monstera');
    expect(renamed.snoozedUntil).toBe(snoozed.snoozedUntil);

    const moved = apply(
      renamed,
      { type: 'put', id: ID, fields: fields({ start: '2026-10-13T09:00' }) },
      '2026-10-12T09:03',
    );
    expect(moved.due).toBe('2026-10-13T09:00');
    expect(moved.snoozedUntil).toBeNull();
    expect(moved.createdAt).toBe(renamed.createdAt);
  });
});

describe('complete, skip, snooze, reopen', () => {
  test('completing a one-off finishes it and ignores stale repeats of the op', () => {
    const done = apply(create(), { type: 'complete', id: ID, due: '2026-10-12T09:00' }, '2026-10-12T09:05');
    expect(done.due).toBeNull();
    expect(done.completedAt).toBe(at('2026-10-12T09:05'));
    expect(applyOp(done, { type: 'complete', id: ID, due: '2026-10-12T09:00' }, { now: 0, zone: ZONE })).toBeNull();
  });

  test('completing an overdue series jumps to the next future occurrence', () => {
    const series = create({ start: '2026-10-12T09:00', repeat: daily });
    const done = apply(series, { type: 'complete', id: ID, due: '2026-10-12T09:00' }, '2026-10-15T12:00');
    expect(done.due).toBe('2026-10-16T09:00');
    expect(done.missed).toBe(0);
  });

  test('completing early moves to the occurrence after the one completed', () => {
    const series = create({ start: '2026-10-12T09:00', repeat: daily });
    expect(apply(series, { type: 'complete', id: ID, due: '2026-10-12T09:00' }, '2026-10-11T22:00').due).toBe(
      '2026-10-13T09:00',
    );
  });

  test('completion-anchored repeats count from when it was done, at the start time of day', () => {
    const plants = create({ repeat: { rule: 'FREQ=DAILY;INTERVAL=3', anchor: 'completion' } });
    expect(apply(plants, { type: 'complete', id: ID, due: '2026-10-12T09:00' }, '2026-10-12T19:30').due).toBe(
      '2026-10-15T09:00',
    );

    const haircut = create({ start: '2026-01-31T10:00', repeat: { rule: 'FREQ=MONTHLY', anchor: 'completion' } });
    expect(apply(haircut, { type: 'complete', id: ID, due: '2026-01-31T10:00' }, '2026-01-31T18:00').due).toBe(
      '2026-02-28T10:00',
    );
  });

  test('skip advances a series without recording a completion, and is rejected for one-offs', () => {
    const series = create({ start: '2026-10-12T09:00', repeat: daily });
    const skipped = apply(series, { type: 'skip', id: ID, due: '2026-10-12T09:00' }, '2026-10-12T08:00');
    expect(skipped.due).toBe('2026-10-13T09:00');
    expect(skipped.completedAt).toBeNull();
    expect(applyOp(create(), { type: 'skip', id: ID, due: '2026-10-12T09:00' }, { now: 0, zone: ZONE })).toBeNull();
  });

  test('reopen restores an occurrence, which is how undo works', () => {
    const done = apply(create(), { type: 'complete', id: ID, due: '2026-10-12T09:00' }, '2026-10-12T09:05');
    const undone = apply(done, { type: 'reopen', id: ID, due: '2026-10-12T09:00', from: null }, '2026-10-12T09:06');
    expect(undone.due).toBe('2026-10-12T09:00');
    expect(undone.completedAt).toBeNull();
  });

  test('a replayed reopen cannot rewind state that moved on since', () => {
    const series = create({ start: '2026-10-12T09:00', repeat: daily });
    const first = apply(series, { type: 'complete', id: ID, due: '2026-10-12T09:00' }, '2026-10-12T09:05');
    const undo = { type: 'reopen', id: ID, due: '2026-10-12T09:00', from: '2026-10-13T09:00' } as const;
    const reopened = apply(first, undo, '2026-10-12T09:06');
    const again = apply(reopened, { type: 'complete', id: ID, due: '2026-10-12T09:00' }, '2026-10-12T09:07');
    expect(again.due).toBe('2026-10-13T09:00');
    const later = apply(again, { type: 'complete', id: ID, due: '2026-10-13T09:00' }, '2026-10-13T09:05');
    expect(applyOp(later, undo, { now: at('2026-10-13T09:06'), zone: ZONE })).toBeNull();
  });

  test('delete and restore only toggle the tombstone', () => {
    const deleted = apply(create(), { type: 'delete', id: ID }, '2026-10-11T21:00');
    expect(deleted.deleted).toBe(true);
    expect(apply(deleted, { type: 'restore', id: ID }, '2026-10-11T21:01').deleted).toBe(false);
    expect(applyOp(undefined, { type: 'delete', id: ID }, { now: 0, zone: ZONE })).toBeNull();
  });
});

describe('replayed writes never swallow notices', () => {
  test('replaying an identical put after the due time still lets the due notice fire', () => {
    const reminder = create();
    const replayed = apply(reminder, { type: 'put', id: ID, fields: fields() }, '2026-10-12T09:03');
    expect(fire(replayed, at('2026-10-12T09:04'), ZONE).notice?.alert).toBe('due');
  });

  test('adding an early alert that is already past does not fire it, but keeps the due notice', () => {
    const reminder = create();
    const edited = apply(reminder, { type: 'put', id: ID, fields: fields({ alerts: [60] }) }, '2026-10-12T08:30');
    expect(nextFireAt(edited, ZONE)).toBe(at('2026-10-12T09:00'));
    const late = apply(reminder, { type: 'put', id: ID, fields: fields({ alerts: [60] }) }, '2026-10-12T09:30');
    expect(fire(late, at('2026-10-12T09:31'), ZONE).notice?.alert).toBe('due');
  });

  test('replaying a snooze after it ended still lets the wake-up fire once', () => {
    const fired = fire(create(), at('2026-10-12T09:00'), ZONE).reminder;
    const snooze = { type: 'snooze', id: ID, due: '2026-10-12T09:00', until: at('2026-10-12T09:15') } as const;
    const snoozed = apply(fired, snooze, '2026-10-12T09:01');
    const replayed = apply(snoozed, snooze, '2026-10-12T09:20');
    const woke = fire(replayed, at('2026-10-12T09:21'), ZONE);
    expect(woke.notice?.alert).toBe('snoozed');
    expect(fire(apply(woke.reminder, snooze, '2026-10-12T09:22'), at('2026-10-12T09:23'), ZONE).notice).toBeNull();
  });
});

describe('firing', () => {
  test('early alert, then due, then nothing', () => {
    let reminder = create({ alerts: [60] });
    expect(nextFireAt(reminder, ZONE)).toBe(at('2026-10-12T08:00'));

    const early = fire(reminder, at('2026-10-12T08:00'), ZONE);
    expect(early.notice).toMatchObject({ alert: 'early', due: '2026-10-12T09:00' });
    reminder = early.reminder;
    expect(nextFireAt(reminder, ZONE)).toBe(at('2026-10-12T09:00'));

    const due = fire(reminder, at('2026-10-12T09:00'), ZONE);
    expect(due.notice?.alert).toBe('due');
    expect(nextFireAt(due.reminder, ZONE)).toBeNull();
  });

  test('alerts that were already in the past at creation never fire', () => {
    const reminder = create({ start: '2026-10-11T20:30', alerts: [60] }, '2026-10-11T20:00');
    expect(nextFireAt(reminder, ZONE)).toBe(at('2026-10-11T20:30'));
  });

  test('important reminders nag every 15 minutes, a limited number of times', () => {
    let reminder = fire(create({ important: true }), at('2026-10-12T09:00'), ZONE).reminder;
    const nags: number[] = [];
    for (let next = nextFireAt(reminder, ZONE); next !== null; next = nextFireAt(reminder, ZONE)) {
      const fired = fire(reminder, next, ZONE);
      expect(fired.notice?.alert).toBe('nag');
      nags.push(next);
      reminder = fired.reminder;
    }
    expect(nags).toHaveLength(NAG_LIMIT);
    expect(nags[0]).toBe(at('2026-10-12T09:00') + NAG_INTERVAL_MS);
  });

  test('snoozing silences until the snooze ends, then nagging restarts from there', () => {
    const fired = fire(create({ important: true }), at('2026-10-12T09:00'), ZONE).reminder;
    const snoozed = apply(
      fired,
      { type: 'snooze', id: ID, due: '2026-10-12T09:00', until: at('2026-10-12T11:00') },
      '2026-10-12T09:01',
    );
    expect(nextFireAt(snoozed, ZONE)).toBe(at('2026-10-12T11:00'));
    const woke = fire(snoozed, at('2026-10-12T11:00'), ZONE);
    expect(woke.notice?.alert).toBe('snoozed');
    expect(nextFireAt(woke.reminder, ZONE)).toBe(at('2026-10-12T11:00') + NAG_INTERVAL_MS);
  });

  test('an unfinished occurrence rolls into the next one and counts as missed', () => {
    const series = fire(create({ repeat: daily }), at('2026-10-12T09:00'), ZONE).reminder;
    expect(nextFireAt(series, ZONE)).toBe(at('2026-10-13T09:00'));
    const rolled = fire(series, at('2026-10-13T09:00'), ZONE);
    expect(rolled.reminder.due).toBe('2026-10-13T09:00');
    expect(rolled.notice).toMatchObject({ alert: 'due', due: '2026-10-13T09:00', missed: 1 });
  });

  test('a snooze longer than the repeat interval holds through the roll', () => {
    const series = fire(create({ repeat: daily }), at('2026-10-12T09:00'), ZONE).reminder;
    const snoozed = apply(
      series,
      { type: 'snooze', id: ID, due: '2026-10-12T09:00', until: at('2026-10-13T12:00') },
      '2026-10-12T09:05',
    );
    const rolled = fire(snoozed, at('2026-10-13T09:00'), ZONE);
    expect(rolled.notice).toBeNull();
    expect(rolled.reminder).toMatchObject({ due: '2026-10-13T09:00', missed: 1, snoozedUntil: at('2026-10-13T12:00') });
    const woke = fire(rolled.reminder, at('2026-10-13T12:00'), ZONE);
    expect(woke.notice).toMatchObject({ alert: 'snoozed', due: '2026-10-13T09:00', missed: 1 });
  });

  test('a late alarm sends one notice for the latest step, not a burst', () => {
    const late = fire(create({ repeat: daily, alerts: [30] }), at('2026-10-15T09:10'), ZONE);
    expect(late.reminder.due).toBe('2026-10-15T09:00');
    expect(late.notice).toMatchObject({ alert: 'due', due: '2026-10-15T09:00', missed: 3 });
  });

  test('deleted and finished reminders never fire', () => {
    expect(nextFireAt(apply(create(), { type: 'delete', id: ID }, '2026-10-11T21:00'), ZONE)).toBeNull();
    expect(
      nextFireAt(apply(create(), { type: 'complete', id: ID, due: '2026-10-12T09:00' }, '2026-10-11T21:00'), ZONE),
    ).toBeNull();
  });
});

describe('time zones', () => {
  test('floating reminders follow the current zone; pinned ones do not', () => {
    const floating = create();
    expect(dueAt(floating, 'Asia/Kolkata')).toBe(Date.UTC(2026, 9, 12, 3, 30));
    expect(dueAt(floating, 'Europe/Paris')).toBe(Date.UTC(2026, 9, 12, 7, 0));

    const pinned = create({ zone: 'Asia/Kolkata' });
    expect(dueAt(pinned, 'Europe/Paris')).toBe(Date.UTC(2026, 9, 12, 3, 30));
  });

  test('isOverdue respects snoozes', () => {
    const reminder = create();
    expect(isOverdue(reminder, at('2026-10-12T09:00'), ZONE)).toBe(true);
    expect(isOverdue({ ...reminder, snoozedUntil: at('2026-10-12T10:00') }, at('2026-10-12T09:30'), ZONE)).toBe(false);
    expect(isOverdue(reminder, at('2026-10-12T09:00') - MINUTE_MS, ZONE)).toBe(false);
  });
});

describe('input validation', () => {
  test('accepts well-formed fields and normalizes them', () => {
    expect(parseFields({ ...fields(), title: '  Call mom  ', alerts: [1440, 60] })).toMatchObject({
      title: 'Call mom',
      alerts: [60, 1440],
    });
  });

  test('rejects malformed fields', () => {
    for (const bad of [
      null,
      { ...fields(), title: '   ' },
      { ...fields(), title: 'x'.repeat(201) },
      { ...fields(), start: '2026-02-30T09:00' },
      { ...fields(), zone: 'Mars/Base' },
      { ...fields(), alerts: [60, 60] },
      { ...fields(), alerts: [0] },
      { ...fields(), repeat: { rule: 'FREQ=MINUTELY', anchor: 'schedule' } },
      { ...fields(), repeat: { rule: 'FREQ=WEEKLY;BYDAY=MO', anchor: 'completion' } },
      { ...fields(), important: 'yes' },
      { ...fields(), repeat: { rule: 'FREQ=DAILY;UNTIL=20260230T090000Z', anchor: 'schedule' } },
    ]) {
      expect(parseFields(bad)).toBeNull();
    }
  });

  test('parses each op shape and rejects junk', () => {
    expect(parseOp({ type: 'complete', id: ID, due: '2026-10-12T09:00' })).toEqual({
      type: 'complete',
      id: ID,
      due: '2026-10-12T09:00',
    });
    expect(parseOp({ type: 'snooze', id: ID, due: '2026-10-12T09:00', until: 5 })?.type).toBe('snooze');
    expect(parseOp({ type: 'delete', id: ID })).toEqual({ type: 'delete', id: ID });
    expect(parseOp({ type: 'reopen', id: ID, due: '2026-10-12T09:00', from: null })?.type).toBe('reopen');
    expect(parseOp({ type: 'reopen', id: ID, due: '2026-10-12T09:00' })).toBeNull();
    expect(parseOp({ type: 'complete', id: ID })).toBeNull();
    expect(parseOp({ type: 'explode', id: ID })).toBeNull();
    expect(parseOp({ type: 'delete', id: 'nope' })).toBeNull();
  });
});
