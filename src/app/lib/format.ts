import { describeRepeat } from '../../shared/describe';
import { memoize } from '../../shared/memoize';
import { local, type Repeat } from '../../shared/reminder';
import type { Time } from '../../shared/phrases';
import { DAY_MS, MINUTE_MS, daysFromToday, toLocal } from '../../shared/time';

export const locale = navigator.language;

const formatters = memoize((zone) => {
  const style = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: zone });
  return {
    time: style({ hour: 'numeric', minute: '2-digit' }),
    hour: style({ hour: 'numeric' }),
    weekday: style({ weekday: 'long' }),
    shortWeekday: style({ weekday: 'short' }),
    date: style({ weekday: 'short', month: 'short', day: 'numeric' }),
    dayMonth: style({ day: 'numeric', month: 'short' }),
    fullDate: style({ month: 'short', day: 'numeric', year: 'numeric' }),
    longDate: style({ dateStyle: 'full' }),
    day: style({ day: 'numeric' }),
    month: style({ month: 'long', year: 'numeric' }),
  };
});

// Apart from the other formatters, since the time zone picker names every zone there is.
const zoneNames = memoize((zone) => {
  const style = (timeZoneName: 'long' | 'shortOffset') =>
    new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName });
  return { long: style('long'), offset: style('shortOffset') };
});

function zoneName(zone: string, now: number, style: keyof ReturnType<typeof zoneNames>): string {
  const parts = zoneNames(zone)[style].formatToParts(now);
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? zone;
}

type Style = keyof ReturnType<typeof formatters>;

const format = (instant: number, zone: string, style: Style) => formatters(zone)[style].format(instant);

/** A wall-clock date on its own, read on UTC so no time zone can move it to another day. */
export function calendarLabel(days: number, style: Style): string {
  return format(days * DAY_MS, 'UTC', style);
}

export function clockLabel({ hour, minute }: Time): string {
  return format(Date.UTC(1970, 0, 1, hour, minute), 'UTC', 'time');
}

export function dayLabel(instant: number, now: number, zone: string): string {
  const days = daysFromToday(instant, now, zone);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1 && days < 7) return format(instant, zone, 'weekday');
  return format(instant, zone, toLocal(instant, zone).year === toLocal(now, zone).year ? 'date' : 'fullDate');
}

export function pausedLabel(until: number | null, now: number, zone: string): string {
  return until === null ? 'Paused until you resume it' : `Paused until ${dayLabel(until, now, zone)}`;
}

export function timeLabel(instant: number, zone: string): string {
  return format(instant, zone, 'time');
}

export function untilLabel(instant: number, now: number): string {
  const minutes = Math.max(1, Math.round((instant - now) / MINUTE_MS));
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `in ${hours}h` : `in ${hours}h ${rest}m`;
}

const LEAD_UNITS = [
  [7 * 24 * 60, 'week'],
  [24 * 60, 'day'],
  [60, 'hour'],
] as const;

const counted = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'}`;

export function alertLabel(minutes: number): string {
  const unit = LEAD_UNITS.find(([size]) => minutes % size === 0);
  if (unit) return counted(minutes / unit[0], unit[1]);
  return minutes < 60 ? `${minutes} min` : `${counted(Math.floor(minutes / 60), 'hour')} ${minutes % 60} min`;
}

export function whenLabel(instant: number, now: number, zone: string): string {
  const minutes = Math.round((instant - now) / MINUTE_MS);
  if (minutes > 0 && minutes < 60) return untilLabel(instant, now);
  const days = daysFromToday(instant, now, zone);
  return days === 0 ? timeLabel(instant, zone) : `${dayLabel(instant, now, zone)}, ${timeLabel(instant, zone)}`;
}

export function summaryWhen(instant: number, now: number, zone: string): string {
  const clock = format(instant, zone, toLocal(instant, zone).minute === 0 ? 'hour' : 'time');
  const days = daysFromToday(instant, now, zone);
  if (days === 0) return `Today ${clock}`;
  if (days === 1) return `Tomorrow ${clock}`;
  if (days === -1) return `Yesterday ${clock}`;
  if (days > 1 && days < 7) return `${format(instant, zone, 'shortWeekday')} ${clock}`;
  const sameYear = toLocal(instant, zone).year === toLocal(now, zone).year;
  return `${format(instant, zone, sameYear ? 'dayMonth' : 'fullDate')}, ${clock}`;
}

export function dayHeading(now: number, zone: string): { weekday: string; date: string } {
  return { weekday: format(now, zone, 'weekday'), date: format(now, zone, 'dayMonth') };
}

export function shortWhen(instant: number, now: number, zone: string): string {
  const days = daysFromToday(instant, now, zone);
  const time = timeLabel(instant, zone);
  if (days <= 0) return time;
  if (days === 1) return `Tomorrow ${time}`;
  return days < 7 ? `${format(instant, zone, 'shortWeekday')} ${time}` : format(instant, zone, 'date');
}

export function zoneLabel(zone: string, now: number): string {
  return zoneName(zone, now, 'long');
}

/** A zone by its place, like Buenos Aires for America/Argentina/Buenos_Aires. */
export function zonePlace(zone: string): string {
  return (zone.split('/').at(-1) ?? zone).replaceAll('_', ' ');
}

export function zoneOptionLabel(zone: string, now: number): string {
  return `${zonePlace(zone)} · ${zoneName(zone, now, 'offset')}`;
}

export function repeatLabel(repeat: Repeat, start: string, zone: string, options?: { withTime: boolean }): string {
  return describeRepeat(repeat, local(start), locale, zone, options);
}
