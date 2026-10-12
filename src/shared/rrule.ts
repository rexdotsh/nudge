import { WEEKDAY_CODES } from './time';

const FREQUENCIES = ['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
const PARTS = new Set([
  'FREQ',
  'WKST',
  'INTERVAL',
  'COUNT',
  'UNTIL',
  'BYMONTH',
  'BYMONTHDAY',
  'BYDAY',
  'BYHOUR',
  'BYMINUTE',
  'BYSETPOS',
]);
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

function integers(value: string | undefined, min: number, max: number, allowZero = true): number[] {
  if (value === undefined) return [];
  return value.split(',').map((part) => {
    const n = Number(part);
    if (!/^[+-]?\d+$/.test(part) || n < min || n > max || (!allowZero && n === 0)) {
      throw new RuleError(`invalid value ${part}`);
    }
    return n;
  });
}

function integer(value: string, min: number, max: number): number {
  const [n] = integers(value, min, max);
  if (n === undefined || value.includes(',')) throw new RuleError(`invalid value ${value}`);
  return n;
}

function parseByDay(value: string | undefined): ByDay[] {
  if (value === undefined) return [];
  return value.split(',').map((part) => {
    const match = /^([+-]?\d{1,2})?([A-Z]{2})$/.exec(part);
    const nth = Number(match?.[1] ?? 0);
    const day = WEEKDAY_CODES.findIndex((code) => code === match?.[2]);
    if (day < 0 || Math.abs(nth) > 53) throw new RuleError(`invalid BYDAY ${part}`);
    return { weekday: day, nth };
  });
}

function formatUntil(instant: number): string {
  return new Date(instant)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function parseUntil(value: string): number {
  const instant = Date.parse(value.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
  if (Number.isNaN(instant) || formatUntil(instant) !== value) {
    throw new RuleError(`UNTIL must be a valid UTC date-time, got ${value}`);
  }
  return instant;
}

export function parseRule(text: string): Rule {
  const fields = new Map<string, string>();
  for (const part of text.replace(/^RRULE:/, '').split(';')) {
    const [key, value, ...rest] = part.split('=');
    if (!key || !value || rest.length > 0 || fields.has(key)) throw new RuleError(`invalid rule part ${part}`);
    if (!PARTS.has(key)) throw new RuleError(`unsupported rule part ${key}`);
    fields.set(key, value);
  }
  const freq = FREQUENCIES.find((candidate) => candidate === fields.get('FREQ'));
  if (!freq) throw new RuleError('FREQ is missing or unsupported');
  if ((fields.get('WKST') ?? 'MO') !== 'MO') throw new RuleError('only WKST=MO is supported');

  const count = fields.get('COUNT');
  const until = fields.get('UNTIL');
  const parsed = rule(freq, {
    interval: integer(fields.get('INTERVAL') ?? '1', 1, 1000),
    count: count === undefined ? null : integer(count, 1, 100_000),
    until: until === undefined ? null : parseUntil(until),
    byMonth: integers(fields.get('BYMONTH'), 1, 12),
    byMonthDay: integers(fields.get('BYMONTHDAY'), -31, 31, false),
    byDay: parseByDay(fields.get('BYDAY')),
    byHour: integers(fields.get('BYHOUR'), 0, 23),
    byMinute: integers(fields.get('BYMINUTE'), 0, 59),
    bySetPos: integers(fields.get('BYSETPOS'), -366, 366, false),
  });
  if (parsed.count !== null && parsed.until !== null) throw new RuleError('COUNT and UNTIL are mutually exclusive');
  if (freq === 'HOURLY' && parsed.byHour.length + parsed.byMinute.length + parsed.bySetPos.length > 0) {
    throw new RuleError('HOURLY rules may only be limited by month and day');
  }
  if (freq === 'HOURLY' && parsed.interval > 24) throw new RuleError('HOURLY intervals above 24 should be DAILY');
  return parsed;
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
