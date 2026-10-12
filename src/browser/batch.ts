import { MAX_CHANGES, type Change } from '../shared/api';
import { utf8 } from '../shared/encoding';

const ENVELOPE_BYTES = 1024;

export function batch(pending: readonly Change[], maxBytes: number): Change[] {
  const changes: Change[] = [];
  let bytes = ENVELOPE_BYTES;
  for (const change of pending.slice(0, MAX_CHANGES)) {
    bytes += utf8(JSON.stringify(change)).length + 1;
    if (bytes > maxBytes && changes.length > 0) break;
    changes.push(change);
  }
  return changes;
}
