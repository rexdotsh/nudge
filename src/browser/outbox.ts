import type { Change } from '../shared/api';
import { parseOp } from '../shared/input';
import type { Op } from '../shared/ops';
import { ulid } from '../shared/ulid';
import { update } from './kv';
import { EMPTY_LOCAL, type Local, type Snapshot } from './schema';

export const currentZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

// The server rejects a whole batch for one bad op, so a queued bad op would block every later change for good.
export async function enqueue(op: Op): Promise<Change> {
  const accepted = parseOp(op);
  if (!accepted) throw new Error(`refusing to queue a ${op.type} the server would reject`);
  const change: Change = { opId: ulid(), op: accepted, at: Date.now() };
  await update('local', (local = EMPTY_LOCAL) => ({ ...local, pending: [...local.pending, change] }));
  return change;
}

export function commit(snapshot: Snapshot, acknowledged: ReadonlySet<string>): Promise<Local> {
  return update('local', (local = EMPTY_LOCAL) => ({
    replica: snapshot.version >= local.replica.version ? snapshot : local.replica,
    pending: local.pending.filter((change) => !acknowledged.has(change.opId)),
  }));
}
