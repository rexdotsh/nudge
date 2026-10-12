import type { Repeat } from './reminder';
import { rule, type ByDay, type Frequency, type Rule } from './rrule';
import { WEEKDAY_CODES } from './time';

export type Time = { hour: number; minute: number };

export const DAY =
  '(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)';
const AND = '(?:\\s*(?:,|and|&)\\s*|\\s+)';
const DAYS = `(${DAY}(?:${AND}${DAY})*)`;
const PLURAL_DAY = '(?:mon|tues|wednes|thurs|fri|satur|sun)days';
export const MONTH =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const ORDINAL = '(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)';
export const SUFFIX = '(?:st|nd|rd|th)?';
const OF_MONTH = '(?:\\s+of)?\\s+(?:the\\s+|every\\s+|each\\s+)?month';
const MERIDIEM = '(am|pm|a\\.m\\.|p\\.m\\.)';
export const TIME = `(\\d{1,2})(?:[:.](\\d{2}))?\\s*${MERIDIEM}?`;
export const MERIDIEM_TIME = `(\\d{1,2})(?:[:.](\\d{2}))?\\s*${MERIDIEM}`;

const NTH: Record<string, number> = {
  first: 1,
  '1st': 1,
  second: 2,
  '2nd': 2,
  third: 3,
  '3rd': 3,
  fourth: 4,
  '4th': 4,
  fifth: 5,
  '5th': 5,
  last: -1,
};
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const UNIT_FREQ: Record<string, Frequency> = {
  hour: 'HOURLY',
  day: 'DAILY',
  week: 'WEEKLY',
  month: 'MONTHLY',
  year: 'YEARLY',
  hourly: 'HOURLY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
  yearly: 'YEARLY',
  annually: 'YEARLY',
};
export const PARTS_OF_DAY: Record<string, Time> = {
  morning: { hour: 9, minute: 0 },
  afternoon: { hour: 15, minute: 0 },
  evening: { hour: 18, minute: 0 },
  night: { hour: 21, minute: 0 },
};
const WEEKDAYS: ByDay[] = [0, 1, 2, 3, 4].map((day) => ({ weekday: day, nth: 0 }));
const WEEKEND: ByDay[] = [5, 6].map((day) => ({ weekday: day, nth: 0 }));

export const dayIndex = (word: string) => WEEKDAY_CODES.findIndex((code) => code === word.slice(0, 2).toUpperCase());
export const monthNumber = (word: string) => MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1;
const count = (word: string | undefined) => (word === undefined ? 1 : word === 'other' ? 2 : Number(word));
const byDays = (list: string) =>
  [...new Set((list.match(new RegExp(DAY, 'g')) ?? []).map(dayIndex))]
    .toSorted((a, b) => a - b)
    .map((day) => ({ weekday: day, nth: 0 }));
const numbers = (text: string) => (text.match(/\d{1,2}/g) ?? []).map(Number);
const MONTH_DAYS = `(?:the\\s+)?(\\d{1,2})${SUFFIX}((?:\\s*(?:,|and|&)\\s*(?:the\\s+)?\\d{1,2}${SUFFIX})*)`;

export function clock(hourText: string, minuteText: string | undefined, meridiem: string | undefined): Time | null {
  let hour = Number(hourText);
  const minute = Number(minuteText ?? 0);
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem.startsWith('p') ? 12 : 0);
  }
  return hour > 23 ? null : { hour, minute };
}

function everyUnits(unit: string | undefined, interval: number): Rule | null {
  if (unit !== 'hour') return rule(UNIT_FREQ[unit ?? ''] ?? 'DAILY', { interval });
  if (interval <= 24) return rule('HOURLY', { interval });
  return interval % 24 === 0 ? rule('DAILY', { interval: interval / 24 }) : null;
}

export interface RepeatMatch {
  rule: Rule;
  anchor: Repeat['anchor'];
  /** The time of day the phrase implies when none is typed, as in "every morning". */
  defaultTime: Time | null;
}

const scheduled = (found: Rule | null, defaultTime: Time | null = null): RepeatMatch | null =>
  found && { rule: found, anchor: 'schedule', defaultTime };
const weekly = (m: RegExpExecArray) => scheduled(rule('WEEKLY', { byDay: byDays(m[1] ?? '') }));
const monthly = (list: string) => {
  const days = numbers(list).filter((day) => day >= 1 && day <= 31);
  return days.length === 0
    ? null
    : scheduled(rule('MONTHLY', { byMonthDay: [...new Set(days)].toSorted((a, b) => a - b) }));
};

export const REPEATS: [pattern: string, build: (match: RegExpExecArray) => RepeatMatch | null][] = [
  [
    `every\\s+(?:(other|\\d+)\\s+)?(hour|day|week|month|year)s?\\s+after\\s+(?:i(?:'m|\\s+am)?\\s+)?(?:done|complet(?:e|ed|ion|ing)|finish(?:ed|ing)?|do(?:ing)?\\s+it)`,
    (m) => {
      const found = everyUnits(m[2], count(m[1]));
      return found && { rule: found, anchor: 'completion', defaultTime: null };
    },
  ],
  [
    `(?:on\\s+|every\\s+)?(?:the\\s+)?${ORDINAL}\\s+(${DAY})\\s+(?:of|in)\\s+${MONTH}`,
    (m) =>
      scheduled(
        rule('YEARLY', {
          byMonth: [monthNumber(m[3] ?? '')],
          byDay: [{ weekday: dayIndex(m[2] ?? ''), nth: NTH[m[1] ?? ''] ?? 1 }],
        }),
      ),
  ],
  [
    `(?:on\\s+|every\\s+)?(?:the\\s+)?${ORDINAL}\\s+(${DAY})${OF_MONTH}`,
    (m) => scheduled(rule('MONTHLY', { byDay: [{ weekday: dayIndex(m[2] ?? ''), nth: NTH[m[1] ?? ''] ?? 1 }] })),
  ],
  [
    `(?:on\\s+|every\\s+)?(?:the\\s+)?last\\s+(?:week|work|business)\\s*day${OF_MONTH}`,
    () => scheduled(rule('MONTHLY', { byDay: WEEKDAYS, bySetPos: [-1] })),
  ],
  [`(?:on\\s+|every\\s+)?(?:the\\s+)?last\\s+day${OF_MONTH}`, () => scheduled(rule('MONTHLY', { byMonthDay: [-1] }))],
  [
    `every\\s+(other|\\d+)${SUFFIX}\\s+weeks?\\s+on\\s+${DAYS}`,
    (m) => scheduled(rule('WEEKLY', { interval: count(m[1]), byDay: byDays(m[2] ?? '') })),
  ],
  [`every\\s+other\\s+${DAYS}`, (m) => scheduled(rule('WEEKLY', { interval: 2, byDay: byDays(m[1] ?? '') }))],
  [`every\\s+week\\s*day|(?:on\\s+)?week\\s*days`, () => scheduled(rule('WEEKLY', { byDay: WEEKDAYS }))],
  [`every\\s+weekend|(?:on\\s+)?weekends`, () => scheduled(rule('WEEKLY', { byDay: WEEKEND }))],
  [`(?:every|each)\\s+${DAYS}`, weekly],
  [`(?:on\\s+)?(${PLURAL_DAY}(?:${AND}${PLURAL_DAY})*|${DAY}(?:${AND}${DAY})+)`, weekly],
  [
    `every\\s+quarter(?:\\s+on\\s+(?:the\\s+)?(\\d{1,2})${SUFFIX})?`,
    (m) => scheduled(rule('MONTHLY', { interval: 3, byMonthDay: m[1] ? [Number(m[1])] : [] })),
  ],
  [
    `every\\s+(other|\\d+)\\s+years?\\s+on\\s+${MONTH}\\s+(\\d{1,2})${SUFFIX}`,
    (m) =>
      scheduled(
        rule('YEARLY', { interval: count(m[1]), byMonth: [monthNumber(m[2] ?? '')], byMonthDay: [Number(m[3])] }),
      ),
  ],
  [
    `every\\s+(other|\\d+)\\s+months?\\s+on\\s+(?:the\\s+)?(\\d{1,2})${SUFFIX}`,
    (m) => scheduled(rule('MONTHLY', { interval: count(m[1]), byMonthDay: [Number(m[2])] })),
  ],
  [
    `every\\s+(\\d+)\\s+hours?\\s+(?:from|between)\\s+${TIME}\\s*(?:to|and|-|until|till)\\s*${TIME}`,
    (m) => {
      const step = Number(m[1]);
      const from = clock(m[2] ?? '', m[3], m[4]);
      const to = clock(m[5] ?? '', m[6], m[7]);
      if (!from || !to || step < 1) return null;
      let end = to.hour;
      if (!m[7] && end <= from.hour && end + 12 > from.hour) end += 12;
      if (end <= from.hour) end += 24;
      const hours = new Set<number>();
      for (let hour = from.hour; hour <= end; hour += step) hours.add(hour % 24);
      return scheduled(rule('DAILY', { byHour: [...hours].toSorted((a, b) => a - b), byMinute: [from.minute] }), from);
    },
  ],
  [`every\\s+(other|\\d+)\\s+(hour|day|week|month|year)s?`, (m) => scheduled(everyUnits(m[2], count(m[1])))],
  [
    `(?:every\\s+(?:year\\s+on\\s+)?|(?:annually|yearly)\\s+on\\s+)${MONTH}\\s+(\\d{1,2})${SUFFIX}`,
    (m) => scheduled(rule('YEARLY', { byMonth: [monthNumber(m[1] ?? '')], byMonthDay: [Number(m[2])] })),
  ],
  [
    `every\\s+(?:year\\s+on\\s+)?(?:the\\s+)?(\\d{1,2})${SUFFIX}\\s+(?:of\\s+)?${MONTH}`,
    (m) => scheduled(rule('YEARLY', { byMonth: [monthNumber(m[2] ?? '')], byMonthDay: [Number(m[1])] })),
  ],
  [
    `(every\\s+month\\s+on|every|each|on)\\s+${MONTH_DAYS}(\\s+of\\s+(?:the\\s+|every\\s+|each\\s+)?month)?(?!\\s*(?::|\\.\\d|am|pm|a\\.m|p\\.m|h\\b|hours?|mins?|minutes?|days?|weeks?|months?|years?|times|${DAY}))`,
    (m) => (m[1] === 'on' && !m[3] && !m[4] ? null : monthly(`${m[2]} ${m[3]}`)),
  ],
  [`${MONTH_DAYS}\\s+of\\s+(?:every|each)\\s+month`, (m) => monthly(`${m[1]} ${m[2]}`)],
  [
    `every\\s+(morning|afternoon|evening|night)|(?:each|every)\\s+(?:single\\s+)?day|daily`,
    (m) => scheduled(rule('DAILY'), PARTS_OF_DAY[m[1] ?? ''] ?? null),
  ],
  [`twice\\s+(?:a|per)\\s+day`, () => scheduled(rule('DAILY', { byHour: [9, 21], byMinute: [0] }))],
  [
    `every\\s+(hour|week|month|year)|(hourly|weekly|monthly|yearly|annually)`,
    (m) => {
      const freq = UNIT_FREQ[m[1] ?? m[2] ?? ''];
      return freq ? scheduled(rule(freq)) : null;
    },
  ],
];
