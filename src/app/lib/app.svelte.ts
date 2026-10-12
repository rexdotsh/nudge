import { ApiRejected, Unreachable, request } from '../../browser/api';
import { get, set, update } from '../../browser/kv';
import { Replica } from '../../browser/replica';
import { EMPTY_LOCAL } from '../../browser/schema';
import { batch } from '../../browser/batch';
import { commit, currentZone, enqueue } from '../../browser/outbox';
import { MAX_REQUEST_BYTES, type Change, type Health } from '../../shared/api';
import { BASE64URL } from '../../shared/encoding';
import type { Op } from '../../shared/ops';
import type { Reminder } from '../../shared/reminder';
import { DAY_MS } from '../../shared/time';
import { Connection } from './connection';
import { ForegroundGate } from './gate';
import { DEVICE_LABELS, detectPlatform } from './platform';
import { enablePush, pushState, syncSubscription, watchPermission, type PushState } from './push';

type Phase = 'loading' | 'enroll' | 'ready' | 'failed';

/** What this foreground's replica is worth: until its first sync attempt settles it can miss what was pushed while away,
 * and after an unreachable one it is only what this device last knew. */
type Freshness = 'catching-up' | 'offline' | 'synced';

const KEEPALIVE_BYTES = 48 * 1024;
const TRAVEL_WINDOW_MS = 7 * DAY_MS;

class App {
  phase = $state<Phase>('loading');
  reminders = $state.raw<Reminder[]>([]);
  online = $state(true);
  now = $state(Date.now());
  zone = $state(currentZone());
  travelling = $state(false);
  /** Whether every reminder offers to keep its time zone, not only while travelling. */
  zoneControls = $state(false);
  notifications = $state<PushState>(pushState());
  freshness = $state<Freshness>('catching-up');
  /** The devices as last fetched, so Settings opens with them in place instead of filling in after a round trip. */
  health = $state.raw<Health | null>(null);
  deviceId = $state<string | null>(null);
  readonly platform = detectPlatform();

  private replica = new Replica();
  private pending: Change[] = [];
  private token: string | null = null;
  private connection: Connection | null = null;
  private inflight: Promise<void> | null = null;
  private again = false;
  private healthRequests = 0;
  private readonly gate = new ForegroundGate(document.visibilityState === 'visible');

  async start(): Promise<void> {
    navigator.serviceWorker?.addEventListener('message', () => void this.reloadLocal().then(() => this.sync()));
    document.addEventListener('visibilitychange', () => this.visibilityChanged());
    watchPermission(() => void this.permissionChanged());
    let session;
    try {
      [session, this.health, this.zoneControls] = await Promise.all([
        get('session'),
        get('health').then((health) => health ?? null),
        get('zoneControls').then((on) => on ?? false),
        this.reloadLocal(),
        this.noteZone(),
      ]);
    } catch (error) {
      console.error('local storage is unavailable', error);
      this.phase = 'failed';
      return;
    }
    this.deviceId = session?.deviceId ?? null;
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
    this.deviceId = session.deviceId;
    this.phase = 'ready';
    this.connect(session.token);
    this.refreshDevices();
  }

  private refreshDevices(): void {
    void this.refreshHealth().catch((error: unknown) => {
      if (!(error instanceof Unreachable)) throw error;
      console.warn('devices not fetched yet; Settings will fetch them', error);
    });
  }

  /** Only the latest request may publish, so an older reply cannot bring back a device revoked since it was sent. */
  async refreshHealth(): Promise<void> {
    const asked = ++this.healthRequests;
    const health = await request('health', null);
    if (asked !== this.healthRequests) return;
    this.health = health;
    await set('health', health);
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
    const settled = (outcome: Exclude<Freshness, 'catching-up'>) => {
      if (current() && this.freshness !== 'synced') this.freshness = outcome;
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
      settled('synced');
      if (local.pending.length > 0) this.again = true;
    } catch (error) {
      if (error instanceof Unreachable) {
        this.online = false;
        settled('offline');
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
    this.freshness = 'catching-up';
    if (this.pending.length > 0 && this.token) {
      void request(
        'sync',
        { since: this.replica.version, zone: this.zone, changes: batch(this.pending, KEEPALIVE_BYTES) },
        { keepalive: true, token: this.token },
      ).catch((error: unknown) => console.warn('flush on hide failed; it will be replayed on open', error));
    }
  }

  /** Allowed outside the app counts as on only once this device is subscribed. Safari subscribes only from a tap, so
   * if that fails here, Settings keeps its Turn on button to finish it. */
  private async permissionChanged(): Promise<void> {
    const state = pushState();
    if (state !== 'enabled' || this.notifications === 'enabled') {
      this.notifications = state;
      return;
    }
    try {
      await syncSubscription();
    } catch (error) {
      console.warn('subscribing needs a tap on this browser', error);
      this.notifications = 'prompt';
      return;
    }
    this.notifications = 'enabled';
    this.refreshDevices();
  }

  async showZoneControls(on: boolean): Promise<void> {
    this.zoneControls = on;
    await set('zoneControls', on);
  }

  async enableNotifications(): Promise<PushState> {
    this.notifications = await enablePush();
    if (this.notifications === 'enabled') this.refreshDevices();
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
