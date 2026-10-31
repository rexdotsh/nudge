import type { Occurrence } from '../shared/notification';
import { claimNotice, settleNotice } from './claims';
import { get, update } from './kv';
import type { Claim, Notices } from './schema';

const EMPTY: Notices = { seen: [], claims: {} };

export async function isSeen(keys: readonly string[]): Promise<boolean> {
  const { seen } = (await get('notices')) ?? EMPTY;
  return keys.some((key) => seen.includes(key));
}

/** With an occurrence, as the fallback claims, a fire id recorded before occurrence keys existed covers all of it. */
export async function claim(keys: readonly string[], now: number, occurrence: Occurrence | null): Promise<Claim> {
  let outcome: Claim = 'busy';
  await update('notices', (current = EMPTY) => {
    const claimed = claimNotice(current, keys, now, occurrence);
    outcome = claimed.outcome;
    return claimed.notices;
  });
  return outcome;
}

export async function settle(keys: readonly string[], shown: boolean): Promise<void> {
  await update('notices', (current = EMPTY) => settleNotice(current, keys, shown));
}
