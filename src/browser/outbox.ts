import type { Change } from '../shared/api';
import type { Op } from '../shared/ops';
import { ulid } from '../shared/ulid';
import { update } from './kv';
import type { PendingChange } from './schema';

export const currentZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

export async function enqueue(op: Op): Promise<PendingChange> {
  const change: PendingChange = { opId: ulid(), op, at: Date.now() };
  await update('pending', (pending = []) => [...pending, change]);
  return change;
}

export async function acknowledge(opIds: ReadonlySet<string>): Promise<PendingChange[]> {
  return update('pending', (pending = []) => pending.filter((change) => !opIds.has(change.opId)));
}

export function wire(pending: readonly PendingChange[]): Change[] {
  return pending.map(({ opId, op }) => ({ opId, op }));
}
