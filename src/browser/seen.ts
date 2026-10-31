import { get, update } from './kv';
import type { Claim, Notices } from './schema';

const LIMIT = 600;
const CLAIM_MS = 60_000;
const EMPTY: Notices = { seen: [], claims: {} };

// A notice goes by several keys (see `noticeKeys`); any one of them seen or claimed stands for the notice.
export async function isSeen(keys: readonly string[]): Promise<boolean> {
  const { seen } = (await get('notices')) ?? EMPTY;
  return keys.some((key) => seen.includes(key));
}

// The service worker and an open page can both try to show the same notice; whoever claims it first shows it.
export async function claim(keys: readonly string[], now: number): Promise<Claim> {
  let outcome: Claim = 'busy';
  await update('notices', (current = EMPTY) => {
    const busy = (key: string) => {
      const claimedAt = current.claims[key];
      return claimedAt !== undefined && now - claimedAt < CLAIM_MS;
    };
    if (keys.some((key) => current.seen.includes(key))) outcome = 'seen';
    else if (keys.some(busy)) outcome = 'busy';
    else outcome = 'won';
    if (outcome !== 'won') return current;
    return { ...current, claims: { ...current.claims, ...Object.fromEntries(keys.map((key) => [key, now])) } };
  });
  return outcome;
}

export async function settle(keys: readonly string[], shown: boolean): Promise<void> {
  await update('notices', (current = EMPTY) => {
    const added = shown ? keys.filter((key) => !current.seen.includes(key)) : [];
    return {
      claims: Object.fromEntries(Object.entries(current.claims).filter(([key]) => !keys.includes(key))),
      seen: added.length > 0 ? [...current.seen.slice(added.length - LIMIT), ...added] : current.seen,
    };
  });
}
