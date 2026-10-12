import { ApiRejected, Unreachable, request } from '../../browser/api';
import { get, set, update } from '../../browser/kv';
import { Replica } from '../../browser/replica';
import { EMPTY_LOCAL, type Local } from '../../browser/schema';
import { batch } from '../../browser/batch';
import { isWorkerMessage } from '../../browser/messages';
import { commit, currentZone, enqueue } from '../../browser/outbox';
import { MAX_REQUEST_BYTES, type Change, type Health, type Theme } from '../../shared/api';
import { BASE64URL } from '../../shared/encoding';
import type { Op } from '../../shared/ops';
import type { Reminder } from '../../shared/reminder';
import { DAY_MS } from '../../shared/time';
import { Connection } from './connection';
import { ForegroundGate } from './gate';
import { DEVICE_LABELS, detectPlatform } from './platform';
import { enablePush, pushState, syncSubscription, watchPermission, type PushState } from './push';
import { appearance } from './theme.svelte';

type Phase = 'loading' | 'enroll' | 'ready' | 'failed';

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
  zoneControls = $state(false);
  notifications = $state<PushState>(pushState());
  freshness = $state<Freshness>('catching-up');
  health = $state.raw<Health | null>(null);
  deviceId = $state<string | null>(null);
  readonly platform = detectPlatform();

  private replica = new Replica();
  private pending: Change[] = [];
  private token: string | null = null;
  private connection: Connection | null = null;
  private connected: () => void = () => {};
  private inflight: Promise<void> | null = null;
  private again = false;
  private healthRequests = 0;
  private readonly gate = new ForegroundGate(document.visibilityState === 'visible');

  async start(connected: () => void): Promise<void> {
    this.connected = connected;
    navigator.serviceWorker?.addEventListener('message', ({ data }) => {
      if (isWorkerMessage(data) && data.kind === 'changed') void this.reloadLocal().then(() => this.sync());
    });
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
        appearance.load(),
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
    this.show(await enqueue(ops));
    void this.sync();
  }

  async chooseTheme(theme: Theme): Promise<void> {
    await appearance.choose(theme);
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
    const connection = this.connection;
    if (!connection) return;
    const current = this.gate.attempt();
    const settled = (outcome: Exclude<Freshness, 'catching-up'>) => {
      if (current() && this.freshness !== 'synced') this.freshness = outcome;
    };
    const sent = batch(this.pending, MAX_REQUEST_BYTES);
    const since = this.replica.version;
    const theme = appearance.pending;
    this.zone = currentZone();
    this.refresh();
    try {
      const response = await connection.sync({
        since,
        zone: this.zone,
        changes: sent,
        theme,
      });
      if (this.connection !== connection) return;
      await Promise.all([
        commit(response, since, new Set(sent.map((change) => change.opId))).then((local) => {
          if (local.pending.length > 0) this.again = true;
          return this.show(local);
        }),
        appearance.receive(response, theme),
      ]);
      this.online = true;
      settled('synced');
    } catch (error) {
      if (this.connection !== connection) return;
      if (error instanceof Unreachable) {
        this.online = false;
        settled('offline');
      } else if (error instanceof ApiRejected && error.code === 'unauthorized') this.phase = 'enroll';
      else throw error;
    }
  }

  private connect(token: string): void {
    this.connection?.close();
    this.token = token;
    this.connection = new Connection(
      token,
      (version) => {
        if (version > this.replica.version) void this.sync();
      },
      () => {
        this.connected();
        void this.sync();
      },
    );
    this.connection.open();
    void this.sync();
    void this.permissionChanged();
  }

  private visibilityChanged(): void {
    this.gate.changed(document.visibilityState === 'visible');
    if (document.visibilityState === 'visible') {
      void this.noteZone();
      this.connection?.open();
      void this.reloadLocal().then(() => this.sync());
      void this.permissionChanged();
      return;
    }
    this.freshness = 'catching-up';
    if ((this.pending.length > 0 || appearance.pending) && this.token) {
      void request(
        'sync',
        {
          since: this.replica.version,
          zone: this.zone,
          changes: batch(this.pending, KEEPALIVE_BYTES),
          theme: appearance.pending,
        },
        { keepalive: true, token: this.token },
      ).catch((error: unknown) => console.warn('flush on hide failed; it will be replayed on open', error));
    }
  }

  private async permissionChanged(): Promise<void> {
    const state = pushState();
    if (state !== 'enabled' || this.phase !== 'ready') {
      this.notifications = state;
      return;
    }
    const enabled = this.notifications === 'enabled';
    try {
      await syncSubscription();
    } catch (error) {
      console.warn('subscribing needs a tap on this browser', error);
      this.notifications = pushState() === 'enabled' ? 'prompt' : pushState();
      return;
    }
    this.notifications = pushState();
    if (!enabled && this.notifications === 'enabled') this.refreshDevices();
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
    this.show((await get('local')) ?? EMPTY_LOCAL);
  }

  private show(local: Local): void {
    this.replica = new Replica(local.replica);
    this.pending = local.pending;
    this.refresh();
  }

  private refresh(): void {
    this.reminders = this.replica.view(this.pending, this.zone);
  }
}

export const app = new App();
