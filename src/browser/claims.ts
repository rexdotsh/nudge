import type { Occurrence } from '../shared/notification';
import type { Claim, Notices } from './schema';

const LIMIT = 600;
const CLAIM_MS = 60_000;

/**
 * Whether a notice was seen under any key it goes by (see `noticeKeys`). A record from before notices had occurrence
 * keys is a fire id alone, which cannot say which notice of its occurrence it was once the zone has moved; given the
 * occurrence, such a record stands for every notice of it. A fire id is unpaired when its occurrence has more fire ids
 * than occurrence keys, since every newer record adds one of each.
 */
export function seenIn(seen: readonly string[], keys: readonly string[], occurrence: Occurrence | null): boolean {
  if (keys.some((key) => seen.includes(key))) return true;
  if (!occurrence) return false;
  const { id, due } = occurrence;
  const fires = seen.filter((key) => key.startsWith(`${id}@`) && key.endsWith(`/${due}`)).length;
  return fires > seen.filter((key) => key.startsWith(`${id}:${due}/`)).length;
}

// The service worker and an open page can both try to show the same notice; whoever claims it first shows it. A notice
// seen under one of its keys is recorded under all of them, so a fire id from before the zone moved gains the key
// that still matches after it.
export function claimNotice(
  current: Notices,
  keys: readonly string[],
  now: number,
  occurrence: Occurrence | null,
): { outcome: Claim; notices: Notices } {
  if (keys.some((key) => current.seen.includes(key)))
    return { outcome: 'seen', notices: settleNotice(current, keys, true) };
  if (seenIn(current.seen, keys, occurrence)) return { outcome: 'seen', notices: current };
  const busy = keys.some((key) => {
    const claimedAt = current.claims[key];
    return claimedAt !== undefined && now - claimedAt < CLAIM_MS;
  });
  if (busy) return { outcome: 'busy', notices: current };
  const claims = { ...current.claims, ...Object.fromEntries(keys.map((key) => [key, now])) };
  return { outcome: 'won', notices: { ...current, claims } };
}

export function settleNotice(current: Notices, keys: readonly string[], shown: boolean): Notices {
  const added = shown ? keys.filter((key) => !current.seen.includes(key)) : [];
  return {
    claims: Object.fromEntries(Object.entries(current.claims).filter(([key]) => !keys.includes(key))),
    seen: added.length > 0 ? [...current.seen.slice(added.length - LIMIT), ...added] : current.seen,
  };
}
