import { describe, expect, test } from 'bun:test';
import { nextOccurrence, occurrences } from '../src/shared/occurrences';
import { RuleError, formatRule, parseRule } from '../src/shared/rrule';
import { formatLocal, parseLocal, toInstant, toLocal, type LocalDateTime } from '../src/shared/time';

const NY = 'America/New_York';

function local(text: string): LocalDateTime {
  const parsed = parseLocal(text);
  if (!parsed) throw new Error(`bad local ${text}`);
  return parsed;
}

function expand(text: string, start: string, limit = 40, zone = NY, after = -Infinity): string[] {
  const out: string[] = [];
  for (const instant of occurrences(parseRule(text), local(start), zone, after)) {
    out.push(formatLocal(toLocal(instant, zone)));
    if (out.length === limit) break;
  }
  return out;
}

const dates = (...days: string[]) => days.map((day) => `${day}T09:00`);

describe('RFC 5545 examples (America/New_York)', () => {
  test('daily for 10 occurrences', () => {
    expect(expand('FREQ=DAILY;COUNT=10', '1997-09-02T09:00')).toEqual(
      dates(
        '1997-09-02',
        '1997-09-03',
        '1997-09-04',
        '1997-09-05',
        '1997-09-06',
        '1997-09-07',
        '1997-09-08',
        '1997-09-09',
        '1997-09-10',
        '1997-09-11',
      ),
    );
  });

  test('every 10 days, 5 occurrences', () => {
    expect(expand('FREQ=DAILY;INTERVAL=10;COUNT=5', '1997-09-02T09:00')).toEqual(
      dates('1997-09-02', '1997-09-12', '1997-09-22', '1997-10-02', '1997-10-12'),
    );
  });

  test('every other week on Monday, Wednesday and Friday until December 24', () => {
    expect(
      expand('FREQ=WEEKLY;INTERVAL=2;UNTIL=19971224T000000Z;BYDAY=MO,WE,FR', '1997-09-01T09:00').map((d) =>
        d.slice(0, 10),
      ),
    ).toEqual([
      '1997-09-01',
      '1997-09-03',
      '1997-09-05',
      '1997-09-15',
      '1997-09-17',
      '1997-09-19',
      '1997-09-29',
      '1997-10-01',
      '1997-10-03',
      '1997-10-13',
      '1997-10-15',
      '1997-10-17',
      '1997-10-27',
      '1997-10-29',
      '1997-10-31',
      '1997-11-10',
      '1997-11-12',
      '1997-11-14',
      '1997-11-24',
      '1997-11-26',
      '1997-11-28',
      '1997-12-08',
      '1997-12-10',
      '1997-12-12',
      '1997-12-22',
    ]);
  });

  test('monthly on the first Friday for 10 occurrences', () => {
    expect(expand('FREQ=MONTHLY;COUNT=10;BYDAY=1FR', '1997-09-05T09:00')).toEqual(
      dates(
        '1997-09-05',
        '1997-10-03',
        '1997-11-07',
        '1997-12-05',
        '1998-01-02',
        '1998-02-06',
        '1998-03-06',
        '1998-04-03',
        '1998-05-01',
        '1998-06-05',
      ),
    );
  });

  test('monthly on the second-to-last Monday for 6 months', () => {
    expect(expand('FREQ=MONTHLY;COUNT=6;BYDAY=-2MO', '1997-09-22T09:00')).toEqual(
      dates('1997-09-22', '1997-10-20', '1997-11-17', '1997-12-22', '1998-01-19', '1998-02-16'),
    );
  });

  test('monthly on the third-to-last day', () => {
    expect(expand('FREQ=MONTHLY;BYMONTHDAY=-3', '1997-09-28T09:00', 6)).toEqual(
      dates('1997-09-28', '1997-10-29', '1997-11-28', '1997-12-29', '1998-01-29', '1998-02-26'),
    );
  });

  test('monthly on the 2nd and 15th for 10 occurrences', () => {
    expect(expand('FREQ=MONTHLY;COUNT=10;BYMONTHDAY=2,15', '1997-09-02T09:00')).toEqual(
      dates(
        '1997-09-02',
        '1997-09-15',
        '1997-10-02',
        '1997-10-15',
        '1997-11-02',
        '1997-11-15',
        '1997-12-02',
        '1997-12-15',
        '1998-01-02',
        '1998-01-15',
      ),
    );
  });

  test('yearly in June and July for 10 occurrences', () => {
    expect(expand('FREQ=YEARLY;COUNT=10;BYMONTH=6,7', '1997-06-10T09:00')).toEqual(
      dates(
        '1997-06-10',
        '1997-07-10',
        '1998-06-10',
        '1998-07-10',
        '1999-06-10',
        '1999-07-10',
        '2000-06-10',
        '2000-07-10',
        '2001-06-10',
        '2001-07-10',
      ),
    );
  });

  test('every Friday the 13th', () => {
    expect(expand('FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13', '1997-09-02T09:00', 5)).toEqual(
      dates('1998-02-13', '1998-03-13', '1998-11-13', '1999-08-13', '2000-10-13'),
    );
  });

  test('the last work day of the month', () => {
    expect(expand('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', '1997-09-30T09:00', 7)).toEqual(
      dates('1997-09-30', '1997-10-31', '1997-11-28', '1997-12-31', '1998-01-30', '1998-02-27', '1998-03-31'),
    );
  });

  test('the third Tuesday, Wednesday or Thursday of the month for 3 occurrences', () => {
    expect(expand('FREQ=MONTHLY;COUNT=3;BYDAY=TU,WE,TH;BYSETPOS=3', '1997-09-04T09:00')).toEqual(
      dates('1997-09-04', '1997-10-07', '1997-11-06'),
    );
  });

  test('yearly on the 20th Monday of the year', () => {
    expect(expand('FREQ=YEARLY;BYDAY=20MO', '1997-05-19T09:00', 3)).toEqual(
      dates('1997-05-19', '1998-05-18', '1999-05-17'),
    );
  });

  test('every Thursday in March', () => {
    expect(expand('FREQ=YEARLY;BYMONTH=3;BYDAY=TH', '1997-03-13T09:00', 7)).toEqual(
      dates('1997-03-13', '1997-03-20', '1997-03-27', '1998-03-05', '1998-03-12', '1998-03-19', '1998-03-26'),
    );
  });

  test('US presidential election day', () => {
    expect(
      expand('FREQ=YEARLY;INTERVAL=4;BYMONTH=11;BYDAY=TU;BYMONTHDAY=2,3,4,5,6,7,8', '1996-11-05T09:00', 3),
    ).toEqual(dates('1996-11-05', '2000-11-07', '2004-11-02'));
  });
});

describe('reminder-shaped rules', () => {
  test('the start counts only if it matches the rule', () => {
    expect(expand('FREQ=WEEKLY;BYDAY=MO', '2026-10-14T09:00', 2)).toEqual(dates('2026-10-19', '2026-10-26'));
  });

  test('a rule without day parts repeats on the start weekday, month day or date', () => {
    expect(expand('FREQ=WEEKLY;INTERVAL=2', '2026-10-14T09:00', 3)).toEqual(
      dates('2026-10-14', '2026-10-28', '2026-11-11'),
    );
    expect(expand('FREQ=MONTHLY', '2026-01-31T09:00', 4)).toEqual(
      dates('2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31'),
    );
    expect(expand('FREQ=YEARLY', '2024-02-29T09:00', 2)).toEqual(dates('2024-02-29', '2028-02-29'));
  });

  test('the last day of every month', () => {
    expect(expand('FREQ=MONTHLY;BYMONTHDAY=-1', '2026-01-10T09:00', 4)).toEqual(
      dates('2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'),
    );
  });

  test('every quarter on the 1st', () => {
    expect(expand('FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1', '2026-10-01T09:00', 3)).toEqual(
      dates('2026-10-01', '2027-01-01', '2027-04-01'),
    );
  });

  test('several times a day on weekdays', () => {
    expect(expand('FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9,13,17;BYMINUTE=30', '2026-10-16T00:00', 5)).toEqual([
      '2026-10-16T09:30',
      '2026-10-16T13:30',
      '2026-10-16T17:30',
      '2026-10-19T09:30',
      '2026-10-19T13:30',
    ]);
  });

  test('times of day with different minutes, picked by BYSETPOS, across spring-forward', () => {
    expect(expand('FREQ=DAILY;BYHOUR=2,21;BYMINUTE=0,30;BYSETPOS=2,3', '2026-03-07T00:00', 5)).toEqual([
      '2026-03-07T02:30',
      '2026-03-07T21:00',
      '2026-03-08T03:30',
      '2026-03-08T21:00',
      '2026-03-09T02:30',
    ]);
  });

  test('every 5 hours keeps its cadence across midnight', () => {
    expect(expand('FREQ=HOURLY;INTERVAL=5', '2026-10-11T20:15', 4)).toEqual([
      '2026-10-11T20:15',
      '2026-10-12T01:15',
      '2026-10-12T06:15',
      '2026-10-12T11:15',
    ]);
  });
});

describe('time zones', () => {
  test('wall-clock times survive DST transitions', () => {
    const instants = [...occurrences(parseRule('FREQ=DAILY;COUNT=3'), local('2026-10-31T09:00'), NY)];
    expect(instants.map((t) => new Date(t).toISOString())).toEqual([
      '2026-10-31T13:00:00.000Z',
      '2026-11-01T14:00:00.000Z',
      '2026-11-02T14:00:00.000Z',
    ]);
  });

  test('a time skipped by spring-forward moves forward by the gap', () => {
    expect(expand('FREQ=DAILY;COUNT=3', '2026-03-07T02:30', 3)).toEqual([
      '2026-03-07T02:30',
      '2026-03-08T03:30',
      '2026-03-09T02:30',
    ]);
  });

  test('a repeated fall-back time resolves to the first occurrence', () => {
    expect(new Date(toInstant(local('2026-11-01T01:30'), NY)).toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  test('the same rule fires at different instants in different zones', () => {
    const rule = parseRule('FREQ=DAILY');
    const start = local('2026-10-11T09:00');
    expect(nextOccurrence(rule, start, 'Asia/Kolkata', 0)).toBe(Date.UTC(2026, 9, 11, 3, 30));
    expect(nextOccurrence(rule, start, 'Europe/London', 0)).toBe(Date.UTC(2026, 9, 11, 8, 0));
  });
});

describe('nextOccurrence', () => {
  test('finds the next match strictly after the given instant, far from the start', () => {
    const rule = parseRule('FREQ=MONTHLY;BYDAY=-1FR');
    const after = Date.UTC(2031, 4, 30, 23, 0);
    expect(formatLocal(toLocal(nextOccurrence(rule, local('2026-10-11T19:00'), NY, after) ?? 0, NY))).toBe(
      '2031-06-27T19:00',
    );
  });

  test('respects COUNT from the start even when asked about the far future', () => {
    const rule = parseRule('FREQ=WEEKLY;COUNT=3');
    const start = local('2026-10-12T09:00');
    expect(nextOccurrence(rule, start, NY, toInstant(local('2026-10-19T09:00'), NY))).toBe(
      toInstant(local('2026-10-26T09:00'), NY),
    );
    expect(nextOccurrence(rule, start, NY, toInstant(local('2026-10-26T09:00'), NY))).toBeNull();
  });

  test('stops at UNTIL', () => {
    const rule = parseRule('FREQ=DAILY;UNTIL=20261013T130000Z');
    expect(expand(formatRule(rule), '2026-10-11T09:00')).toEqual(dates('2026-10-11', '2026-10-12', '2026-10-13'));
  });

  test('finds sparse occurrences years away, even for hourly rules', () => {
    expect(expand('FREQ=HOURLY;BYMONTH=2;BYMONTHDAY=29', '2026-03-01T09:00', 2, 'UTC')).toEqual([
      '2028-02-29T00:00',
      '2028-02-29T01:00',
    ]);
    expect(expand('FREQ=YEARLY;INTERVAL=3;BYMONTH=2;BYMONTHDAY=29', '2025-01-01T09:00', 2, 'UTC')).toEqual([
      '2028-02-29T09:00',
      '2040-02-29T09:00',
    ]);
  });

  test.each([
    'FREQ=HOURLY;BYMONTH=2;BYMONTHDAY=30',
    'FREQ=HOURLY;INTERVAL=5;BYMONTH=2;BYMONTHDAY=30',
    'FREQ=HOURLY;INTERVAL=24;BYMONTH=2;BYMONTHDAY=30',
    'FREQ=DAILY;INTERVAL=997;BYMONTH=2;BYMONTHDAY=30',
    'FREQ=WEEKLY;INTERVAL=1000;BYMONTH=2;BYMONTHDAY=30',
    'FREQ=MONTHLY;INTERVAL=1000;BYMONTH=2;BYMONTHDAY=30',
    'FREQ=YEARLY;INTERVAL=1000;BYMONTH=2;BYMONTHDAY=30',
  ])('gives up on a rule that can never match: %s', (text) => {
    expect(nextOccurrence(parseRule(text), local('2026-01-01T09:00'), NY, 0)).toBeNull();
  });
});

describe('parse and format', () => {
  test('round-trips normalized rules', () => {
    for (const text of [
      'FREQ=DAILY',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH',
      'FREQ=MONTHLY;BYDAY=-1FR',
      'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
      'FREQ=YEARLY;BYMONTH=5;BYDAY=2SU;COUNT=4',
      'FREQ=DAILY;BYHOUR=8,20;BYMINUTE=0;UNTIL=20261231T183000Z',
    ]) {
      expect(formatRule(parseRule(text))).toBe(text);
    }
  });

  test('rejects malformed and unsupported rules', () => {
    for (const text of [
      '',
      'FREQ=SECONDLY',
      'FREQ=DAILY;INTERVAL=0',
      'FREQ=DAILY;BYMONTHDAY=0',
      'FREQ=DAILY;BYDAY=XX',
      'FREQ=DAILY;COUNT=2;UNTIL=20261231T000000Z',
      'FREQ=DAILY;BYWEEKNO=1',
      'FREQ=DAILY;WKST=SU',
      'FREQ=DAILY;FREQ=WEEKLY',
      'FREQ=DAILY;UNTIL=20261231',
      'FREQ=DAILY;UNTIL=20260230T000000Z',
      'FREQ=DAILY;UNTIL=20261231T240000Z',
      'FREQ=HOURLY;BYHOUR=9',
      'FREQ=HOURLY;INTERVAL=25',
    ]) {
      expect(() => parseRule(text)).toThrow(RuleError);
    }
  });
});
