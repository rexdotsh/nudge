import { describe, expect, test } from 'bun:test';
import { describeRepeat } from '../src/shared/describe';
import { parseQuickAdd, suggestedStart } from '../src/shared/quick-add';
import { parseLocal, toInstant } from '../src/shared/time';

const ZONE = 'Asia/Kolkata';
const at = (wall: string) => {
  const local = parseLocal(wall);
  if (!local) throw new Error(wall);
  return toInstant(local, ZONE);
};
const NOW = at('2026-10-11T19:43');
const parse = (text: string) => parseQuickAdd(text, NOW, ZONE);

describe('parseQuickAdd', () => {
  test.each([
    ['call mom tomorrow 6pm', 'call mom', '2026-10-12T18:00', null],
    ['water plants in 20m', 'water plants', '2026-10-11T20:03', null],
    ['dinner fri 7pm', 'dinner', '2026-10-16T19:00', null],
    ['dentist oct 20 at 3:30pm', 'dentist', '2026-10-20T15:30', null],
    ['anniversary march 3', 'anniversary', '2027-03-03T09:00', null],
    ['remind me to call bank at 5', 'call bank', '2026-10-12T17:00', null],
    ['send report on the 14th', 'send report', '2026-10-14T09:00', null],
    ['meeting tonight', 'meeting', '2026-10-11T20:00', null],
    ['call 2026-12-01 noon', 'call', '2026-12-01T12:00', null],
    ['ship it in half an hour', 'ship it', '2026-10-11T20:13', null],
    ['buy milk', 'buy milk', null, null],
    ['pay rent every 1st', 'pay rent', '2026-10-11T09:00', 'FREQ=MONTHLY;BYMONTHDAY=1'],
    ['pay card on the 1st and 15th', 'pay card', '2026-10-11T09:00', 'FREQ=MONTHLY;BYMONTHDAY=1,15'],
    ['book club last fri of the month 7pm', 'book club', '2026-10-11T19:00', 'FREQ=MONTHLY;BYDAY=-1FR'],
    ['team sync every other tue & thu at 10:30', 'team sync', '2026-10-11T10:30', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH'],
    [
      'timesheet last weekday of the month 4pm',
      'timesheet',
      '2026-10-11T16:00',
      'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
    ],
    ['call mom 2nd sunday of may', 'call mom', '2026-10-11T09:00', 'FREQ=YEARLY;BYMONTH=5;BYDAY=2SU'],
    [
      'gym every mon, wed & fri 7am until dec 20',
      'gym',
      '2026-10-11T07:00',
      'FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261220T182900Z',
    ],
    ['invoice every 2 months on the 5th', 'invoice', '2026-10-11T09:00', 'FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=5'],
    [
      'renew passport every 10 years on mar 14',
      'renew passport',
      '2026-10-11T09:00',
      'FREQ=YEARLY;INTERVAL=10;BYMONTH=3;BYMONTHDAY=14',
    ],
    ['meds every 8 hours', 'meds', '2026-10-11T19:43', 'FREQ=HOURLY;INTERVAL=8'],
    ['take pills at 8am and 8pm every day', 'take pills', '2026-10-11T08:00', 'FREQ=DAILY;BYHOUR=8,20;BYMINUTE=0'],
    ['stretch every 2 hours from 9 to 5', 'stretch', '2026-10-11T09:00', 'FREQ=DAILY;BYHOUR=9,11,13,15,17;BYMINUTE=0'],
    ['standup weekdays at 9:30', 'standup', '2026-10-11T09:30', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'],
    ['taxes every 15th of march', 'taxes', '2026-10-11T09:00', 'FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=15'],
    [
      'take out trash every sun at 8pm for 3 weeks',
      'take out trash',
      '2026-10-11T20:00',
      'FREQ=WEEKLY;BYDAY=SU;UNTIL=20261031T182900Z',
    ],
    ['yoga every morning', 'yoga', '2026-10-11T09:00', 'FREQ=DAILY'],
    ['bills every quarter on the 1st', 'bills', '2026-10-11T09:00', 'FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1'],
    ['backup every 48 hours', 'backup', '2026-10-11T09:00', 'FREQ=DAILY;INTERVAL=2'],
  ])('%p', (text, title, start, rule) => {
    const parsed = parse(text);
    expect(parsed.title).toBe(title);
    expect(parsed.start).toBe(start);
    expect(parsed.repeat?.rule ?? null).toBe(rule);
  });

  test('completion-anchored repeats start at the next free slot', () => {
    expect(parse('water the monstera every 3 days after done')).toMatchObject({
      title: 'water the monstera',
      start: '2026-10-12T09:00',
      repeat: { rule: 'FREQ=DAILY;INTERVAL=3', anchor: 'completion' },
    });
  });

  test('exclamation marks flag a reminder as important', () => {
    expect(parse('Book flights!')).toMatchObject({ title: 'Book flights', important: true });
    expect(parse('vitamins every day at 9pm !')).toMatchObject({
      title: 'vitamins',
      important: true,
      start: '2026-10-11T21:00',
    });
    expect(parse('hello').important).toBe(false);
  });

  test('spans mark exactly what was understood', () => {
    const text = 'call mom tomorrow 6pm';
    const parsed = parse(text);
    expect(parsed.spans.map(({ start, end, kind }) => [text.slice(start, end), kind])).toEqual([
      ['tomorrow', 'when'],
      ['6pm', 'when'],
    ]);
  });

  test('words that only look like dates stay in the title', () => {
    expect(parse('read monthly report').repeat?.rule).toBe('FREQ=MONTHLY');
    expect(parse('call satish').title).toBe('call satish');
    expect(parse('buy 2 eggs').title).toBe('buy 2 eggs');
    expect(parse('fix the 5 bugs').start).toBeNull();
  });
});

test('suggestedStart rounds up from an hour ahead, or picks tomorrow morning late at night', () => {
  expect(suggestedStart(NOW, ZONE)).toBe('2026-10-11T21:00');
  expect(suggestedStart(at('2026-10-11T09:10'), ZONE)).toBe('2026-10-11T10:30');
  expect(suggestedStart(at('2026-10-11T21:10'), ZONE)).toBe('2026-10-12T09:00');
});

describe('describeRepeat', () => {
  const start = { year: 2026, month: 10, day: 11, hour: 9, minute: 0 };
  test.each([
    ['FREQ=DAILY', 'Every day at 9:00 AM'],
    ['FREQ=DAILY;INTERVAL=3', 'Every 3 days at 9:00 AM'],
    ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'Every weekday at 9:00 AM'],
    ['FREQ=WEEKLY;BYDAY=SA,SU', 'Every weekend at 9:00 AM'],
    ['FREQ=WEEKLY', 'Every Sunday at 9:00 AM'],
    ['FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH', 'Every other Tue & Thu at 9:00 AM'],
    ['FREQ=WEEKLY;INTERVAL=3;BYDAY=MO', 'Every 3 weeks on Monday at 9:00 AM'],
    ['FREQ=MONTHLY;BYDAY=-1FR', 'Monthly on the last Friday at 9:00 AM'],
    ['FREQ=MONTHLY;BYMONTHDAY=1,15', 'Monthly on the 1st & 15th at 9:00 AM'],
    ['FREQ=MONTHLY;BYMONTHDAY=-1', 'Monthly on the last day at 9:00 AM'],
    ['FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1', 'Monthly on the last weekday at 9:00 AM'],
    ['FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1', 'Every quarter on the 1st at 9:00 AM'],
    ['FREQ=YEARLY;BYMONTH=5;BYDAY=2SU', 'Every year on the second Sunday of May at 9:00 AM'],
    ['FREQ=YEARLY;INTERVAL=10;BYMONTH=3;BYMONTHDAY=14', 'Every 10 years on Mar 14 at 9:00 AM'],
    ['FREQ=DAILY;BYHOUR=8,20;BYMINUTE=0', 'Every day at 8:00 AM & 8:00 PM'],
    ['FREQ=HOURLY;INTERVAL=8', 'Every 8 hours'],
    ['FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=6', 'Every Mon, Wed & Fri at 9:00 AM, 6 times'],
    ['FREQ=DAILY;UNTIL=20261220T182900Z', 'Every day at 9:00 AM, until Dec 20'],
    ['FREQ=MONTHLY;BYDAY=TU,WE,TH;BYSETPOS=3', 'Custom repeat'],
  ])('%p', (rule, text) => {
    expect(describeRepeat({ rule, anchor: 'schedule' }, start, 'en-US')).toBe(text);
  });

  test('completion repeats', () => {
    expect(describeRepeat({ rule: 'FREQ=DAILY;INTERVAL=3', anchor: 'completion' }, start, 'en-US')).toBe(
      '3 days after done',
    );
    expect(describeRepeat({ rule: 'FREQ=MONTHLY', anchor: 'completion' }, start, 'en-US')).toBe('1 month after done');
  });
});
