import type { Occurrence, PushData } from '../shared/notification';
import { claimNotice, isSeenIn, settleNotice } from './claims';
import { get, update } from './kv';
import type { Claim, Notices } from './schema';

const EMPTY: Notices = { seen: [], claims: {} };

type Shown = Pick<PushData, 'fire' | 'notice'>;

export async function isSeen(shown: Shown): Promise<boolean> {
  return isSeenIn(((await get('notices')) ?? EMPTY).seen, shown);
}

export async function claim(shown: Shown, now: number, occurrence: Occurrence | null): Promise<Claim> {
  let outcome: Claim = 'busy';
  await update('notices', (current = EMPTY) => {
    const claimed = claimNotice(current, shown, now, occurrence);
    outcome = claimed.outcome;
    return claimed.notices;
  });
  return outcome;
}

export async function settle(shown: Shown, displayed: boolean): Promise<void> {
  await update('notices', (current = EMPTY) => settleNotice(current, shown, displayed));
}
