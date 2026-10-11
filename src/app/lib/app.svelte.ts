import { ApiRejected, Unreachable, request } from '../../browser/api';
import { get, set, update } from '../../browser/kv';
import type { PendingChange } from '../../browser/schema';
import { acknowledge, currentZone, enqueue, wire } from '../../browser/outbox';
import { MAX_CHANGES, type Change } from '../../shared/api';
import { BASE64URL, utf8 } from '../../shared/encoding';
import type { Op } from '../../shared/ops';
import type { Reminder } from '../../shared/reminder';
import { DAY_MS } from '../../shared/time';
import { Connection } from './connection';
import { DEVICE_LABELS, detectPlatform } from './platform';
import { syncSubscription } from './push';
import { Replica } from './replica';

export type Phase = 'loading' | 'enroll' | 'ready';

const KEEPALIVE_BYTES = 48 * 1024;
const TRAVEL_WINDOW_MS = 7 * DAY_MS;

function withinKeepalive(pending: readonly PendingChange[]): Change[] {
  const batch: Change[] = [];
  let bytes = 0;
  for (const change of wire(pending.slice(0, MAX_CHANGES))) {
    bytes += utf8(JSON.stringify(change)).length + 1;
    if (bytes > KEEPALIVE_BYTES) break;
    batch.push(change);
  }
  return batch;
}

class App {
  phase = $state<Phase>('loading');
  reminders = $state<Reminder[]>([]);
  online = $state(true);
  pendingCount = $state(0);
  now = $state(Date.now());
  zone = currentZone();
  travelling = $state(false);
  readonly platform = detectPlatform();

  private replica = new Replica();
  private pending: PendingChange[] = [];
  private token: string | null = null;
  private connection: Connection | null = null;
  private inflight: Promise<void> | null = null;
  private again = false;

  async start(): Promise<void> {
    navigator.serviceWorker?.addEventListener('message', () => void this.reloadPending().then(() => this.sync()));
    document.addEventListener('visibilitychange', () => this.visibilityChanged());
    const [session, snapshot, pending] = await Promise.all([
      get('session'),
      get('replica'),
      get('pending'),
      this.noteZone(),
    ]);
    this.replica = new Replica(snapshot);
    this.pending = pending ?? [];
    this.refresh();
    this.phase = session ? 'ready' : 'enroll';
    if (session) this.connect(session.token);
    setInterval(() => {
      this.now = Date.now();
    }, 30_000);
  }

  async enroll(kind: 'setup' | 'join', code: string): Promise<void> {
    const key = (await get('installKey')) ?? crypto.getRandomValues(new Uint8Array(16)).toBase64(BASE64URL);
    await set('installKey', key);
    const session = await request(kind, {
      code,
      device: {
        key,
        label: DEVICE_LABELS[this.platform],
        platform: this.platform,
        zone: this.zone,
        locale: navigator.language,
      },
    });
    await set('session', session);
    this.phase = 'ready';
    this.connect(session.token);
  }

  async apply(op: Op): Promise<Reminder | undefined> {
    this.pending = [...this.pending, await enqueue(op)];
    this.refresh();
    void this.sync();
    return this.reminders.find((reminder) => reminder.id === op.id);
  }

  sync(): Promise<void> {
    if (this.inflight) {
      this.again = true;
      return this.inflight;
    }
    this.inflight = this.exchange().finally(() => {
      this.inflight = null;
      if (this.again) {
        this.again = false;
        void this.sync();
      }
    });
    return this.inflight;
  }

  private async exchange(): Promise<void> {
    if (!this.connection) return;
    const sent = this.pending.slice(0, MAX_CHANGES);
    this.zone = currentZone();
    try {
      const response = await this.connection.sync({
        since: this.replica.version,
        zone: this.zone,
        changes: wire(sent),
      });
      this.replica.receive(response);
      const remaining = await acknowledge(new Set(sent.map((change) => change.opId)));
      await set('replica', this.replica.snapshot());
      this.pending = remaining;
      this.online = true;
      if (remaining.length > 0) this.again = true;
    } catch (error) {
      if (error instanceof Unreachable) this.online = false;
      else if (error instanceof ApiRejected && error.code === 'unauthorized') this.phase = 'enroll';
      else throw error;
    } finally {
      this.refresh();
    }
  }

  private connect(token: string): void {
    this.token = token;
    this.connection = new Connection(
      token,
      (version) => {
        if (version > this.replica.version) void this.sync();
      },
      () => void this.sync(),
    );
    this.connection.open();
    void syncSubscription();
  }

  private visibilityChanged(): void {
    if (document.visibilityState === 'visible') {
      void this.noteZone();
      this.connection?.resume();
      void this.reloadPending().then(() => this.sync());
      void syncSubscription();
    } else if (this.pending.length > 0 && this.token) {
      void request(
        'sync',
        { since: this.replica.version, zone: this.zone, changes: withinKeepalive(this.pending) },
        { keepalive: true, token: this.token },
      ).catch((error: unknown) => console.warn('flush on hide failed; it will be replayed on open', error));
    }
  }

  private async noteZone(): Promise<void> {
    const name = currentZone();
    this.zone = name;
    const seen = await update('zone', (previous) =>
      previous?.name === name ? previous : { name, since: previous ? Date.now() : 0 },
    );
    this.travelling = seen.since > 0 && Date.now() - seen.since < TRAVEL_WINDOW_MS;
  }

  private async reloadPending(): Promise<void> {
    this.pending = (await get('pending')) ?? [];
    this.refresh();
  }

  private refresh(): void {
    this.reminders = this.replica.view(this.pending, this.zone);
    this.pendingCount = this.pending.length;
  }
}

export const app = new App();
