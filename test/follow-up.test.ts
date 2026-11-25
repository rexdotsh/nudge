import { describe, expect, test } from 'bun:test';
import {
  NAG_INTERVAL_MS,
  NAG_LIMIT,
  followUpFrom,
  movedZone,
  type FollowUpSetting,
  type Notice,
} from '../src/shared/fire';
import { fireId, noticeKey } from '../src/shared/notification';
import { parseFollowUpSetting } from '../src/shared/input';
import { applyOp, type Op } from '../src/shared/ops';
import { dueAt, fromStored, type ReminderFields } from '../src/shared/reminder';
import { HOUR_MS, MINUTE_MS, formatLocal, toLocal } from '../src/shared/time';
import { ID, ZONE, apply, at, create, daily, fields, fireThrough } from './planning';

const wallTimes = (notices: Notice[], zone = ZONE) =>
  notices.map(({ alert, at: instant }) => [alert, formatLocal(toLocal(instant, zone))]);

const noticeKeys = (overrides: Partial<ReminderFields>, followUp: FollowUpSetting) =>
  fireThrough(create(overrides, '2026-10-12T08:00'), at('2026-10-12T12:00'), ZONE, followUp).notices.map((notice) => [
    notice.alert,
    noticeKey(ID, notice),
  ]);

const utc = (hour: number, minute: number) => Date.UTC(2026, 9, 12, hour, minute);

const snooze = (until: string): Op => ({ type: 'snooze', id: ID, due: '2026-10-12T09:00', until: at(until) });

describe('follow-up', () => {
  type Act = [string, Op];
  const hourly = { rule: 'FREQ=HOURLY', anchor: 'schedule' } as const;

  test.each<[string, Partial<ReminderFields>, FollowUpSetting, Act[], string, string[][]]>([
    [
      'comes once, after the delay',
      {},
      30,
      [],
      '2026-10-12T23:00',
      [
        ['due', '2026-10-12T09:00'],
        ['again', '2026-10-12T09:30'],
      ],
    ],
    ['never comes while follow-ups are off', {}, 'off', [], '2026-10-12T23:00', [['due', '2026-10-12T09:00']]],
    [
      'never comes for an important reminder, which nags',
      { important: true },
      30,
      [],
      '2026-10-12T23:00',
      [
        ['due', '2026-10-12T09:00'],
        ...Array.from({ length: NAG_LIMIT }, (_, i) => [
          'nag',
          formatLocal(toLocal(at('2026-10-12T09:00') + (i + 1) * NAG_INTERVAL_MS, ZONE)),
        ]),
      ],
    ],
    [
      'is cancelled by done',
      {},
      30,
      [['2026-10-12T09:10', { type: 'complete', id: ID, due: '2026-10-12T09:00' }]],
      '2026-10-12T23:00',
      [['due', '2026-10-12T09:00']],
    ],
    [
      'is cancelled by a skip, and comes for the next occurrence',
      { repeat: daily },
      30,
      [['2026-10-12T09:10', { type: 'skip', id: ID, due: '2026-10-12T09:00' }]],
      '2026-10-13T12:00',
      [
        ['due', '2026-10-12T09:00'],
        ['due', '2026-10-13T09:00'],
        ['again', '2026-10-13T09:30'],
      ],
    ],
    [
      'is cancelled by a pause',
      { repeat: daily },
      30,
      [['2026-10-12T09:10', { type: 'pause', id: ID, until: null }]],
      '2026-10-14T12:00',
      [['due', '2026-10-12T09:00']],
    ],
    [
      'is cancelled by a delete',
      {},
      30,
      [['2026-10-12T09:10', { type: 'delete', id: ID }]],
      '2026-10-12T23:00',
      [['due', '2026-10-12T09:00']],
    ],
    [
      'moves with an edit of the time',
      {},
      30,
      [['2026-10-12T09:10', { type: 'put', id: ID, fields: fields({ start: '2026-10-12T11:00' }) }]],
      '2026-10-12T23:00',
      [
        ['due', '2026-10-12T09:00'],
        ['due', '2026-10-12T11:00'],
        ['again', '2026-10-12T11:30'],
      ],
    ],
    [
      'comes once after each snooze, counted from when it ends',
      {},
      30,
      [
        ['2026-10-12T09:05', snooze('2026-10-12T09:45')],
        ['2026-10-12T10:20', snooze('2026-10-12T11:00')],
      ],
      '2026-10-12T23:00',
      [
        ['due', '2026-10-12T09:00'],
        ['snoozed', '2026-10-12T09:45'],
        ['again', '2026-10-12T10:15'],
        ['snoozed', '2026-10-12T11:00'],
        ['again', '2026-10-12T11:30'],
      ],
    ],
    [
      'waits for a snooze that ends just when it would come, and follows that',
      {},
      30,
      [['2026-10-12T09:05', snooze('2026-10-12T09:30')]],
      '2026-10-12T23:00',
      [
        ['due', '2026-10-12T09:00'],
        ['snoozed', '2026-10-12T09:30'],
        ['again', '2026-10-12T10:00'],
      ],
    ],
    [
      'never comes when the next occurrence comes first',
      { repeat: hourly },
      60,
      [],
      '2026-10-12T11:30',
      [
        ['due', '2026-10-12T09:00'],
        ['due', '2026-10-12T10:00'],
        ['due', '2026-10-12T11:00'],
      ],
    ],
    [
      'is cancelled by a pause, and resuming does not bring it back',
      { repeat: daily },
      30,
      [
        ['2026-10-12T09:05', { type: 'pause', id: ID, until: null }],
        ['2026-10-12T09:10', { type: 'resume', id: ID }],
      ],
      '2026-10-12T23:00',
      [['due', '2026-10-12T09:00']],
    ],
    [
      'is cancelled by a delete, and restoring does not bring it back',
      {},
      30,
      [
        ['2026-10-12T09:05', { type: 'delete', id: ID }],
        ['2026-10-12T09:10', { type: 'restore', id: ID }],
      ],
      '2026-10-12T23:00',
      [['due', '2026-10-12T09:00']],
    ],
    [
      'comes for each occurrence that leaves it time',
      { repeat: hourly },
      30,
      [],
      '2026-10-12T10:45',
      [
        ['due', '2026-10-12T09:00'],
        ['again', '2026-10-12T09:30'],
        ['due', '2026-10-12T10:00'],
        ['again', '2026-10-12T10:30'],
      ],
    ],
  ])('%s', (_, overrides, followUp, acts, until, expected) => {
    let reminder = create(overrides, '2026-10-12T08:00');
    const notices: Notice[] = [];
    const steps: [string, Op | null][] = [...acts, [until, null]];
    for (const [when, op] of steps) {
      const fired = fireThrough(reminder, at(when), ZONE, followUp);
      notices.push(...fired.notices);
      reminder = op ? apply(fired.reminder, op, when) : fired.reminder;
    }
    expect(wallTimes(notices)).toEqual(expected);
  });

  test.each([
    ['flying west after it fired', 'Europe/London', '2026-10-12T09:40', []],
    ['flying west before it fired', 'Europe/London', '2026-10-12T09:10', [['again', '2026-10-12T05:00']]],
    ['flying east before it fired', 'Asia/Tokyo', '2026-10-12T09:10', [['again', '2026-10-12T13:00']]],
  ])(
    'a zone move neither repeats a follow-up nor moves it off the instant it follows: %s',
    (_, to, moveAt, expected) => {
      const fired = fireThrough(create({}, '2026-10-12T08:00'), at(moveAt), ZONE, 30);
      const moved = movedZone(fired.reminder, ZONE, to);
      expect(wallTimes(fireThrough(moved, at('2026-10-12T23:00'), to, 30).notices, to)).toEqual(expected);
    },
  );

  test.each<[string, FollowUpSetting, FollowUpSetting, number, number[]]>([
    ['turned on after flying west, it comes at its time', 'off', 30, utc(9, 10), [utc(9, 30)]],
    ['shortened after flying west, it comes at its new time', 30, 15, utc(9, 10), [utc(9, 15)]],
    ['turned on once its time has passed, it is not sent late', 'off', 30, utc(9, 40), []],
  ])('a follow-up setting chosen later: %s', (_, before, after, chosenAt, expected) => {
    const created = applyOp(undefined, { type: 'put', id: ID, fields: fields() }, { now: utc(8, 0), zone: 'UTC' });
    if (!created) throw new Error('create failed');
    const ny = 'America/New_York';
    const moved = movedZone(fireThrough(created, utc(9, 0), 'UTC', before).reminder, 'UTC', ny);
    const chosen = followUpFrom(moved, after, chosenAt);
    const { notices } = fireThrough(chosen, utc(23, 0), ny, after);
    expect(notices.filter(({ alert }) => alert === 'again').map(({ at: instant }) => instant)).toEqual(expected);
  });

  test('a snooze made after flying west past a notice that fired is followed up from when it wakes', () => {
    const ny = 'America/New_York';
    const created = applyOp(undefined, { type: 'put', id: ID, fields: fields() }, { now: utc(8, 0), zone: 'UTC' });
    if (!created) throw new Error('create failed');
    const moved = movedZone(fireThrough(created, utc(9, 0), 'UTC', 30).reminder, 'UTC', ny);
    const quiet: Op = { type: 'snooze', id: ID, due: '2026-10-12T09:00', until: utc(9, 25) };
    const snoozed = applyOp(moved, quiet, { now: utc(9, 10), zone: ny });
    if (!snoozed) throw new Error('snooze was rejected');
    const { notices } = fireThrough(snoozed, utc(23, 0), ny, 30);
    expect(notices.map(({ alert, at: instant }) => [alert, instant])).toEqual([
      ['snoozed', utc(9, 25)],
      ['again', utc(9, 55)],
    ]);
  });

  test('follows each daily occurrence once, by the real delay, across a daylight saving change', () => {
    const ny = 'America/New_York';
    const series = applyOp(
      undefined,
      { type: 'put', id: ID, fields: fields({ start: '2026-10-31T01:30', repeat: daily }) },
      { now: Date.UTC(2026, 9, 30), zone: ny },
    );
    if (!series) throw new Error('create failed');
    const { notices } = fireThrough(series, Date.UTC(2026, 10, 3), ny, 60);
    const fromDue = ({ alert, due, at: instant }: Notice) => [
      due,
      alert,
      instant - (dueAt({ ...series, due }, ny) ?? 0),
    ];
    expect(notices.map(fromDue)).toEqual(
      ['2026-10-31T01:30', '2026-11-01T01:30', '2026-11-02T01:30'].flatMap((due) => [
        [due, 'due', 0],
        [due, 'again', 60 * MINUTE_MS],
      ]),
    );
  });

  test('each follow-up has its own notice key, apart from any nag at that moment', () => {
    const fired = noticeKeys({}, { every: 15 }).filter(([alert]) => alert === 'again');
    const others = new Set(noticeKeys({ important: true, alerts: [15] }, { every: 15 }).map(([, key]) => key));
    expect(fired.length).toBeGreaterThan(2);
    expect(new Set(fired.map(([, key]) => key)).size).toBe(fired.length);
    expect(fired.filter(([, key]) => others.has(key))).toEqual([]);
  });
});

const EVERY_30: FollowUpSetting = { every: 30 };
const hours = (from: string, count: number, step = HOUR_MS) =>
  Array.from({ length: count }, (_, i) => ['again', formatLocal(toLocal(at(from) + i * step, ZONE))]);

describe('repeating follow-ups', () => {
  type Act = [string, Op | FollowUpSetting];
  const hourly = { rule: 'FREQ=HOURLY', anchor: 'schedule' } as const;

  // A setting chosen in an act applies the way the server applies it, from that moment on.
  test.each<[string, Partial<ReminderFields>, FollowUpSetting, Act[], string, string[][]]>([
    [
      'come every 30 minutes until it is done',
      {},
      EVERY_30,
      [['2026-10-12T10:40', { type: 'complete', id: ID, due: '2026-10-12T09:00' }]],
      '2026-10-13T12:00',
      [['due', '2026-10-12T09:00'], ...hours('2026-10-12T09:30', 3, 30 * MINUTE_MS)],
    ],
    [
      'stop a day after the notice they follow',
      {},
      { every: 60 },
      [],
      '2026-10-14T12:00',
      [['due', '2026-10-12T09:00'], ...hours('2026-10-12T10:00', 24)],
    ],
    [
      'stop when the next occurrence comes',
      { repeat: hourly },
      EVERY_30,
      [],
      '2026-10-12T10:45',
      [
        ['due', '2026-10-12T09:00'],
        ['again', '2026-10-12T09:30'],
        ['due', '2026-10-12T10:00'],
        ['again', '2026-10-12T10:30'],
      ],
    ],
    [
      'start again from the end of a snooze',
      {},
      EVERY_30,
      [['2026-10-12T09:35', snooze('2026-10-12T10:00')]],
      '2026-10-12T11:10',
      [
        ['due', '2026-10-12T09:00'],
        ['again', '2026-10-12T09:30'],
        ['snoozed', '2026-10-12T10:00'],
        ...hours('2026-10-12T10:30', 2, 30 * MINUTE_MS),
      ],
    ],
    [
      'follow on from one that came once, without sending it again',
      {},
      30,
      [['2026-10-12T09:40', EVERY_30]],
      '2026-10-12T10:45',
      [['due', '2026-10-12T09:00'], ...hours('2026-10-12T09:30', 3, 30 * MINUTE_MS)],
    ],
    [
      'stop when switched to once, which already came',
      {},
      EVERY_30,
      [['2026-10-12T09:40', 30]],
      '2026-10-12T23:00',
      [
        ['due', '2026-10-12T09:00'],
        ['again', '2026-10-12T09:30'],
      ],
    ],
    [
      'go on from the last one at a new pace',
      {},
      EVERY_30,
      [['2026-10-12T09:40', { every: 60 }]],
      '2026-10-12T11:45',
      [['due', '2026-10-12T09:00'], ...hours('2026-10-12T09:30', 3)],
    ],
    [
      'turned on late, start from then instead of sending what is overdue',
      {},
      'off',
      [['2026-10-12T11:10', EVERY_30]],
      '2026-10-12T12:15',
      [['due', '2026-10-12T09:00'], ...hours('2026-10-12T11:40', 2, 30 * MINUTE_MS)],
    ],
    [
      'quickened past one that is due, start from then',
      {},
      { every: 60 },
      [['2026-10-12T09:50', { every: 15 }]],
      '2026-10-12T10:25',
      [['due', '2026-10-12T09:00'], ...hours('2026-10-12T10:05', 2, 15 * MINUTE_MS)],
    ],
    [
      'stop when turned off',
      {},
      EVERY_30,
      [['2026-10-12T09:40', 'off']],
      '2026-10-12T23:00',
      [
        ['due', '2026-10-12T09:00'],
        ['again', '2026-10-12T09:30'],
      ],
    ],
    [
      'never come for an important reminder',
      { important: true },
      { every: 15 },
      [],
      '2026-10-12T23:00',
      [
        ['due', '2026-10-12T09:00'],
        ...Array.from({ length: NAG_LIMIT }, (_, i) => [
          'nag',
          formatLocal(toLocal(at('2026-10-12T09:00') + (i + 1) * NAG_INTERVAL_MS, ZONE)),
        ]),
      ],
    ],
  ])('%s', (_, overrides, initial, acts, until, expected) => {
    let reminder = create(overrides, '2026-10-12T08:00');
    let followUp = initial;
    const notices: Notice[] = [];
    const steps: [string, Op | FollowUpSetting | null][] = [...acts, [until, null]];
    for (const [when, act] of steps) {
      const fired = fireThrough(reminder, at(when), ZONE, followUp);
      notices.push(...fired.notices);
      reminder = fired.reminder;
      if (act === null) continue;
      if (typeof act === 'object' && 'type' in act) reminder = apply(reminder, act, when);
      else {
        followUp = act;
        reminder = followUpFrom(reminder, act, at(when));
      }
    }
    expect(wallTimes(notices)).toEqual(expected);
  });

  test('a zone move keeps going from the instant of the last one', () => {
    const fired = fireThrough(create({}, '2026-10-12T08:00'), at('2026-10-12T09:40'), ZONE, EVERY_30);
    const london = 'Europe/London';
    const moved = movedZone(fired.reminder, ZONE, london);
    const { notices } = fireThrough(moved, at('2026-10-12T06:10', london), london, EVERY_30);
    expect(wallTimes(notices, london)).toEqual([
      ['again', '2026-10-12T05:30'],
      ['again', '2026-10-12T06:00'],
    ]);
  });

  test('keep the real pace through the hour a daylight saving change repeats', () => {
    const ny = 'America/New_York';
    const reminder = applyOp(
      undefined,
      { type: 'put', id: ID, fields: fields({ start: '2026-11-01T00:30' }) },
      { now: Date.UTC(2026, 9, 31), zone: ny },
    );
    if (!reminder) throw new Error('create failed');
    const { notices } = fireThrough(reminder, Date.UTC(2026, 10, 1, 12), ny, { every: 60 });
    const instants = notices.map(({ at: instant }) => instant);
    expect(instants.slice(1).map((instant, i) => instant - (instants[i] ?? 0))).toEqual(
      Array.from({ length: instants.length - 1 }, () => HOUR_MS),
    );
    expect(new Set(notices.map((notice) => fireId(ID, notice))).size).toBe(notices.length);
  });

  test.each([
    ['one that went out ends them', true, []],
    ['one that did not still comes', false, ['2026-10-12T09:30']],
  ])('a notice recorded before follow-ups could repeat: %s', (_, followedUp, expected) => {
    const fired = fireThrough(create({}, '2026-10-12T08:00'), at('2026-10-12T09:00'), ZONE, 'off').reminder;
    const stored = { ...fired, cameUp: { due: '2026-10-12T09:00', at: at('2026-10-12T09:00'), followedUp } };
    const { notices } = fireThrough(fromStored(stored), at('2026-10-13T12:00'), ZONE, EVERY_30);
    expect(wallTimes(notices).slice(0, expected.length)).toEqual(expected.map((wall) => ['again', wall]));
    expect(notices.length > 0).toBe(!followedUp);
  });

  test.each<[unknown, FollowUpSetting | null]>([
    ['off', 'off'],
    [30, 30],
    [{ every: 30 }, { every: 30 }],
    [{ every: 60, extra: true }, { every: 60 }],
    [45, null],
    ['30', null],
    [{ every: 120 }, null],
    [{ every: '30' }, null],
    [{}, null],
    [null, null],
  ])('the setting %p reads as %p', (value, expected) => {
    expect(parseFollowUpSetting(value)).toEqual(expected);
  });
});
