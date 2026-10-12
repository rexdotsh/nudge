import { describeRepeat } from '../../shared/describe';
import { memoize } from '../../shared/memoize';
import { local, type Repeat } from '../../shared/reminder';
import { MINUTE_MS, epochDay, toLocal } from '../../shared/time';

const locale = navigator.language;

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
    zoneName: style({ timeZoneName: 'long' }),
  };
});

const format = (instant: number, zone: string, style: keyof ReturnType<typeof formatters>) =>
  formatters(zone)[style].format(instant);

export function daysFromToday(instant: number, now: number, zone: string): number {
  return epochDay(toLocal(instant, zone)) - epochDay(toLocal(now, zone));
}

function dayLabel(instant: number, now: number, zone: string): string {
  const days = daysFromToday(instant, now, zone);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1 && days < 7) return format(instant, zone, 'weekday');
  return format(instant, zone, toLocal(instant, zone).year === toLocal(now, zone).year ? 'date' : 'fullDate');
}

export function timeLabel(instant: number, zone: string): string {
  return format(instant, zone, 'time');
}

export function untilLabel(instant: number, now: number): string {
  const minutes = Math.max(1, Math.round((instant - now) / MINUTE_MS));
  return minutes < 60 ? `in ${minutes} min` : `in ${Math.floor(minutes / 60)} h`;
}

export function whenLabel(instant: number, now: number, zone: string): string {
  const minutes = Math.round((instant - now) / MINUTE_MS);
  if (minutes > 0 && minutes < 60) return untilLabel(instant, now);
  const days = daysFromToday(instant, now, zone);
  return days === 0 ? timeLabel(instant, zone) : `${dayLabel(instant, now, zone)}, ${timeLabel(instant, zone)}`;
}

/** "Today 8 PM", "Tomorrow 9:30 AM", "Sun 6 PM", "18 Oct 10 AM": the composer's summary of when it will remind. */
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

export function dateLabel(instant: number, zone: string): string {
  return format(instant, zone, 'date');
}

export function dayHeading(now: number, zone: string): { weekday: string; date: string } {
  return { weekday: format(now, zone, 'weekday'), date: format(now, zone, 'dayMonth') };
}

export function shortWhen(instant: number, now: number, zone: string): string {
  const days = daysFromToday(instant, now, zone);
  const time = timeLabel(instant, zone);
  if (days <= 0) return time;
  if (days === 1) return `Tomorrow ${time}`;
  return days < 7 ? `${format(instant, zone, 'shortWeekday')} ${time}` : dateLabel(instant, zone);
}

export function zoneLabel(zone: string, now: number): string {
  const parts = formatters(zone).zoneName.formatToParts(now);
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? zone;
}

export function repeatLabel(repeat: Repeat, start: string, zone: string): string {
  return describeRepeat(repeat, local(start), locale, zone);
}
