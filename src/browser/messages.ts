import { isRecord } from '../shared/validate';

/** What the service worker tells open windows: their stored state changed, or a notification asks to show a link. */
export type WorkerMessage = { kind: 'changed' } | { kind: 'open'; url: string };

export function isWorkerMessage(value: unknown): value is WorkerMessage {
  return isRecord(value) && (value.kind === 'changed' || (value.kind === 'open' && typeof value.url === 'string'));
}
