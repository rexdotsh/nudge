import {
  WEEKDAY_CODES,
  daysInMonth,
  epochDay,
  fromEpochDay,
  toInstant,
  toLocal,
  wallMs,
  weekday,
  type LocalDate,
  type LocalDateTime,
} from './time';

export const FREQUENCIES = ['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export interface ByDay {
  weekday: number;
  nth: number;
}

export interface Rule {
  freq: Frequency;
  interval: number;
  byMonth: number[];
  byMonthDay: number[];
  byDay: ByDay[];
  byHour: number[];
  byMinute: number[];
  bySetPos: number[];
  count: number | null;
  until: number | null;
}

export class RuleError extends Error {}

export function rule(freq: Frequency, parts: Partial<Omit<Rule, 'freq'>> = {}): Rule {
  return {
    freq,
    interval: 1,
    byMonth: [],
    byMonthDay: [],
    byDay: [],
    byHour: [],
    byMinute: [],
    bySetPos: [],
    count: null,
    until: null,
    ...parts,
  };
}

function integers(value: string, min: number, max: number, allowZero = true): number[] {
  return value.split(',').map((part) => {
    const n = Number(part);
    if (!/^[+-]?\d+$/.test(part) || n < min || n > max || (!allowZero && n === 0)) {
      throw new RuleError(`invalid value ${part}`);
    }
    return n;
  });
}

function parseByDay(value: string): ByDay[] {
  return value.split(',').map((part) => {
    const match = /^([+-]?\d{1,2})?([A-Z]{2})$/.exec(part);
    const nth = Number(match?.[1] ?? 0);
    const day = WEEKDAY_CODES.findIndex((code) => code === match?.[2]);
    if (day < 0 || Math.abs(nth) > 53) throw new RuleError(`invalid BYDAY ${part}`);
    return { weekday: day, nth };
  });
}

function parseUntil(value: string): number {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!match) throw new RuleError(`UNTIL must be a UTC date-time, got ${value}`);
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
}

export function parseRule(text: string): Rule {
  const fields = new Map<string, string>();
  for (const part of text.replace(/^RRULE:/, '').split(';')) {
    const [key, value, ...rest] = part.split('=');
    if (!key || !value || rest.length > 0 || fields.has(key)) throw new RuleError(`invalid rule part ${part}`);
    fields.set(key, value);
  }
  const freq = FREQUENCIES.find((candidate) => candidate === fields.get('FREQ'));
  if (!freq) throw new RuleError('FREQ is missing or unsupported');
  if ((fields.get('WKST') ?? 'MO') !== 'MO') throw new RuleError('only WKST=MO is supported');

  const parsed = rule(freq);
  for (const [key, value] of fields) {
    switch (key) {
      case 'FREQ':
      case 'WKST':
        break;
      case 'INTERVAL':
        [parsed.interval = 1] = integers(value, 1, 1000);
        break;
      case 'COUNT':
        [parsed.count = null] = integers(value, 1, 100_000);
        break;
      case 'UNTIL':
        parsed.until = parseUntil(value);
        break;
      case 'BYMONTH':
        parsed.byMonth = integers(value, 1, 12);
        break;
      case 'BYMONTHDAY':
        parsed.byMonthDay = integers(value, -31, 31, false);
        break;
      case 'BYDAY':
        parsed.byDay = parseByDay(value);
        break;
      case 'BYHOUR':
        parsed.byHour = integers(value, 0, 23);
        break;
      case 'BYMINUTE':
        parsed.byMinute = integers(value, 0, 59);
        break;
      case 'BYSETPOS':
        parsed.bySetPos = integers(value, -366, 366, false);
        break;
      default:
        throw new RuleError(`unsupported rule part ${key}`);
    }
  }
  if (parsed.count !== null && parsed.until !== null) throw new RuleError('COUNT and UNTIL are mutually exclusive');
  return parsed;
}

function formatUntil(instant: number): string {
  return new Date(instant)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

export function formatRule(value: Rule): string {
  const parts: string[] = [`FREQ=${value.freq}`];
  const list = (key: string, items: readonly (number | string)[]) => {
    if (items.length > 0) parts.push(`${key}=${items.join(',')}`);
  };
  if (value.interval !== 1) parts.push(`INTERVAL=${value.interval}`);
  list('BYMONTH', value.byMonth);
  list('BYMONTHDAY', value.byMonthDay);
  list(
    'BYDAY',
    value.byDay.map(({ weekday: day, nth }) => `${nth === 0 ? '' : nth}${WEEKDAY_CODES[day]}`),
  );
  list('BYHOUR', value.byHour);
  list('BYMINUTE', value.byMinute);
  list('BYSETPOS', value.bySetPos);
  if (value.count !== null) parts.push(`COUNT=${value.count}`);
  if (value.until !== null) parts.push(`UNTIL=${formatUntil(value.until)}`);
  return parts.join(';');
}

interface Expansion {
  freq: Frequency;
  interval: number;
  months: number[];
  monthDays: number[];
  days: ByDay[];
  nthWithinYear: boolean;
  hours: number[];
  minutes: number[];
  setPos: number[];
}

function ascending(items: number[]): number[] {
  return items.toSorted((a, b) => a - b);
}

function expansion(value: Rule, start: LocalDateTime): Expansion {
  const daySelected = value.byDay.length > 0 || value.byMonthDay.length > 0;
  let months = value.byMonth;
  let monthDays = value.byMonthDay;
  let days = value.byDay;
  if (value.freq === 'WEEKLY' && days.length === 0) days = [{ weekday: weekday(epochDay(start)), nth: 0 }];
  if (value.freq === 'MONTHLY' && !daySelected) monthDays = [start.day];
  if (value.freq === 'YEARLY' && !daySelected) {
    monthDays = [start.day];
    if (months.length === 0) months = [start.month];
  }
  const nthApplies = value.freq === 'MONTHLY' || value.freq === 'YEARLY';
  return {
    freq: value.freq,
    interval: value.interval,
    months,
    monthDays,
    days: nthApplies ? days : days.map(({ weekday: day }) => ({ weekday: day, nth: 0 })),
    nthWithinYear: value.freq === 'YEARLY' && months.length === 0,
    hours: ascending(value.byHour.length > 0 || value.freq === 'HOURLY' ? value.byHour : [start.hour]),
    minutes: ascending(value.byMinute.length > 0 ? value.byMinute : [start.minute]),
    setPos: value.bySetPos,
  };
}

const MONDAY_EPOCH_DAY = 4;

function range(first: number, length: number): number[] {
  return Array.from({ length }, (_, i) => first + i);
}

interface Period {
  unit: (local: LocalDateTime) => number;
  days: (unit: number) => number[];
}

const PERIODS: Record<Frequency, Period> = {
  HOURLY: {
    unit: (local) => epochDay(local) * 24 + local.hour,
    days: (unit) => [Math.floor(unit / 24)],
  },
  DAILY: {
    unit: (local) => epochDay(local),
    days: (unit) => [unit],
  },
  WEEKLY: {
    unit: (local) => Math.floor((epochDay(local) - MONDAY_EPOCH_DAY) / 7),
    days: (unit) => range(unit * 7 + MONDAY_EPOCH_DAY, 7),
  },
  MONTHLY: {
    unit: (local) => local.year * 12 + local.month - 1,
    days: (unit) => {
      const year = Math.floor(unit / 12);
      const month = unit - year * 12 + 1;
      return range(epochDay({ year, month, day: 1 }), daysInMonth(year, month));
    },
  },
  YEARLY: {
    unit: (local) => local.year,
    days: (unit) => {
      const first = epochDay({ year: unit, month: 1, day: 1 });
      return range(first, epochDay({ year: unit + 1, month: 1, day: 1 }) - first);
    },
  },
};

function hoursOf(plan: Expansion, unit: number): number[] {
  if (plan.freq !== 'HOURLY') return plan.hours;
  const hour = unit % 24;
  return plan.hours.length === 0 || plan.hours.includes(hour) ? [hour] : [];
}

function matchesNth(nth: number, index: number, length: number): boolean {
  return nth === Math.ceil(index / 7) || nth === -Math.ceil((length - index + 1) / 7);
}

function dayMatches(plan: Expansion, day: number, date: LocalDate): boolean {
  if (plan.months.length > 0 && !plan.months.includes(date.month)) return false;
  const monthLength = daysInMonth(date.year, date.month);
  if (plan.monthDays.length > 0 && !plan.monthDays.some((d) => d === date.day || d === date.day - monthLength - 1)) {
    return false;
  }
  if (plan.days.length === 0) return true;
  const yearStart = epochDay({ year: date.year, month: 1, day: 1 });
  const yearLength = epochDay({ year: date.year + 1, month: 1, day: 1 }) - yearStart;
  return plan.days.some(
    ({ weekday: wd, nth }) =>
      wd === weekday(day) &&
      (nth === 0 ||
        (plan.nthWithinYear
          ? matchesNth(nth, day - yearStart + 1, yearLength)
          : matchesNth(nth, date.day, monthLength))),
  );
}

function candidates(plan: Expansion, unit: number): LocalDateTime[] {
  const hours = hoursOf(plan, unit);
  const found: LocalDateTime[] = [];
  for (const day of PERIODS[plan.freq].days(unit)) {
    const date = fromEpochDay(day);
    if (!dayMatches(plan, day, date)) continue;
    for (const hour of hours) for (const minute of plan.minutes) found.push({ ...date, hour, minute });
  }
  if (plan.setPos.length === 0) return found;
  return plan.setPos
    .map((pos) => found.at(pos > 0 ? pos - 1 : pos))
    .filter((local): local is LocalDateTime => local !== undefined)
    .toSorted((a, b) => wallMs(a) - wallMs(b));
}

const MAX_EMPTY_PERIODS = 5000;

export function* occurrences(value: Rule, start: LocalDateTime, zone: string, after = -Infinity): Generator<number> {
  const plan = expansion(value, start);
  const { unit } = PERIODS[plan.freq];
  const firstUnit = unit(start);
  const startWall = wallMs(start);
  let period = 0;
  if (value.count === null && after > -Infinity) {
    const behind = Math.floor((unit(toLocal(after, zone)) - firstUnit) / plan.interval) - 1;
    period = Math.max(0, behind);
  }
  let emitted = 0;
  let previous = -Infinity;
  for (let empty = 0; empty < MAX_EMPTY_PERIODS; period++) {
    empty++;
    for (const local of candidates(plan, firstUnit + period * plan.interval)) {
      if (wallMs(local) < startWall) continue;
      const instant = toInstant(local, zone);
      if (instant === previous) continue;
      if (value.until !== null && instant > value.until) return;
      previous = instant;
      empty = 0;
      emitted++;
      if (instant > after) yield instant;
      if (value.count !== null && emitted >= value.count) return;
    }
  }
}

export function nextOccurrence(value: Rule, start: LocalDateTime, zone: string, after: number): number | null {
  for (const instant of occurrences(value, start, zone, after)) return instant;
  return null;
}
