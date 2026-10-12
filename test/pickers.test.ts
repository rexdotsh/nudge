import { expect, test } from 'bun:test';
import { monthGrid, parseTime, regionWeekStart, weekStart } from '../src/app/lib/pickers';
import { daysInMonth, epochDay, formatClock, formatDate, fromEpochDay } from '../src/shared/time';

test('the month grid starts on the locale’s first weekday and holds the whole month', () => {
  const cases: [locale: string, year: number, month: number, first: string][] = [
    ['en-GB', 2026, 10, '2026-09-28'],
    ['en-US', 2026, 10, '2026-09-27'],
    ['en-US', 2026, 2, '2026-02-01'],
    ['de-DE', 2026, 2, '2026-01-26'],
    ['de-DE', 2026, 6, '2026-06-01'],
    ['ar-EG', 2026, 10, '2026-09-26'],
    ['en-GB', 2026, 8, '2026-07-27'],
  ];
  for (const [locale, year, month, first] of cases) {
    const grid = monthGrid({ year, month }, weekStart(locale));
    expect(formatDate(fromEpochDay(grid[0] ?? 0))).toBe(first);
    expect(grid).toContain(epochDay({ year, month, day: daysInMonth(year, month) }));
  }
});

test('without the week info API, the region still decides the first weekday', () => {
  const cases: [locale: string, start: number][] = [
    ['ar-EG', 5],
    ['fa-IR', 5],
    ['fa', 5],
    ['en-US', 6],
    ['he', 6],
    ['en-GB', 0],
    ['de-DE', 0],
    ['dv-MV', 4],
  ];
  for (const [locale, start] of cases) expect(regionWeekStart(locale)).toBe(start);
});

test('a typed time becomes the time she meant', () => {
  const cases: [text: string, time: string | null][] = [
    ['5:20pm', '17:20'],
    ['5.20 PM', '17:20'],
    ['17:20', '17:20'],
    ['9', '09:00'],
    ['12am', '00:00'],
    ['12:30 pm', '12:30'],
    [' 7:05 a.m. ', '07:05'],
    ['13pm', null],
    ['24:00', null],
    ['5:60', null],
    ['tomorrow', null],
  ];
  for (const [text, time] of cases) {
    const parsed = parseTime(text);
    expect(parsed && formatClock(parsed)).toBe(time);
  }
});
