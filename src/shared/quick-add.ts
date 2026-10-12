import { isRepeat } from './input';
import {
  DAY,
  MERIDIEM_TIME,
  MONTH,
  PARTS_OF_DAY,
  REPEATS,
  SUFFIX,
  TIME,
  clock,
  dayIndex,
  monthNumber,
  type RepeatMatch,
  type Time,
} from './phrases';
import type { Repeat } from './reminder';
import { RuleError, formatRule, parseRule, type Rule } from './rrule';
import { Scanner, type Span } from './scanner';
import {
  DAY_MS,
  MINUTE_MS,
  addMonths,
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

export interface QuickAdd {
  title: string;
  start: string | null;
  repeat: Repeat | null;
  important: boolean;
  spans: Span[];
}

interface Draft {
  repeat: RepeatMatch | null;
  date: LocalDate | null;
  time: Time | null;
  bareHour: number | null;
  /** The first of several times a day, which also become the rule's hours. */
  listedTime: Time | null;
  defaultTime: Time | null;
  offset: number | null;
  offsetDays: number | null;
  duration: { unit: 'day' | 'week' | 'month'; amount: number } | null;
}

const DEFAULT_TIME: Time = { hour: 9, minute: 0 };

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

const UNTIL = `until\\s+${MONTH}\\s+(\\d{1,2})${SUFFIX}|until\\s+(\\d{1,2})${SUFFIX}\\s+(?:of\\s+)?${MONTH}`;
const COUNT = `(?:for\\s+)?(\\d+)\\s+times`;
const DURATION = `for\\s+(?:(\\d+|a|an|one)\\s+)?(day|week|month)s?`;
const TIME_LIST = `(?:at\\s+)?${TIME}(?:\\s*(?:,|and|&)\\s*${TIME})+`;

function scanEnds(scanner: Scanner, draft: Draft, today: LocalDate, zone: string): void {
  if (!draft.repeat) return;
  const current = draft.repeat.rule;
  if (draft.repeat.anchor === 'completion') {
    for (const end of [UNTIL, COUNT, DURATION]) scanner.shield(end);
    return;
  }
  scanner.take(UNTIL, 'repeat', (m) => {
    const date = nextDate(today, monthNumber(m[1] ?? m[4] ?? ''), Number(m[2] ?? m[3]));
    if (!isRealDate(date)) return false;
    current.until = endOfDay(date, zone);
    return true;
  });
  if (current.until !== null) return;
  const counted = scanner.take(COUNT, 'repeat', (m) => {
    const times = Number(m[1]);
    if (times < 1) return false;
    current.count = times;
    return true;
  });
  if (counted) return;
  scanner.take(DURATION, 'repeat', (m) => {
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
    setDate(nextDate(today, monthNumber(m[1] ?? ''), Number(m[2]), m[3] ? Number(m[3]) : undefined)),
  );
  scanner.take(`(?:on\\s+)?(?:the\\s+)?(\\d{1,2})${SUFFIX}\\s+(?:of\\s+)?${MONTH}(?:\\s+(\\d{4}))?`, 'when', (m) =>
    setDate(nextDate(today, monthNumber(m[2] ?? ''), Number(m[1]), m[3] ? Number(m[3]) : undefined)),
  );
  scanner.take(`on\\s+the\\s+(\\d{1,2})(?:st|nd|rd|th)`, 'when', (m) => {
    const day = Number(m[1]);
    const thisMonth = { ...today, day };
    setDate(day >= today.day ? thisMonth : addMonths(thisMonth, 1));
  });
  scanner.take(`(?:on\\s+|(next|this|coming)\\s+)?(${DAY})`, 'when', (m) =>
    setDate(nextWeekday(today, dayIndex(m[2] ?? ''), m[1] === 'this')),
  );

  scanner.take(TIME_LIST, 'when', (m) => {
    const times = [...m[0].matchAll(new RegExp(TIME, 'g'))].map((part) => clock(part[1] ?? '', part[2], part[3]));
    const valid = times.filter((time): time is Time => time !== null);
    const [first] = valid;
    const oneMinute = new Set(valid.map((time) => time.minute)).size === 1;
    if (draft.repeat?.anchor !== 'schedule' || !first || valid.length !== times.length || !oneMinute) return false;
    draft.repeat.rule.byHour = valid.map((time) => time.hour).toSorted((a, b) => a - b);
    draft.repeat.rule.byMinute = [first.minute];
    draft.listedTime = first;
    return true;
  });
  scanner.shield(TIME_LIST);
  const setTime = (time: Time | null): boolean => {
    if (time) draft.time = time;
    return time !== null;
  };
  scanner.take(`(?:at\\s+|@\\s*)?${MERIDIEM_TIME}`, 'when', (m) => setTime(clock(m[1] ?? '', m[2], m[3])));
  scanner.take(`(?:at\\s+|@\\s*)?([01]?\\d|2[0-3]):([0-5]\\d)`, 'when', (m) =>
    setTime(clock(m[1] ?? '', m[2], undefined)),
  );
  // A dot also separates hours and minutes, but without am/pm only after "at", since "4.50" alone is more likely a price.
  scanner.take(`(?:at\\s+|@\\s*)([01]?\\d|2[0-3])\\.([0-5]\\d)`, 'when', (m) =>
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
      : resolveBareHour(draft.bareHour, draft.date ?? (draft.repeat ? today : null), now, zone);
  const time = draft.listedTime ?? draft.time ?? bare ?? draft.defaultTime;
  if (draft.offsetDays !== null) {
    if (!time) return formatLocal(wallAtOrAfter(now + draft.offsetDays * DAY_MS, zone));
    draft.date = fromEpochDay(epochDay(today) + draft.offsetDays);
  }
  if (!draft.date && !time && !draft.repeat) return null;
  if (draft.repeat?.rule.freq === 'HOURLY' && !draft.date && !time) return formatLocal(wallAtOrAfter(now, zone));
  const at = time ?? DEFAULT_TIME;
  let date: LocalDate = draft.date ?? today;
  const passed = !draft.date && toInstant({ ...date, ...at }, zone) <= now;
  if (passed && draft.repeat?.anchor !== 'schedule') date = fromEpochDay(epochDay(date) + 1);
  return formatLocal({ year: date.year, month: date.month, day: date.day, hour: at.hour, minute: at.minute });
}

function applyDuration(draft: Draft, start: string | null, zone: string): void {
  const startDate = start === null ? null : parseLocal(start);
  if (!draft.repeat || !draft.duration || !startDate) return;
  const { unit, amount } = draft.duration;
  const last =
    unit === 'month'
      ? fromEpochDay(epochDay(addMonths(startDate, amount)) - 1)
      : fromEpochDay(epochDay(startDate) + (unit === 'week' ? amount * 7 : amount) - 1);
  draft.repeat.rule.until = endOfDay(last, zone);
}

function cleanTitle(text: string): string {
  return text
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
    repeat: null,
    date: null,
    time: null,
    bareHour: null,
    listedTime: null,
    defaultTime: null,
    offset: null,
    offsetDays: null,
    duration: null,
  };
  const important = scanner.take(`!+`, 'flag', () => true, { wholeWords: false });
  for (const [pattern, build] of REPEATS) {
    const taken = scanner.take(pattern, 'repeat', (m) => {
      const found = build(m);
      if (!found || !isValidRule(found.rule)) return false;
      draft.repeat = found;
      draft.defaultTime = found.defaultTime;
      return true;
    });
    if (taken) break;
  }
  scanEnds(scanner, draft, today, zone);
  scanWhen(scanner, draft, today);
  const start = startOf(draft, now, zone);
  applyDuration(draft, start, zone);
  const repeat = draft.repeat && { rule: formatRule(draft.repeat.rule), anchor: draft.repeat.anchor };
  return {
    title: cleanTitle(scanner.rest()),
    start,
    repeat: isRepeat(repeat) ? repeat : null,
    important,
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
