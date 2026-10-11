import { expect, test } from 'bun:test';
import { addMinutes, isTimeZone, parseLocal, toInstant, toLocal, weekday, epochDay } from '../src/shared/time';

test('toLocal and toInstant are inverses away from transitions', () => {
  for (const zone of ['Asia/Kolkata', 'America/New_York', 'Europe/London', 'Australia/Lord_Howe', 'Pacific/Chatham']) {
    for (const instant of [Date.UTC(2026, 0, 15, 12, 34), Date.UTC(2026, 6, 4, 23, 59), Date.UTC(1999, 11, 31, 0, 0)]) {
      expect(toInstant(toLocal(instant, zone), zone)).toBe(instant);
    }
  }
});

test('parseLocal accepts only real calendar times', () => {
  expect(parseLocal('2026-10-11T09:05')).toEqual({ year: 2026, month: 10, day: 11, hour: 9, minute: 5 });
  expect(parseLocal('2026-02-29T09:00')).toBeNull();
  expect(parseLocal('2026-10-11T24:00')).toBeNull();
  expect(parseLocal('2026-10-11 09:00')).toBeNull();
});

test('weekday is Monday-based', () => {
  expect(weekday(epochDay({ year: 2026, month: 10, day: 12 }))).toBe(0);
  expect(weekday(epochDay({ year: 2026, month: 10, day: 11 }))).toBe(6);
  expect(weekday(epochDay({ year: 1969, month: 12, day: 29 }))).toBe(0);
});

test('addMinutes works on wall time', () => {
  expect(addMinutes({ year: 2026, month: 12, day: 31, hour: 23, minute: 50 }, 20)).toEqual({
    year: 2027,
    month: 1,
    day: 1,
    hour: 0,
    minute: 10,
  });
});

test('isTimeZone', () => {
  expect(isTimeZone('Asia/Kolkata')).toBe(true);
  expect(isTimeZone('Mars/Olympus_Mons')).toBe(false);
});
