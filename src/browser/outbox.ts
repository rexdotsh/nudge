import type { SyncResponse } from '../shared/api';
import { parseOp } from '../shared/input';
import type { Op } from '../shared/ops';
import { ulid } from '../shared/ulid';
import { updatePair } from './kv';
import { Replica } from './replica';
import { withLegacy } from './legacy';
import type { Local } from './schema';

export const currentZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

function updateLocal(change: (local: Local) => Local): Promise<Local> {
  return updatePair('local', 'state', (legacy, current) => withLegacy(legacy, current, change));
}

export function readLocal(): Promise<Local> {
  return updateLocal((local) => local);
}

// The server rejects a whole batch for one bad op, so a queued bad op would block every later change for good.
export function enqueue(ops: readonly Op[]): Promise<Local> {
  const at = Date.now();
  const changes = ops.map((op) => {
    const accepted = parseOp(op);
    if (!accepted) throw new Error(`refusing to queue a ${op.type} the server would reject`);
    return { opId: ulid(), op: accepted, at };
  });
  return updateLocal((local) => ({ ...local, pending: [...local.pending, ...changes] }));
}

export function commit(response: SyncResponse, since: number, acknowledged: ReadonlySet<string>): Promise<Local> {
  return updateLocal((local) => {
    const replica = new Replica(local.replica);
    replica.receive(response, since);
    return { replica: replica.snapshot(), pending: local.pending.filter((change) => !acknowledged.has(change.opId)) };
  });
}
