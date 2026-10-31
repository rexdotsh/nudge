import { expect, test } from 'bun:test';
import type { ZoneState } from '../src/browser/schema';
import { instanceZone } from '../src/browser/zone';

const HOME = 'Asia/Kolkata';
const AWAY = 'America/New_York';
const FIXED = 'Europe/Paris';

const heard = (name: string, fixed: boolean, reported = HOME): ZoneState => ({
  zone: { name, fixed },
  reported,
  version: 3,
  pending: null,
});
const choosing = (zone: string | null): ZoneState => ({ ...heard(FIXED, true), pending: { id: 'c', zone, at: 0 } });

test.each<[string, ZoneState | undefined, string, string, boolean]>([
  ['before its first sync, or with state saved before the zone was kept', undefined, HOME, HOME, false],
  ['following, moved by another device', heard(AWAY, false), HOME, AWAY, false],
  ['following, after this device moved and before it reported it', heard(HOME, false), AWAY, AWAY, false],
  ['fixed, after this device moved', heard(FIXED, true), AWAY, FIXED, true],
  ['with a fixed zone chosen here and not yet sent', choosing(AWAY), HOME, AWAY, true],
  ['with following chosen here and not yet sent', choosing(null), HOME, HOME, false],
])('a device plans in the zone the server does: %s', (_, state, here, name, fixed) => {
  expect(instanceZone(state, here)).toEqual({ name, fixed });
});
