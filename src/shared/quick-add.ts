import type { Repeat } from './reminder';
import { RuleError, formatRule, parseRule, rule, type ByDay, type Frequency, type Rule } from './rrule';
import {
  DAY_MS,
  MINUTE_MS,
  WEEKDAY_CODES,
  daysInMonth,
  epochDay,
  formatLocal,
  fromEpochDay,
  parseLocal,
  toInstant,
  toLocal,
  wallAtOrAfter,
  weekday,
  type LocalDate,
  type LocalDateTime,
} from './time';

export type SpanKind = 'when' | 'repeat' | 'flag';

export interface Span {
  start: number;
  end: number;
  kind: SpanKind;
}

export interface QuickAdd {
  title: string;
  start: string | null;
  repeat: Repeat | null;
  important: boolean;
  spans: Span[];
}

type Time = { hour: number; minute: number };

interface Draft {
  rule: Rule | null;
  anchor: Repeat['anchor'];
  date: LocalDate | null;
  time: Time | null;
  bareHour: number | null;
  times: Time[];
  defaultTime: Time | null;
  offset: number | null;
  offsetDays: number | null;
  duration: { unit: 'day' | 'week' | 'month'; amount: number } | null;
  important: boolean;
}

const DAY =
  '(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)';
const DAYS = `(${DAY}(?:\\s*(?:,|and|&)\\s*${DAY})*)`;
const MONTH =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const ORDINAL = '(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)';
const SUFFIX = '(?:st|nd|rd|th)?';
const OF_MONTH = '(?:\\s+of)?\\s+(?:the\\s+|every\\s+|each\\s+)?month';
const MERIDIEM = '(am|pm|a\\.m\\.|p\\.m\\.)';
const TIME = `(\\d{1,2})(?::(\\d{2}))?\\s*${MERIDIEM}?`;
const MERIDIEM_TIME = `(\\d{1,2})(?::(\\d{2}))?\\s*${MERIDIEM}`;

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
const PARTS_OF_DAY: Record<string, Time> = {
  morning: { hour: 9, minute: 0 },
  afternoon: { hour: 15, minute: 0 },
  evening: { hour: 18, minute: 0 },
  night: { hour: 21, minute: 0 },
};
const WEEKDAYS: ByDay[] = [0, 1, 2, 3, 4].map((day) => ({ weekday: day, nth: 0 }));
const WEEKEND: ByDay[] = [5, 6].map((day) => ({ weekday: day, nth: 0 }));
const DEFAULT_TIME: Time = { hour: 9, minute: 0 };

const dayIndex = (word: string) => WEEKDAY_CODES.findIndex((code) => code === word.slice(0, 2).toUpperCase());
const monthIndex = (word: string) => MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1;
const count = (word: string | undefined) => (word === undefined ? 1 : word === 'other' ? 2 : Number(word));
const byDays = (list: string) =>
  [...new Set((list.match(new RegExp(DAY, 'g')) ?? []).map(dayIndex))]
    .toSorted((a, b) => a - b)
    .map((day) => ({ weekday: day, nth: 0 }));
const numbers = (text: string) => (text.match(/\d{1,2}/g) ?? []).map(Number);

function clock(hourText: string, minuteText: string | undefined, meridiem: string | undefined): Time | null {
  let hour = Number(hourText);
  const minute = Number(minuteText ?? 0);
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem.startsWith('p') ? 12 : 0);
  }
  return hour > 23 ? null : { hour, minute };
}

function isRealDate({ year, month, day }: LocalDate): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function isValidRule(candidate: Rule): boolean {
  try {
    parseRule(formatRule(candidate));
    return true;
  } catch (error) {
    if (error instanceof RuleError) return false;
    throw error;
  }
}

const CONSUMED = '\u0001';
const SHIELDED = '\u0002';

class Scanner {
  readonly spans: Span[] = [];
  private text: string;

  constructor(readonly original: string) {
    this.text = Array.from(original, (char) => {
      const lower = char.toLowerCase();
      return lower.length === char.length ? lower : char;
    }).join('');
  }

  take(
    pattern: string,
    kind: SpanKind,
    handle: (match: RegExpExecArray) => boolean | void,
    { wholeWords = true } = {},
  ): boolean {
    const bounded = wholeWords ? `(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])` : pattern;
    const match = new RegExp(bounded, 'u').exec(this.text);
    if (!match || handle(match) === false) return false;
    this.spans.push({ start: match.index, end: match.index + match[0].length, kind });
    this.text =
      this.text.slice(0, match.index) +
      CONSUMED.repeat(match[0].length) +
      this.text.slice(match.index + match[0].length);
    return true;
  }

  shield(pattern: string): void {
    const match = new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'u').exec(this.text);
    if (!match) return;
    this.text =
      this.text.slice(0, match.index) +
      SHIELDED.repeat(match[0].length) +
      this.text.slice(match.index + match[0].length);
  }

  rest(): string {
    let rest = '';
    for (let i = 0; i < this.original.length; i++) rest += this.text[i] === CONSUMED ? CONSUMED : this.original[i];
    return rest;
  }
}

type RepeatPattern = [pattern: string, build: (match: RegExpExecArray, draft: Draft) => Rule | null];

const REPEATS: RepeatPattern[] = [
  [
    `every\\s+(?:(other|\\d+)\\s+)?(hour|day|week|month|year)s?\\s+after\\s+(?:i(?:'m|\\s+am)?\\s+)?(?:done|complet(?:e|ed|ion|ing)|finish(?:ed|ing)?|do(?:ing)?\\s+it)`,
    (m, draft) => {
      draft.anchor = 'completion';
      return rule(UNIT_FREQ[m[2] ?? ''] ?? 'DAILY', { interval: count(m[1]) });
    },
  ],
  [
    `(?:on\\s+|every\\s+)?(?:the\\s+)?${ORDINAL}\\s+(${DAY})\\s+(?:of|in)\\s+${MONTH}`,
    (m) =>
      rule('YEARLY', {
        byMonth: [monthIndex(m[3] ?? '')],
        byDay: [{ weekday: dayIndex(m[2] ?? ''), nth: NTH[m[1] ?? ''] ?? 1 }],
      }),
  ],
  [
    `(?:on\\s+|every\\s+)?(?:the\\s+)?${ORDINAL}\\s+(${DAY})${OF_MONTH}`,
    (m) => rule('MONTHLY', { byDay: [{ weekday: dayIndex(m[2] ?? ''), nth: NTH[m[1] ?? ''] ?? 1 }] }),
  ],
  [
    `(?:on\\s+|every\\s+)?(?:the\\s+)?last\\s+(?:week|work|business)\\s*day${OF_MONTH}`,
    () => rule('MONTHLY', { byDay: WEEKDAYS, bySetPos: [-1] }),
  ],
  [`(?:on\\s+|every\\s+)?(?:the\\s+)?last\\s+day${OF_MONTH}`, () => rule('MONTHLY', { byMonthDay: [-1] })],
  [
    `every\\s+(other|\\d+)${SUFFIX}\\s+weeks?\\s+on\\s+${DAYS}`,
    (m) => rule('WEEKLY', { interval: count(m[1]), byDay: byDays(m[2] ?? '') }),
  ],
  [`every\\s+other\\s+${DAYS}`, (m) => rule('WEEKLY', { interval: 2, byDay: byDays(m[1] ?? '') })],
  [`every\\s+week\\s*day|(?:on\\s+)?week\\s*days`, () => rule('WEEKLY', { byDay: WEEKDAYS })],
  [`every\\s+weekend|(?:on\\s+)?weekends`, () => rule('WEEKLY', { byDay: WEEKEND })],
  [`(?:every|each)\\s+${DAYS}`, (m) => rule('WEEKLY', { byDay: byDays(m[1] ?? '') })],
  [
    `every\\s+quarter(?:\\s+on\\s+(?:the\\s+)?(\\d{1,2})${SUFFIX})?`,
    (m) => rule('MONTHLY', { interval: 3, byMonthDay: m[1] ? [Number(m[1])] : [] }),
  ],
  [
    `every\\s+(other|\\d+)\\s+years?\\s+on\\s+${MONTH}\\s+(\\d{1,2})${SUFFIX}`,
    (m) => rule('YEARLY', { interval: count(m[1]), byMonth: [monthIndex(m[2] ?? '')], byMonthDay: [Number(m[3])] }),
  ],
  [
    `every\\s+(other|\\d+)\\s+months?\\s+on\\s+(?:the\\s+)?(\\d{1,2})${SUFFIX}`,
    (m) => rule('MONTHLY', { interval: count(m[1]), byMonthDay: [Number(m[2])] }),
  ],
  [
    `every\\s+(\\d+)\\s+hours?\\s+(?:from|between)\\s+${TIME}\\s*(?:to|and|-|until|till)\\s*${TIME}`,
    (m, draft) => {
      const step = Number(m[1]);
      const from = clock(m[2] ?? '', m[3], m[4]);
      const to = clock(m[5] ?? '', m[6], m[7]);
      if (!from || !to || step < 1) return null;
      let end = to.hour;
      if (!m[7] && end <= from.hour && end + 12 > from.hour) end += 12;
      if (end <= from.hour) end += 24;
      const hours = new Set<number>();
      for (let hour = from.hour; hour <= end; hour += step) hours.add(hour % 24);
      draft.defaultTime = from;
      return rule('DAILY', { byHour: [...hours].toSorted((a, b) => a - b), byMinute: [from.minute] });
    },
  ],
  [
    `every\\s+(other|\\d+)\\s+(hour|day|week|month|year)s?`,
    (m) => {
      const interval = count(m[1]);
      if (m[2] !== 'hour') return rule(UNIT_FREQ[m[2] ?? ''] ?? 'DAILY', { interval });
      if (interval <= 24) return rule('HOURLY', { interval });
      return interval % 24 === 0 ? rule('DAILY', { interval: interval / 24 }) : null;
    },
  ],
  [
    `(?:every\\s+(?:year\\s+on\\s+)?|(?:annually|yearly)\\s+on\\s+)${MONTH}\\s+(\\d{1,2})${SUFFIX}`,
    (m) => rule('YEARLY', { byMonth: [monthIndex(m[1] ?? '')], byMonthDay: [Number(m[2])] }),
  ],
  [
    `every\\s+(?:year\\s+on\\s+)?(?:the\\s+)?(\\d{1,2})${SUFFIX}\\s+(?:of\\s+)?${MONTH}`,
    (m) => rule('YEARLY', { byMonth: [monthIndex(m[2] ?? '')], byMonthDay: [Number(m[1])] }),
  ],
  [
    `(every\\s+month\\s+on|every|each|on)\\s+(?:the\\s+)?(\\d{1,2})${SUFFIX}((?:\\s*(?:,|and|&)\\s*(?:the\\s+)?\\d{1,2}${SUFFIX})*)(\\s+of\\s+(?:the\\s+|every\\s+|each\\s+)?month)?(?!\\s*(?::|am|pm|a\\.m|p\\.m|\\d|h\\b|hours?|mins?|minutes?|days?|weeks?|months?|years?|times))`,
    (m) => {
      if (m[1] === 'on' && !m[3] && !m[4]) return null;
      const days = [Number(m[2]), ...numbers(m[3] ?? '')].filter((day) => day >= 1 && day <= 31);
      return days.length > 0 ? rule('MONTHLY', { byMonthDay: [...new Set(days)].toSorted((a, b) => a - b) }) : null;
    },
  ],
  [
    `every\\s+(morning|afternoon|evening|night)|(?:each|every)\\s+(?:single\\s+)?day|daily`,
    (m, draft) => {
      draft.defaultTime = PARTS_OF_DAY[m[1] ?? ''] ?? null;
      return rule('DAILY');
    },
  ],
  [`twice\\s+(?:a|per)\\s+day`, () => rule('DAILY', { byHour: [9, 21], byMinute: [0] })],
  [
    `every\\s+(hour|week|month|year)|(hourly|weekly|monthly|yearly|annually)`,
    (m) => {
      const freq = UNIT_FREQ[m[1] ?? m[2] ?? ''];
      return freq ? rule(freq) : null;
    },
  ],
];

function addMonthsClamped(date: LocalDate, months: number): LocalDate {
  const index = date.year * 12 + date.month - 1 + months;
  const year = Math.floor(index / 12);
  return { year, month: index - year * 12 + 1, day: date.day };
}

function nextWeekday(today: LocalDate, target: number, includeToday = false): LocalDate {
  const day = epochDay(today);
  const ahead = (target - weekday(day) + 7) % 7;
  return fromEpochDay(day + (ahead === 0 && !includeToday ? 7 : ahead));
}

function nextDate(today: LocalDate, month: number, day: number, year?: number): LocalDate {
  const candidate = { year: year ?? today.year, month, day };
  return year === undefined && epochDay(candidate) < epochDay(today)
    ? { ...candidate, year: today.year + 1 }
    : candidate;
}

const endOfDay = (date: LocalDate, zone: string) => toInstant({ ...date, hour: 23, minute: 59 }, zone);

function scanEnds(scanner: Scanner, draft: Draft, today: LocalDate, zone: string): void {
  const current = draft.rule;
  if (!current) return;
  scanner.take(
    `until\\s+${MONTH}\\s+(\\d{1,2})${SUFFIX}|until\\s+(\\d{1,2})${SUFFIX}\\s+(?:of\\s+)?${MONTH}`,
    'repeat',
    (m) => {
      const date = nextDate(today, monthIndex(m[1] ?? m[4] ?? ''), Number(m[2] ?? m[3]));
      if (!isRealDate(date)) return false;
      current.until = endOfDay(date, zone);
      return true;
    },
  );
  if (current.until !== null) return;
  const counted = scanner.take(`(?:for\\s+)?(\\d+)\\s+times`, 'repeat', (m) => {
    const times = Number(m[1]);
    if (times < 1) return false;
    current.count = times;
    return true;
  });
  if (counted) return;
  scanner.take(`for\\s+(?:(\\d+|a|an|one)\\s+)?(day|week|month)s?`, 'repeat', (m) => {
    const unit = m[2] === 'week' || m[2] === 'month' ? m[2] : 'day';
    draft.duration = { unit, amount: /^\d+$/.test(m[1] ?? '') ? Number(m[1]) : 1 };
  });
}

function scanWhen(scanner: Scanner, draft: Draft, today: LocalDate): void {
  const setDate = (date: LocalDate): boolean => {
    if (isRealDate(date)) draft.date = date;
    return isRealDate(date);
  };
  scanner.take(
    `in\\s+(an?|half\\s+an|\\d+(?:\\.\\d+)?)\\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?|w|wks?|weeks?)`,
    'when',
    (m) => {
      const amount = m[1] === 'half an' ? 0.5 : /^\d/.test(m[1] ?? '') ? Number(m[1]) : 1;
      const unit = m[2]?.[0] ?? 'm';
      const days = unit === 'w' ? amount * 7 : amount;
      if (unit === 'd' || unit === 'w') {
        if (Number.isInteger(days)) draft.offsetDays = days;
        else draft.offset = days * DAY_MS;
      } else {
        draft.offset = amount * (unit === 'h' ? 60 * MINUTE_MS : MINUTE_MS);
      }
    },
  );
  scanner.take(`(?:the\\s+)?day\\s+after\\s+tomorrow`, 'when', () => setDate(fromEpochDay(epochDay(today) + 2)));
  scanner.take(`today`, 'when', () => setDate(today));
  scanner.take(`tonight`, 'when', () => {
    setDate(today);
    draft.defaultTime = { hour: 20, minute: 0 };
  });
  scanner.take(`tomorrow|tmrw|tmr|tomo`, 'when', () => setDate(fromEpochDay(epochDay(today) + 1)));
  scanner.take(`(?:this\\s+)?weekend`, 'when', () => {
    setDate(weekday(epochDay(today)) >= 5 ? today : nextWeekday(today, 5));
    draft.defaultTime = { hour: 10, minute: 0 };
  });
  scanner.take(`next\\s+week`, 'when', () => setDate(nextWeekday(today, 0)));
  scanner.take(`(\\d{4})-(\\d{2})-(\\d{2})`, 'when', (m) =>
    setDate({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }),
  );
  scanner.take(`(?:on\\s+)?${MONTH}\\s+(\\d{1,2})${SUFFIX}(?:,?\\s+(\\d{4}))?`, 'when', (m) =>
    setDate(nextDate(today, monthIndex(m[1] ?? ''), Number(m[2]), m[3] ? Number(m[3]) : undefined)),
  );
  scanner.take(`(?:on\\s+)?(?:the\\s+)?(\\d{1,2})${SUFFIX}\\s+(?:of\\s+)?${MONTH}(?:\\s+(\\d{4}))?`, 'when', (m) =>
    setDate(nextDate(today, monthIndex(m[2] ?? ''), Number(m[1]), m[3] ? Number(m[3]) : undefined)),
  );
  scanner.take(`on\\s+the\\s+(\\d{1,2})(?:st|nd|rd|th)`, 'when', (m) => {
    const day = Number(m[1]);
    const thisMonth = { ...today, day };
    setDate(day >= today.day ? thisMonth : addMonthsClamped(thisMonth, 1));
  });
  scanner.take(`(?:on\\s+|(next|this|coming)\\s+)?(${DAY})`, 'when', (m) =>
    setDate(nextWeekday(today, dayIndex(m[2] ?? ''), m[1] === 'this')),
  );

  scanner.take(`(?:at\\s+)?${TIME}(?:\\s*(?:,|and|&)\\s*${TIME})+`, 'when', (m) => {
    const times = [...m[0].matchAll(new RegExp(TIME, 'g'))].map((part) => clock(part[1] ?? '', part[2], part[3]));
    const valid = times.filter((time): time is Time => time !== null);
    const encodable = valid.length === times.length && new Set(valid.map((time) => time.minute)).size === 1;
    if (draft.rule && encodable) draft.times = valid;
    return draft.times.length > 0;
  });
  scanner.shield(`(?:at\\s+)?${TIME}(?:\\s*(?:,|and|&)\\s*${TIME})+`);
  const setTime = (time: Time | null): boolean => {
    if (time) draft.time = time;
    return time !== null;
  };
  scanner.take(`(?:at\\s+|@\\s*)?${MERIDIEM_TIME}`, 'when', (m) => setTime(clock(m[1] ?? '', m[2], m[3])));
  scanner.take(`(?:at\\s+|@\\s*)?([01]?\\d|2[0-3]):([0-5]\\d)`, 'when', (m) =>
    setTime(clock(m[1] ?? '', m[2], undefined)),
  );
  scanner.take(`(?:at|@)\\s*(\\d{1,2})`, 'when', (m) => {
    const hour = Number(m[1]);
    if (hour < 1 || hour > 12) return setTime(clock(m[1] ?? '', undefined, undefined));
    draft.bareHour = hour;
    return true;
  });
  scanner.take(`(?:at\\s+)?(?:noon|midday)`, 'when', () => setTime({ hour: 12, minute: 0 }));
  scanner.take(`(?:at\\s+)?midnight`, 'when', () => setTime({ hour: 23, minute: 59 }));
  scanner.take(`(?:in\\s+the\\s+|this\\s+)?(morning|afternoon|evening|night)`, 'when', (m) => {
    draft.defaultTime = PARTS_OF_DAY[m[1] ?? ''] ?? null;
  });
}

function resolveBareHour(hour: number, date: LocalDate | null, now: number, zone: string): Time {
  const morning = { hour: hour % 12, minute: 0 };
  const afternoon = { hour: (hour % 12) + 12, minute: 0 };
  if (hour === 12) return { hour: 12, minute: 0 };
  if (date) return hour >= 7 ? morning : afternoon;
  const today = toLocal(now, zone);
  return toInstant({ ...today, ...morning }, zone) > now ? morning : afternoon;
}

function startOf(draft: Draft, now: number, zone: string): string | null {
  if (draft.offset !== null) return formatLocal(wallAtOrAfter(now + draft.offset, zone));
  const today = toLocal(now, zone);
  const bare =
    draft.bareHour === null
      ? null
      : resolveBareHour(draft.bareHour, draft.date ?? (draft.rule ? today : null), now, zone);
  const time = draft.times[0] ?? draft.time ?? bare ?? draft.defaultTime;
  if (draft.offsetDays !== null) {
    if (!time) return formatLocal(wallAtOrAfter(now + draft.offsetDays * DAY_MS, zone));
    draft.date = fromEpochDay(epochDay(today) + draft.offsetDays);
  }
  if (!draft.date && !time && !draft.rule) return null;
  if (draft.rule?.freq === 'HOURLY' && !draft.date && !time) return formatLocal(wallAtOrAfter(now, zone));
  const at = time ?? DEFAULT_TIME;
  let date: LocalDate = draft.date ?? today;
  const passed = !draft.date && toInstant({ ...date, ...at }, zone) <= now;
  if (passed && (!draft.rule || draft.anchor === 'completion')) date = fromEpochDay(epochDay(date) + 1);
  return formatLocal({ year: date.year, month: date.month, day: date.day, hour: at.hour, minute: at.minute });
}

function applyDuration(draft: Draft, start: string | null, zone: string): void {
  const startDate = start === null ? null : parseLocal(start);
  if (!draft.rule || !draft.duration || !startDate) return;
  const { unit, amount } = draft.duration;
  const last =
    unit === 'month'
      ? fromEpochDay(epochDay(addMonthsClamped(startDate, amount)) - 1)
      : fromEpochDay(epochDay(startDate) + (unit === 'week' ? amount * 7 : amount) - 1);
  draft.rule.until = endOfDay(last, zone);
}

const CONNECTOR_BEFORE_CONSUMED = new RegExp(`\\s+(?:by|due|starting|from|until|every|each)\\s*(?=${CONSUMED})`, 'giu');

function cleanTitle(text: string): string {
  return text
    .replace(CONNECTOR_BEFORE_CONSUMED, ' ')
    .replaceAll(CONSUMED, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:remind\s+me\s+(?:to\s+)?|reminder\s*:?\s*)/i, '')
    .replace(/[,;:\-–]+$/, '')
    .trim();
}

export function parseQuickAdd(text: string, now: number, zone: string): QuickAdd {
  const scanner = new Scanner(text);
  const today = toLocal(now, zone);
  const draft: Draft = {
    rule: null,
    anchor: 'schedule',
    date: null,
    time: null,
    bareHour: null,
    times: [],
    defaultTime: null,
    offset: null,
    offsetDays: null,
    duration: null,
    important: false,
  };
  scanner.take(
    `!+`,
    'flag',
    () => {
      draft.important = true;
    },
    { wholeWords: false },
  );
  for (const [pattern, build] of REPEATS) {
    const matched = scanner.take(pattern, 'repeat', (m) => {
      const built = build(m, draft);
      draft.rule = built && isValidRule(built) ? built : null;
      return draft.rule !== null;
    });
    if (matched) break;
  }
  scanEnds(scanner, draft, today, zone);
  scanWhen(scanner, draft, today);
  if (draft.rule && draft.times.length > 1 && new Set(draft.times.map((time) => time.minute)).size === 1) {
    draft.rule.byHour = draft.times.map((time) => time.hour).toSorted((a, b) => a - b);
    draft.rule.byMinute = [draft.times[0]?.minute ?? 0];
  }
  const start = startOf(draft, now, zone);
  applyDuration(draft, start, zone);
  if (draft.rule && !isValidRule(draft.rule)) draft.rule = null;
  return {
    title: cleanTitle(scanner.rest()),
    start,
    repeat: draft.rule ? { rule: formatRule(draft.rule), anchor: draft.anchor } : null,
    important: draft.important,
    spans: scanner.spans.toSorted((a, b) => a.start - b.start),
  };
}

export function suggestedStart(now: number, zone: string): string {
  const local = toLocal(now, zone);
  if (local.hour >= 21) {
    const tomorrow = fromEpochDay(epochDay(local) + 1);
    return formatLocal({ ...tomorrow, ...DEFAULT_TIME });
  }
  const minutes = local.hour * 60 + local.minute + 60;
  const rounded = Math.ceil(minutes / 30) * 30;
  const next: LocalDateTime = { ...local, hour: Math.floor(rounded / 60), minute: rounded % 60 };
  return formatLocal(next.hour >= 24 ? { ...fromEpochDay(epochDay(local) + 1), ...DEFAULT_TIME } : next);
}
