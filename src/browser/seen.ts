import { get, update } from './kv';

const LIMIT = 300;

export async function seenFires(): Promise<ReadonlySet<string>> {
  return new Set((await get('seen')) ?? []);
}

export async function markSeen(fire: string): Promise<void> {
  await update('seen', (seen = []) => (seen.includes(fire) ? seen : [...seen.slice(1 - LIMIT), fire]));
}
