import { TIME, clock, type Time } from '../../shared/phrases';
import { epochDay, formatClock, parseLocal, weekday, type LocalDate } from '../../shared/time';

const TYPED_TIME = new RegExp(`^${TIME}$`);
// CLDR's regions whose week does not start on Monday, by ISO day (5 is Friday, 7 is Sunday).
const FIRST_DAYS: Record<string, number> = Object.fromEntries(
  Object.entries({
    5: 'MV',
    6: 'AE AF BH DJ DZ EG IQ IR JO KW LY OM QA SD SY',
    7: 'AG AS BD BR BS BT BW BZ CA CN CO DM DO ET GT GU HK HN ID IL IN JM JP KE KH KR LA MH MM MO MT MX MZ NI NP PA PE PH PK PR PT PY SA SG SV TH TT TW UM US VE VI WS YE ZA ZW',
  }).flatMap(([day, regions]) => regions.split(' ').map((region) => [region, Number(day)])),
);
const GRID_DAYS = 42;
const SLOT_MINUTES = 30;

function reportedFirstDay(locale: Intl.Locale): number | null {
  if (typeof locale.getWeekInfo === 'function') return locale.getWeekInfo().firstDay;
  // Older Chrome and Safari only have the earlier weekInfo getter, and Firefox has neither.
  const legacy: unknown = Reflect.get(locale, 'weekInfo');
  return typeof legacy === 'object' && legacy !== null && 'firstDay' in legacy && typeof legacy.firstDay === 'number'
    ? legacy.firstDay
    : null;
}

export function regionWeekStart(tag: string): number {
  return (FIRST_DAYS[new Intl.Locale(tag).maximize().region ?? ''] ?? 1) - 1;
}

export function weekStart(tag: string): number {
  const reported = reportedFirstDay(new Intl.Locale(tag));
  return reported === null ? regionWeekStart(tag) : reported - 1;
}

export function monthGrid(month: Pick<LocalDate, 'year' | 'month'>, firstWeekday: number): number[] {
  const first = epochDay({ ...month, day: 1 });
  const start = first - ((weekday(first) - firstWeekday + 7) % 7);
  return Array.from({ length: GRID_DAYS }, (_, index) => start + index);
}

export function parseDate(value: string): number | null {
  const local = parseLocal(`${value}T00:00`);
  return local && epochDay(local);
}

export function parseTime(text: string): Time | null {
  const match = TYPED_TIME.exec(text.trim().toLowerCase());
  return match ? clock(match[1] ?? '', match[2], match[3]) : null;
}

export function timeSlots(current: string): string[] {
  const slots = Array.from({ length: (24 * 60) / SLOT_MINUTES }, (_, index) =>
    formatClock({ hour: Math.floor((index * SLOT_MINUTES) / 60), minute: (index * SLOT_MINUTES) % 60 }),
  );
  return parseTime(current) && !slots.includes(current) ? [...slots, current].toSorted() : slots;
}
