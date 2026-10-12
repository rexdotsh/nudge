import { TIME, clock, type Time } from '../../shared/phrases';
import { epochDay, formatClock, parseLocal, weekday, type LocalDate } from '../../shared/time';

const TYPED_TIME = new RegExp(`^${TIME}$`);
const SUNDAY_FIRST = new Set(['BR', 'CA', 'HK', 'IL', 'IN', 'JP', 'KR', 'MX', 'PH', 'SA', 'TW', 'US', 'ZA']);
const GRID_DAYS = 42;
const SLOT_MINUTES = 30;

/** The locale's first day of the week, numbered like weekday(): 0 is Monday. */
export function weekStart(tag: string): number {
  const locale = new Intl.Locale(tag);
  // Firefox has no getWeekInfo yet, so it falls back to the regions that start on Sunday.
  if (typeof locale.getWeekInfo === 'function') return locale.getWeekInfo().firstDay - 1;
  return SUNDAY_FIRST.has(locale.maximize().region ?? '') ? 6 : 0;
}

/** Six whole weeks from the one holding the 1st, as epoch days, so every month takes the same space. */
export function monthGrid(month: Pick<LocalDate, 'year' | 'month'>, firstWeekday: number): number[] {
  const first = epochDay({ ...month, day: 1 });
  const start = first - ((weekday(first) - firstWeekday + 7) % 7);
  return Array.from({ length: GRID_DAYS }, (_, index) => start + index);
}

export function parseDate(value: string): number | null {
  const local = parseLocal(`${value}T00:00`);
  return local && epochDay(local);
}

/** A time typed the way quick-add reads one: "5:20pm", "17:20", "5.20 pm". */
export function parseTime(text: string): Time | null {
  const match = TYPED_TIME.exec(text.trim().toLowerCase());
  return match ? clock(match[1] ?? '', match[2], match[3]) : null;
}

/** Every half hour of the day, plus the current time when it falls between them. */
export function timeSlots(current: string): string[] {
  const slots = Array.from({ length: (24 * 60) / SLOT_MINUTES }, (_, index) =>
    formatClock({ hour: Math.floor((index * SLOT_MINUTES) / 60), minute: (index * SLOT_MINUTES) % 60 }),
  );
  return parseTime(current) && !slots.includes(current) ? [...slots, current].toSorted() : slots;
}
