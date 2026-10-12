import type { Repeat } from './reminder';
import { memoize } from './memoize';
import { atPositions, timesOfDay } from './occurrences';
import { parseRule, type ByDay, type Rule } from './rrule';
import { epochDay, toLocal, weekday, type LocalDateTime } from './time';

const ORDINAL_WORDS = ['', 'first', 'second', 'third', 'fourth', 'fifth'];
const UNITS = { HOURLY: 'hour', DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' } as const;

function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

function list(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} & ${items.at(-1)}`;
}

function every(interval: number, unit: string): string {
  if (interval === 1) return `Every ${unit}`;
  if (interval === 2) return `Every other ${unit}`;
  return `Every ${interval} ${unit}s`;
}

const namesFor = memoize((locale) => {
  const style = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
  const days = { long: style({ weekday: 'long' }), short: style({ weekday: 'short' }) };
  const months = { long: style({ month: 'long' }), short: style({ month: 'short' }) };
  const hours = style({ hour: 'numeric' });
  const minutes = style({ hour: 'numeric', minute: '2-digit' });
  return {
    weekday: (index: number, width: 'long' | 'short') => days[width].format(Date.UTC(2024, 0, 1 + index)),
    month: (month: number, width: 'long' | 'short') => months[width].format(Date.UTC(2024, month - 1, 1)),
    time: (hour: number, minute: number) => (minute === 0 ? hours : minutes).format(Date.UTC(2024, 0, 1, hour, minute)),
  };
});

type Names = ReturnType<typeof namesFor>;

const isSet = (days: ByDay[], wanted: number[]) =>
  days.length === wanted.length && days.every((day) => day.nth === 0 && wanted.includes(day.weekday));

function weekdays(rule: Rule, names: Names, fallback: number): string {
  const days = rule.byDay.length > 0 ? rule.byDay : [{ weekday: fallback, nth: 0 }];
  if (isSet(days, [0, 1, 2, 3, 4]))
    return rule.interval === 1 ? 'Every weekday' : `${every(rule.interval, 'week')} on weekdays`;
  if (isSet(days, [5, 6])) return rule.interval === 1 ? 'Every weekend' : `${every(rule.interval, 'week')} on weekends`;
  const named = days.map((day) => names.weekday(day.weekday, days.length === 1 ? 'long' : 'short'));
  if (rule.interval <= 2) return `${rule.interval === 1 ? 'Every' : 'Every other'} ${list(named)}`;
  return `${every(rule.interval, 'week')} on ${list(named)}`;
}

function nthWeekday(day: ByDay, names: Names): string {
  const position = day.nth === -1 ? 'last' : (ORDINAL_WORDS[day.nth] ?? ordinal(day.nth));
  return `the ${position} ${names.weekday(day.weekday, 'long')}`;
}

function monthDays(days: number[]): string | null {
  if (days.some((day) => day < -1)) return null;
  return `the ${list(days.map((day) => (day === -1 ? 'last day' : ordinal(day))))}`;
}

function cadence(rule: Rule, start: LocalDateTime, names: Names): string | null {
  const startWeekday = weekday(epochDay(start));
  const nth = rule.byDay.find((day) => day.nth !== 0);
  switch (rule.freq) {
    case 'HOURLY':
      return every(rule.interval, 'hour');
    case 'DAILY':
      if (rule.byDay.length === 0) return every(rule.interval, 'day');
      return rule.interval === 1 ? weekdays(rule, names, startWeekday) : null;
    case 'WEEKLY':
      return weekdays(rule, names, startWeekday);
    case 'MONTHLY': {
      const base =
        rule.interval === 1 ? 'Monthly' : rule.interval === 3 ? 'Every quarter' : every(rule.interval, 'month');
      if (rule.bySetPos.length > 0) {
        return rule.bySetPos.join() === '-1' && isSet(rule.byDay, [0, 1, 2, 3, 4])
          ? `${base} on the last weekday`
          : null;
      }
      if (nth && rule.byDay.length === 1) return `${base} on ${nthWeekday(nth, names)}`;
      if (rule.byDay.length > 0) return null;
      const days = monthDays(rule.byMonthDay.length > 0 ? rule.byMonthDay : [start.day]);
      return days === null ? null : `${base} on ${days}`;
    }
    case 'YEARLY': {
      const base = rule.interval === 1 ? 'Every year' : every(rule.interval, 'year');
      const month = rule.byMonth[0] ?? start.month;
      if (rule.byMonth.length > 1 || rule.bySetPos.length > 0) return null;
      if (nth && rule.byDay.length === 1)
        return `${base} on ${nthWeekday(nth, names)} of ${names.month(month, 'long')}`;
      if (rule.byDay.length > 0 || rule.byMonthDay.length > 1 || (rule.byMonthDay[0] ?? 1) < 1) return null;
      return `${base} on ${names.month(month, 'short')} ${rule.byMonthDay[0] ?? start.day}`;
    }
    default: {
      const unhandled: never = rule.freq;
      return unhandled;
    }
  }
}

function pickedTimes(rule: Rule, start: LocalDateTime) {
  const grid = timesOfDay(rule, start);
  if (rule.bySetPos.length === 0) return grid;
  if (rule.freq !== 'DAILY') return grid.length === 1 ? grid : null;
  const picked = atPositions(grid, rule.bySetPos);
  return picked.length > 0 ? picked : null;
}

function times(rule: Rule, start: LocalDateTime, names: Names): string | null {
  if (rule.freq === 'HOURLY') return '';
  const picked = pickedTimes(rule, start);
  if (picked === null) return null;
  return picked.length < 2 ? '' : ` at ${list(picked.map(({ hour, minute }) => names.time(hour, minute)))}`;
}

function ending(rule: Rule, names: Names, zone: string): string {
  if (rule.count !== null) return `, ${rule.count} times`;
  if (rule.until === null) return '';
  const until = toLocal(rule.until, zone);
  return `, until ${names.month(until.month, 'short')} ${until.day}`;
}

export function describeRepeat(repeat: Repeat, start: LocalDateTime, locale: string, zone: string): string {
  const rule = parseRule(repeat.rule);
  const names = namesFor(locale);
  if (repeat.anchor === 'completion') {
    const unit = UNITS[rule.freq];
    return `${rule.interval} ${unit}${rule.interval === 1 ? '' : 's'} after done`;
  }
  const phrase = cadence(rule, start, names);
  const at = times(rule, start, names);
  if (phrase === null || at === null) return 'Custom repeat';
  return `${phrase}${at}${ending(rule, names, zone)}`;
}
