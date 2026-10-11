import { expect, test } from 'bun:test';
import { parseLocal, toInstant, toLocal } from '../src/shared/time';

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
