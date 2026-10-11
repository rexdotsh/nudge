import { describeRepeat } from '../../shared/describe';
import { memoize } from '../../shared/memoize';
import { dueAt, local, type Reminder } from '../../shared/reminder';
import { MINUTE_MS, epochDay, toLocal } from '../../shared/time';

const locale = navigator.language;

const formatter = memoize((key) => {
  const [zone = 'UTC', style = 'time'] = key.split('|');
  const options: Record<string, Intl.DateTimeFormatOptions> = {
    time: { hour: 'numeric', minute: '2-digit' },
    weekday: { weekday: 'long' },
    short: { weekday: 'short' },
    day: { weekday: 'short', day: 'numeric', month: 'short' },
    dayMonth: { day: 'numeric', month: 'short' },
    date: { weekday: 'short', month: 'short', day: 'numeric' },
    year: { month: 'short', day: 'numeric', year: 'numeric' },
  };
  return new Intl.DateTimeFormat(locale, { ...options[style], timeZone: zone });
});

const format = (instant: number, zone: string, style: string) => formatter(`${zone}|${style}`).format(instant);

export function shownAt(reminder: Reminder, now: number, zone: string): number | null {
  if (reminder.snoozedUntil !== null && reminder.snoozedUntil > now) return reminder.snoozedUntil;
  return dueAt(reminder, zone);
}

export function daysFromToday(instant: number, now: number, zone: string): number {
  return epochDay(toLocal(instant, zone)) - epochDay(toLocal(now, zone));
}

function dayLabel(instant: number, now: number, zone: string): string {
  const days = daysFromToday(instant, now, zone);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1 && days < 7) return format(instant, zone, 'weekday');
  return format(instant, zone, toLocal(instant, zone).year === toLocal(now, zone).year ? 'date' : 'year');
}

export function timeLabel(instant: number, zone: string): string {
  return format(instant, zone, 'time');
}

export function whenLabel(instant: number, now: number, zone: string): string {
  const minutes = Math.round((instant - now) / MINUTE_MS);
  if (minutes > 0 && minutes < 60) return `in ${minutes} min`;
  const days = daysFromToday(instant, now, zone);
  return days === 0 ? timeLabel(instant, zone) : `${dayLabel(instant, now, zone)}, ${timeLabel(instant, zone)}`;
}

export function dateLabel(instant: number, zone: string): string {
  return format(instant, zone, 'day');
}

export function dayHeading(now: number, zone: string): { weekday: string; date: string } {
  return { weekday: format(now, zone, 'weekday'), date: format(now, zone, 'dayMonth') };
}

export function untilLabel(instant: number, now: number): string {
  const minutes = Math.max(1, Math.round((instant - now) / MINUTE_MS));
  return minutes < 60 ? `in ${minutes} min` : `in ${Math.floor(minutes / 60)} h`;
}

export function shortWhen(instant: number, now: number, zone: string): string {
  const days = daysFromToday(instant, now, zone);
  const time = timeLabel(instant, zone);
  if (days <= 0) return time;
  if (days === 1) return `Tomorrow ${time}`;
  return days < 7 ? `${format(instant, zone, 'short')} ${time}` : format(instant, zone, 'day');
}

export function repeatLabel(reminder: Reminder, zone: string): string | null {
  return reminder.repeat ? describeRepeat(reminder.repeat, local(reminder.start), { locale, zone, time: false }) : null;
}
