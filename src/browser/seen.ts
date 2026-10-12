import { get, update } from './kv';
import type { Notices } from './schema';

const LIMIT = 300;
const CLAIM_MS = 60_000;
const EMPTY: Notices = { seen: [], claims: {} };

export async function isSeen(fire: string): Promise<boolean> {
  return ((await get('notices')) ?? EMPTY).seen.includes(fire);
}

// The service worker and an open page can both try to show the same fire; whoever claims it first shows it.
export async function claim(fire: string, now: number): Promise<boolean> {
  let won = false;
  await update('notices', (current = EMPTY) => {
    const claimedAt = current.claims[fire];
    won = !current.seen.includes(fire) && (claimedAt === undefined || now - claimedAt >= CLAIM_MS);
    return won ? { ...current, claims: { ...current.claims, [fire]: now } } : current;
  });
  return won;
}

export async function settle(fire: string, shown: boolean): Promise<void> {
  await update('notices', (current = EMPTY) => ({
    claims: Object.fromEntries(Object.entries(current.claims).filter(([key]) => key !== fire)),
    seen: shown && !current.seen.includes(fire) ? [...current.seen.slice(1 - LIMIT), fire] : current.seen,
  }));
}
