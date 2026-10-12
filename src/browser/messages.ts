import { isRecord } from '../shared/validate';

export type WorkerMessage = { kind: 'changed' } | { kind: 'open'; url: string };

interface Opened {
  kind: 'opened';
}

export const OPENED: Opened = { kind: 'opened' };

export function isWorkerMessage(value: unknown): value is WorkerMessage {
  return isRecord(value) && (value.kind === 'changed' || (value.kind === 'open' && typeof value.url === 'string'));
}

function isOpened(value: unknown): value is Opened {
  return isRecord(value) && value.kind === 'opened';
}

interface Recipient {
  postMessage(message: WorkerMessage, transfer: MessagePort[]): void;
}

/**
 * Asks an open window to show a link in place, which unlike navigating it adds no history entry. A page loaded before
 * an update can't, and never answers, so the answer is awaited only until `deadline`.
 */
export async function openInPlace(client: Recipient, url: string, deadline: Promise<void>): Promise<boolean> {
  const { port1, port2 } = new MessageChannel();
  const answered = new Promise<boolean>((resolve) => {
    port1.addEventListener('message', ({ data }) => {
      if (isOpened(data)) resolve(true);
    });
    port1.start();
  });
  client.postMessage({ kind: 'open', url }, [port2]);
  try {
    return await Promise.race([answered, deadline.then(() => false)]);
  } finally {
    port1.close();
  }
}
