import type { SyncResponse } from '../shared/api';
import { parseOp } from '../shared/input';
import type { Op } from '../shared/ops';
import { ulid } from '../shared/ulid';
import { update } from './kv';
import { Replica } from './replica';
import { EMPTY_LOCAL, type Local } from './schema';

export const currentZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

// The server rejects a whole batch for one bad op, so a queued bad op would block every later change for good.
export function enqueue(ops: readonly Op[]): Promise<Local> {
  const at = Date.now();
  const changes = ops.map((op) => {
    const accepted = parseOp(op);
    if (!accepted) throw new Error(`refusing to queue a ${op.type} the server would reject`);
    return { opId: ulid(), op: accepted, at };
  });
  return update('local', (local = EMPTY_LOCAL) => ({ ...local, pending: [...local.pending, ...changes] }));
}

export function commit(response: SyncResponse, since: number, acknowledged: ReadonlySet<string>): Promise<Local> {
  return update('local', (local = EMPTY_LOCAL) => {
    const replica = new Replica(local.replica);
    replica.receive(response, since);
    return { replica: replica.snapshot(), pending: local.pending.filter((change) => !acknowledged.has(change.opId)) };
  });
}
