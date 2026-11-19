import { describe, expect, test } from 'bun:test';
import { NAG_INTERVAL_MS, NAG_LIMIT, movedZone, type FollowUpSetting, type Notice } from '../src/shared/fire';
import { noticeKey } from '../src/shared/notification';
import { applyOp, type Op } from '../src/shared/ops';
import { dueAt, type ReminderFields } from '../src/shared/reminder';
import { MINUTE_MS, formatLocal, toLocal } from '../src/shared/time';
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
      const moved = movedZone(fired.reminder, ZONE, to, 30);
      expect(wallTimes(fireThrough(moved, at('2026-10-12T23:00'), to, 30).notices, to)).toEqual(expected);
    },
  );

  test('a snooze made after flying west past a notice that fired is followed up from when it wakes', () => {
    const ny = 'America/New_York';
    const created = applyOp(undefined, { type: 'put', id: ID, fields: fields() }, { now: utc(8, 0), zone: 'UTC' });
    if (!created) throw new Error('create failed');
    const moved = movedZone(fireThrough(created, utc(9, 0), 'UTC', 30).reminder, 'UTC', ny, 30);
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

  test('has its own notice key, the same whatever its delay, apart from any nag at that moment', () => {
    const followUpKey = (followUp: FollowUpSetting) =>
      noticeKeys({}, followUp).find(([alert]) => alert === 'again')?.[1];
    const others = noticeKeys({ important: true, alerts: [15] }, 15).map(([, key]) => key);
    expect(followUpKey(15)).toBeDefined();
    expect(followUpKey(15)).toBe(followUpKey(180));
    expect(others).not.toContain(followUpKey(15));
  });
});
