import type { Occurrence, PushData } from '../shared/notification';
import type { Claim, Notices } from './schema';

const LIMIT = 600;
const CLAIM_MS = 60_000;
const PAIRED = '#';

type Shown = Pick<PushData, 'fire' | 'notice'>;

/**
 * What a shown notice is recorded as: its fire id, which older bundles look for, and its occurrence key joined to that
 * fire id. A fire id with no occurrence key joined to it was recorded by a bundle without them.
 */
function records({ fire, notice }: Shown): string[] {
  return notice === undefined ? [fire] : [fire, `${notice}${PAIRED}${fire}`];
}

const claimKeys = ({ fire, notice }: Shown) => (notice === undefined ? [fire] : [fire, notice]);

/** Seen under its fire id or its occurrence key, which still matches once the zone has moved. */
export function isSeenIn(seen: readonly string[], { fire, notice }: Shown): boolean {
  return seen.includes(fire) || (notice !== undefined && seen.some((key) => key.startsWith(`${notice}${PAIRED}`)));
}

// A fire id recorded alone cannot say which notice of its occurrence it was once the zone has moved, so for the
// fallback it stands for every notice of that occurrence.
function legacyRecord(seen: readonly string[], { id, due }: Occurrence): boolean {
  const paired = new Set(seen.flatMap((key) => (key.includes(PAIRED) ? [key.slice(key.indexOf(PAIRED) + 1)] : [])));
  return seen.some((key) => key.startsWith(`${id}@`) && key.endsWith(`/${due}`) && !paired.has(key));
}

/**
 * The service worker and an open page can both try to show the same notice; whoever claims it first shows it. A
 * notice seen under one key is recorded under the others too. The fallback passes the occurrence, so that a record
 * from before occurrence keys covers all of it; the service worker does not, so a real push is never held back.
 */
export function claimNotice(
  current: Notices,
  shown: Shown,
  now: number,
  occurrence: Occurrence | null,
): { outcome: Claim; notices: Notices } {
  if (isSeenIn(current.seen, shown)) return { outcome: 'seen', notices: settleNotice(current, shown, true) };
  if (occurrence && legacyRecord(current.seen, occurrence)) return { outcome: 'seen', notices: current };
  const keys = claimKeys(shown);
  const busy = keys.some((key) => {
    const claimedAt = current.claims[key];
    return claimedAt !== undefined && now - claimedAt < CLAIM_MS;
  });
  if (busy) return { outcome: 'busy', notices: current };
  return {
    outcome: 'won',
    notices: { ...current, claims: { ...current.claims, ...Object.fromEntries(keys.map((key) => [key, now])) } },
  };
}

export function settleNotice(current: Notices, shown: Shown, displayed: boolean): Notices {
  const keys = claimKeys(shown);
  const added = displayed ? records(shown).filter((key) => !current.seen.includes(key)) : [];
  return {
    claims: Object.fromEntries(Object.entries(current.claims).filter(([key]) => !keys.includes(key))),
    seen: added.length > 0 ? [...current.seen.slice(added.length - LIMIT), ...added] : current.seen,
  };
}
