import type { ByDay, Frequency, Rule } from './rrule';
import {
  daysInMonth,
  epochDay,
  fromEpochDay,
  fromMonthIndex,
  monthIndex,
  toInstant,
  toLocal,
  wallMs,
  weekday,
  type LocalDate,
  type LocalDateTime,
} from './time';

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
    hours: ascending(value.byHour.length > 0 ? value.byHour : [start.hour]),
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
  longestGap: (interval: number) => number;
}

const GREGORIAN_CYCLE_DAYS = 146_097;
const MAX_EPOCH_DAY = 100_000_000;

function representableDays(days: number[]): number[] {
  return days.filter((day) => Math.abs(day) <= MAX_EPOCH_DAY);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function orbit(interval: number, cycle: number): number {
  return (interval * cycle) / gcd(interval, cycle);
}

const PERIODS: Record<Frequency, Period> = {
  HOURLY: {
    unit: (local) => epochDay(local) * 24 + local.hour,
    days: (unit) => representableDays([Math.floor(unit / 24)]),
    longestGap: () => GREGORIAN_CYCLE_DAYS * 24,
  },
  DAILY: {
    unit: (local) => epochDay(local),
    days: (unit) => representableDays([unit]),
    longestGap: (interval) => orbit(interval, GREGORIAN_CYCLE_DAYS),
  },
  WEEKLY: {
    unit: (local) => Math.floor((epochDay(local) - MONDAY_EPOCH_DAY) / 7),
    days: (unit) => range(unit * 7 + MONDAY_EPOCH_DAY, 7),
    longestGap: (interval) => orbit(interval, GREGORIAN_CYCLE_DAYS / 7),
  },
  MONTHLY: {
    unit: monthIndex,
    days: (unit) => {
      const { year, month } = fromMonthIndex(unit);
      return range(epochDay({ year, month, day: 1 }), daysInMonth(year, month));
    },
    longestGap: (interval) => orbit(interval, 400 * 12),
  },
  YEARLY: {
    unit: (local) => local.year,
    days: (unit) => {
      const first = epochDay({ year: unit, month: 1, day: 1 });
      return range(first, epochDay({ year: unit + 1, month: 1, day: 1 }) - first);
    },
    longestGap: (interval) => orbit(interval, 400),
  },
};

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
  const hours = plan.freq === 'HOURLY' ? [unit % 24] : plan.hours;
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

function nextUnit(plan: Expansion, unit: number, firstUnit: number): number {
  if (plan.freq !== 'HOURLY') return unit + plan.interval;
  const day = Math.floor(unit / 24);
  if (dayMatches(plan, day, fromEpochDay(day))) return unit + plan.interval;
  return firstUnit + Math.ceil(((day + 1) * 24 - firstUnit) / plan.interval) * plan.interval;
}

export function* occurrences(value: Rule, start: LocalDateTime, zone: string, after = -Infinity): Generator<number> {
  const plan = expansion(value, start);
  const period = PERIODS[plan.freq];
  const firstUnit = period.unit(start);
  const startWall = wallMs(start);
  const longestGap = period.longestGap(plan.interval);
  let current = firstUnit;
  if (value.count === null && after > -Infinity) {
    const behind = Math.floor((period.unit(toLocal(after, zone)) - firstUnit) / plan.interval) - 1;
    current = firstUnit + Math.max(0, behind) * plan.interval;
  }
  let progress = current;
  let emitted = 0;
  let previous = -Infinity;
  for (; current - progress <= longestGap; current = nextUnit(plan, current, firstUnit)) {
    if (period.days(current).length === 0) return;
    for (const local of candidates(plan, current)) {
      if (wallMs(local) < startWall) continue;
      const instant = toInstant(local, zone);
      if (instant === previous) continue;
      if (value.until !== null && instant > value.until) return;
      previous = instant;
      progress = current;
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
