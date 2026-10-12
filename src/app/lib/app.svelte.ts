import { ApiRejected, Unreachable, request } from '../../browser/api';
import { get, set, update } from '../../browser/kv';
import { Replica } from '../../browser/replica';
import { EMPTY_LOCAL } from '../../browser/schema';
import { batch } from '../../browser/batch';
import { commit, currentZone, enqueue } from '../../browser/outbox';
import { MAX_REQUEST_BYTES, type Change } from '../../shared/api';
import { BASE64URL } from '../../shared/encoding';
import type { Op } from '../../shared/ops';
import type { Reminder } from '../../shared/reminder';
import { DAY_MS } from '../../shared/time';
import { Connection } from './connection';
import { ForegroundGate } from './gate';
import { DEVICE_LABELS, detectPlatform } from './platform';
import { enablePush, pushState, syncSubscription, type PushState } from './push';

type Phase = 'loading' | 'enroll' | 'ready' | 'failed';

const KEEPALIVE_BYTES = 48 * 1024;
const TRAVEL_WINDOW_MS = 7 * DAY_MS;

class App {
  phase = $state<Phase>('loading');
  reminders = $state<Reminder[]>([]);
  online = $state(true);
  now = $state(Date.now());
  zone = $state(currentZone());
  travelling = $state(false);
  notifications = $state<PushState>(pushState());
  /** Until the first sync attempt of this foreground settles, the replica can miss what was pushed while away. */
  caughtUp = $state(false);
  readonly platform = detectPlatform();

  private replica = new Replica();
  private pending: Change[] = [];
  private token: string | null = null;
  private connection: Connection | null = null;
  private inflight: Promise<void> | null = null;
  private again = false;
  private readonly gate = new ForegroundGate(document.visibilityState === 'visible');

  async start(): Promise<void> {
    navigator.serviceWorker?.addEventListener('message', () => void this.reloadLocal().then(() => this.sync()));
    document.addEventListener('visibilitychange', () => this.visibilityChanged());
    let session;
    try {
      [session] = await Promise.all([get('session'), this.reloadLocal(), this.noteZone()]);
    } catch (error) {
      console.error('local storage is unavailable', error);
      this.phase = 'failed';
      return;
    }
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
    await this.applyAll([op]);
    return this.reminders.find((reminder) => reminder.id === op.id);
  }

  async applyAll(ops: readonly Op[]): Promise<void> {
    this.pending = [...this.pending, ...(await enqueue(ops))];
    this.refresh();
    void this.sync();
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
    const current = this.gate.attempt();
    const settled = () => {
      if (current()) this.caughtUp = true;
    };
    const sent = batch(this.pending, MAX_REQUEST_BYTES);
    this.zone = currentZone();
    try {
      const response = await this.connection.sync({
        since: this.replica.version,
        zone: this.zone,
        changes: sent,
      });
      this.replica.receive(response);
      const local = await commit(this.replica.snapshot(), new Set(sent.map((change) => change.opId)));
      this.replica = new Replica(local.replica);
      this.pending = local.pending;
      this.online = true;
      settled();
      if (local.pending.length > 0) this.again = true;
    } catch (error) {
      if (error instanceof Unreachable) {
        this.online = false;
        settled();
      } else if (error instanceof ApiRejected && error.code === 'unauthorized') this.phase = 'enroll';
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
    void this.sync();
    void syncSubscription();
  }

  private visibilityChanged(): void {
    this.gate.changed(document.visibilityState === 'visible');
    if (document.visibilityState === 'visible') {
      this.notifications = pushState();
      void this.noteZone();
      this.connection?.open();
      void this.reloadLocal().then(() => this.sync());
      void syncSubscription();
      return;
    }
    this.caughtUp = false;
    if (this.pending.length > 0 && this.token) {
      void request(
        'sync',
        { since: this.replica.version, zone: this.zone, changes: batch(this.pending, KEEPALIVE_BYTES) },
        { keepalive: true, token: this.token },
      ).catch((error: unknown) => console.warn('flush on hide failed; it will be replayed on open', error));
    }
  }

  async enableNotifications(): Promise<PushState> {
    this.notifications = await enablePush();
    return this.notifications;
  }

  private async noteZone(): Promise<void> {
    const name = currentZone();
    this.zone = name;
    const seen = await update('zone', (previous) =>
      previous?.name === name ? previous : { name, since: previous ? Date.now() : 0 },
    );
    this.travelling = seen.since > 0 && Date.now() - seen.since < TRAVEL_WINDOW_MS;
  }

  private async reloadLocal(): Promise<void> {
    const local = (await get('local')) ?? EMPTY_LOCAL;
    this.replica = new Replica(local.replica);
    this.pending = local.pending;
    this.refresh();
  }

  private refresh(): void {
    this.reminders = this.replica.view(this.pending, this.zone);
  }
}

export const app = new App();
