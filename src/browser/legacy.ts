import { EMPTY_LOCAL, type Local } from './schema';

/**
 * Bundles from before pausing read `local` and break on ops they don't know, and one may still be open in another tab,
 * so this one keeps its state under `state` and takes over whatever such a tab queues under `local`, which it still
 * sends itself (the server applies each op id once). Returns the legacy value to store, or undefined to leave it.
 */
export function withLegacy(
  legacy: Local | undefined,
  current: Local | undefined,
  change: (local: Local) => Local,
): [Local | undefined, Local] {
  if (!legacy) return [undefined, change(current ?? EMPTY_LOCAL)];
  const adopted = current ? { ...current, pending: [...current.pending, ...legacy.pending] } : legacy;
  return [legacy.pending.length > 0 ? { ...legacy, pending: [] } : undefined, change(adopted)];
}
