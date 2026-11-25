import { expect, test } from 'bun:test';
import { distinctZones, zonePlace } from '../src/app/lib/format';

test.each([
  ['Asia/Calcutta', 'Kolkata'],
  ['Asia/Kolkata', 'Kolkata'],
  ['Asia/Saigon', 'Ho Chi Minh'],
  ['Europe/Kiev', 'Kyiv'],
  ['America/Argentina/Buenos_Aires', 'Buenos Aires'],
])('%s is shown as %s', (zone, place) => {
  expect(zonePlace(zone)).toBe(place);
});

test('a zone listed under its old and new names appears once, under the name listed first', () => {
  expect(distinctZones(['Asia/Kolkata', 'Asia/Calcutta', 'Europe/Kiev', 'Europe/Kyiv', 'UTC'])).toEqual([
    'Asia/Kolkata',
    'Europe/Kiev',
    'UTC',
  ]);
});
