import { describe, expect, test } from 'bun:test';
import { parseFields } from '../src/shared/input';
import { leadMinutes } from '../src/shared/phrases';
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

test.each([
  [5, '2026-10-11T19:44'],
  [25, '2026-10-11T19:44'],
  [35, '2026-10-11T19:45'],
])('"in 1 min" typed %i s into a minute lands on the nearest whole minute', (seconds, start) => {
  expect(parseQuickAdd('stretch in 1 min', NOW + seconds * 1000, ZONE).start).toBe(start);
});

describe('parseQuickAdd', () => {
  test.each([
    ['call mom tomorrow 6pm', 'call mom', '2026-10-12T18:00', null],
    ['water plants in 20m', 'water plants', '2026-10-11T20:03', null],
    ['dinner fri 7pm', 'dinner', '2026-10-16T19:00', null],
    ['dentist oct 20 at 3:30pm', 'dentist', '2026-10-20T15:30', null],
    ['ask about the song 4.15pm', 'ask about the song', '2026-10-12T16:15', null],
    ['call naik 7.10pm', 'call naik', '2026-10-12T19:10', null],
    ['call at 16.30', 'call', '2026-10-12T16:30', null],
    ['pay rent 4.50', 'pay rent 4.50', null, null],
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
    ['stand up in 2 days at 8am', 'stand up', '2026-10-13T08:00', null],
    ['meet at 8', 'meet', '2026-10-11T20:00', null],
    ['meet tomorrow at 8', 'meet', '2026-10-12T08:00', null],
    ['gym this sunday 9pm', 'gym', '2026-10-11T21:00', null],
    ['gym next sunday 7am', 'gym', '2026-10-18T07:00', null],
    ['call feb 30', 'call feb 30', null, null],
    ['call on the 32nd', 'call on the 32nd', null, null],
    ['backup every 5000 days', 'backup every 5000 days', null, null],
    ['pills 8pm and 8:30pm every day', 'pills', '2026-10-11T20:00', 'FREQ=DAILY;BYHOUR=20;BYMINUTE=0,30'],
    ['meds daily 9am and 9:30pm', 'meds', '2026-10-11T09:00', 'FREQ=DAILY;BYHOUR=9,21;BYMINUTE=0,30;BYSETPOS=1,4'],
    [
      'meds every weekday 10am and 4:30pm',
      'meds',
      '2026-10-11T10:00',
      'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=10,16;BYMINUTE=0,30;BYSETPOS=1,4',
    ],
    ['meds every mon 9am and 5pm', 'meds', '2026-10-11T09:00', 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9,17;BYMINUTE=0'],
    [
      'meds every other mon 9am and 5:30pm',
      'meds 9am and 5:30pm',
      '2026-10-11T09:00',
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
    ],
    [
      'timesheet last weekday of the month 9am and 9pm',
      'timesheet 9am and 9pm',
      '2026-10-11T09:00',
      'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1',
    ],
    ['meds 9am & 9pm', 'meds', '2026-10-11T09:00', 'FREQ=DAILY;BYHOUR=9,21;BYMINUTE=0'],
    ['meds 8:15 and 20:45', 'meds', '2026-10-11T08:15', 'FREQ=DAILY;BYHOUR=8,20;BYMINUTE=15,45;BYSETPOS=1,4'],
    ['meds tomorrow 9am and 9pm', 'meds 9am and 9pm', '2026-10-12T09:00', null],
    // An end counts its days from the first time still ahead: at 19:43 today keeps its 9pm, but 8am and 7pm have passed.
    [
      'meds 9am and 9pm for 5 days',
      'meds',
      '2026-10-11T09:00',
      'FREQ=DAILY;BYHOUR=9,21;BYMINUTE=0;UNTIL=20261015T182900Z',
    ],
    [
      'meds 8am and 7pm for 5 days',
      'meds',
      '2026-10-11T08:00',
      'FREQ=DAILY;BYHOUR=8,19;BYMINUTE=0;UNTIL=20261016T182900Z',
    ],
    ['yoga daily for 5 days', 'yoga', '2026-10-11T09:00', 'FREQ=DAILY;UNTIL=20261016T182900Z'],
    [
      'meds daily 9am and 9pm for a week',
      'meds',
      '2026-10-11T09:00',
      'FREQ=DAILY;BYHOUR=9,21;BYMINUTE=0;UNTIL=20261017T182900Z',
    ],
    [
      'meds twice a day for 10 days',
      'meds',
      '2026-10-11T09:00',
      'FREQ=DAILY;BYHOUR=9,21;BYMINUTE=0;UNTIL=20261020T182900Z',
    ],
    [
      'meds 3 times a day for 2 weeks',
      'meds',
      '2026-10-11T09:00',
      'FREQ=DAILY;BYHOUR=9,15,21;BYMINUTE=0;UNTIL=20261024T182900Z',
    ],
    [
      'meds 9am and 9:30pm until oct 20',
      'meds',
      '2026-10-11T09:00',
      'FREQ=DAILY;BYHOUR=9,21;BYMINUTE=0,30;BYSETPOS=1,4;UNTIL=20261020T182900Z',
    ],
    ['meds 9am and 9pm 10 times', 'meds', '2026-10-11T21:00', 'FREQ=DAILY;BYHOUR=9,21;BYMINUTE=0;COUNT=10'],
    ['meds daily 1 times', 'meds', '2026-10-12T09:00', 'FREQ=DAILY;COUNT=1'],
    ['meds daily for 100001 times', 'meds for 100001 times', '2026-10-11T09:00', 'FREQ=DAILY'],
    ['meds daily for 0 days', 'meds for 0 days', '2026-10-11T09:00', 'FREQ=DAILY'],
    ['meds daily for 1 month starting jan 31', 'meds', '2027-01-31T09:00', 'FREQ=DAILY;UNTIL=20270227T182900Z'],
    ['meds daily until dec 20 2028', 'meds', '2026-10-11T09:00', 'FREQ=DAILY;UNTIL=20281220T182900Z'],
    ['meds tomorrow morning and night', 'meds morning and night', '2026-10-12T09:00', null],
    [
      'meds tomorrow 9am and 9pm for 5 days',
      'meds',
      '2026-10-12T09:00',
      'FREQ=DAILY;BYHOUR=9,21;BYMINUTE=0;UNTIL=20261016T182900Z',
    ],
    [
      'meds morning and night for 3 days',
      'meds',
      '2026-10-11T09:00',
      'FREQ=DAILY;BYHOUR=9,21;BYMINUTE=0;UNTIL=20261013T182900Z',
    ],
    ['pay 4.50 and 5.20 for 5 days', 'pay 4.50 and 5.20 for 5 days', null, null],
    ['call bank until oct 20', 'call bank', '2026-10-20T09:00', null],
    ['buy 2 and 3 eggs', 'buy 2 and 3 eggs', null, null],
    ['stretch every day at 9 and 9', 'stretch', '2026-10-11T09:00', 'FREQ=DAILY'],
    ['meds twice daily', 'meds', '2026-10-11T09:00', 'FREQ=DAILY;BYHOUR=9,21;BYMINUTE=0'],
    ['meds thrice daily', 'meds', '2026-10-11T09:00', 'FREQ=DAILY;BYHOUR=9,15,21;BYMINUTE=0'],
    ['meds three times a day', 'meds', '2026-10-11T09:00', 'FREQ=DAILY;BYHOUR=9,15,21;BYMINUTE=0'],
    ['meds 4 times a day', 'meds', '2026-10-11T08:00', 'FREQ=DAILY;BYHOUR=8,12,16,20;BYMINUTE=0'],
    ['meds once a day', 'meds', '2026-10-11T09:00', 'FREQ=DAILY'],
    [
      'meds twice a day at 8am and 8:30pm',
      'meds',
      '2026-10-11T08:00',
      'FREQ=DAILY;BYHOUR=8,20;BYMINUTE=0,30;BYSETPOS=1,4',
    ],
    ['meds 20 times a day', 'meds 20 times a day', null, null],
    ['meds morning and evening every day', 'meds', '2026-10-11T09:00', 'FREQ=DAILY;BYHOUR=9,18;BYMINUTE=0'],
    ['meds every morning and night', 'meds', '2026-10-11T09:00', 'FREQ=DAILY;BYHOUR=9,21;BYMINUTE=0'],
    ['meds in the morning and at night', 'meds', '2026-10-11T09:00', 'FREQ=DAILY;BYHOUR=9,21;BYMINUTE=0'],
    [
      'stretch every day 5 times until dec 20',
      'stretch 5 times',
      '2026-10-11T09:00',
      'FREQ=DAILY;UNTIL=20261220T182900Z',
    ],
    ['stretch every day for 0 times', 'stretch for 0 times', '2026-10-11T09:00', 'FREQ=DAILY'],
    ['ship it in 1.5 days', 'ship it', '2026-10-13T07:43', null],
    ['brunch this weekend', 'brunch', '2026-10-11T10:00', null],
    ['check in tomorrow', 'check in', '2026-10-12T09:00', null],
    ['log in at 9pm', 'log in', '2026-10-11T21:00', null],
    ['pay rent by friday', 'pay rent', '2026-10-16T09:00', null],
    [
      'check servers every 2 hours from 10pm to 2am',
      'check servers',
      '2026-10-11T22:00',
      'FREQ=DAILY;BYHOUR=0,2,22;BYMINUTE=0',
    ],
    [
      'water garden every day for 2 weeks starting next monday',
      'water garden',
      '2026-10-12T09:00',
      'FREQ=DAILY;UNTIL=20261025T182900Z',
    ],
    [
      'water plants every 3 days after done until dec 20',
      'water plants until dec 20',
      '2026-10-12T09:00',
      'FREQ=DAILY;INTERVAL=3',
    ],
    ['pills every day after done at 8am and 8pm', 'pills at 8am and 8pm', '2026-10-12T09:00', 'FREQ=DAILY'],
    ['pay rent every 1st 10am', 'pay rent', '2026-10-11T10:00', 'FREQ=MONTHLY;BYMONTHDAY=1'],
    ['pay card every 1st and 15th 9:30am', 'pay card', '2026-10-11T09:30', 'FREQ=MONTHLY;BYMONTHDAY=1,15'],
    ['pay rent every month on the 1st 10am', 'pay rent', '2026-10-11T10:00', 'FREQ=MONTHLY;BYMONTHDAY=1'],
    ['pay rent the 1st of every month 10am', 'pay rent', '2026-10-11T10:00', 'FREQ=MONTHLY;BYMONTHDAY=1'],
    ['lunch every 12.30', 'lunch every 12.30', null, null],
    ['gym every mon wed fri 7am', 'gym', '2026-10-11T07:00', 'FREQ=WEEKLY;BYDAY=MO,WE,FR'],
    ['gym mon wed fri 7am', 'gym', '2026-10-11T07:00', 'FREQ=WEEKLY;BYDAY=MO,WE,FR'],
    ['swim on tuesdays and thursdays at 6pm', 'swim', '2026-10-11T18:00', 'FREQ=WEEKLY;BYDAY=TU,TH'],
  ])('%p', (text, title, start, rule) => {
    const parsed = parse(text);
    expect(parsed.title).toBe(title);
    expect(parsed.start).toBe(start);
    expect(parsed.repeat?.rule ?? null).toBe(rule);
    const fields = { title, notes: '', start: start ?? '2026-10-12T09:00', zone: null, important: false, alerts: [] };
    expect(parseFields({ ...fields, repeat: parsed.repeat })).not.toBeNull();
  });

  test('completion-anchored repeats start at the next free slot', () => {
    expect(parse('water the monstera every 3 days after done')).toMatchObject({
      title: 'water the monstera',
      start: '2026-10-12T09:00',
      repeat: { rule: 'FREQ=DAILY;INTERVAL=3', anchor: 'completion' },
    });
    expect(parse('meds every 48 hours after done')).toMatchObject({
      title: 'meds',
      repeat: { rule: 'FREQ=DAILY;INTERVAL=2', anchor: 'completion' },
    });
    expect(parse('descale 3 days after done')).toMatchObject({
      title: 'descale',
      repeat: { rule: 'FREQ=DAILY;INTERVAL=3', anchor: 'completion' },
    });
    expect(parse('apply 2 days after finishing the course').repeat).toBeNull();
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

  test('counted hourly repeats keep their wall-clock phase when the first future slot is in a DST gap', () => {
    const parsed = parseQuickAdd(
      'stretch every 2 hours at 00:00 for 3 times',
      Date.UTC(2026, 2, 8, 5, 30),
      'America/New_York',
    );
    expect(parsed.start).toBe('2026-03-08T02:00');
    expect(parsed.repeat?.rule).toBe('FREQ=HOURLY;INTERVAL=2;COUNT=3');
  });

  test.each([
    ['every day at 9am and 9pm', true],
    ['every tue at 5', true],
    ['every morning', true],
    ['twice a day', true],
    ['every day', false],
    ['every other tue', false],
    ['3 days after done', false],
  ])('a typed repeat %p names a time of day: %p', (text, timed) => {
    expect(parse(`x ${text}`).timed).toBe(timed);
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

test.each([
  ['30 min', 30],
  ['90m', 90],
  ['2h', 120],
  ['1.5 hours', 90],
  ['half an hour', 30],
  ['An hour before', 60],
  ['3 days', 3 * 24 * 60],
  ['a week early', 7 * 24 * 60],
  ['0 min', null],
  ['1.5 min', null],
  ['30', null],
  ['in 30 min', null],
  ['30 min after', null],
])('an early alert typed as %p is %p minutes ahead', (text, minutes) => {
  expect(leadMinutes(text)).toBe(minutes);
});
