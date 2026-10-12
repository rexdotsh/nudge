import {
  isPublicRoute,
  type DeviceInput,
  type DeviceRoute,
  type DeviceRoutes,
  type PublicRoute,
  type PublicRoutes,
  type Reply,
  type Route,
  type Routes,
  type ServerMessage,
  type Session,
  type SyncRequest,
  type SyncResponse,
} from '../shared/api';
import { applyOp } from '../shared/ops';
import { DAY_MS, MINUTE_MS } from '../shared/time';
import { ulid } from '../shared/ulid';
import { isRecord } from '../shared/validate';
import { deviceInfo, type DeviceRow } from './devices';
import { ApiFailure, DEVICE_REQUESTS, PUBLIC_REQUESTS } from './requests';
import type { Runtime } from './runtime';
import { Scheduler } from './scheduler';
import { Store } from './store';
import { digest, issueToken, sameSecret } from './tokens';

export interface Caller {
  deviceId: string | null;
  origin: string;
}

const PAIR_CODE_TTL_MS = 10 * MINUTE_MS;
const LOCKOUT_MS = 15 * MINUTE_MS;
const FAILURE_LIMIT = 10;
const MAX_PENDING_TESTS = 5;
const MAX_BACKDATE_MS = 30 * DAY_MS;

type Handlers<R extends { [K in keyof R]: { request: unknown; response: unknown } }, Context> = {
  [K in keyof R]: (request: R[K]['request'], context: Context) => R[K]['response'] | Promise<R[K]['response']>;
};

export class Nudge {
  private readonly store: Store;
  private readonly scheduler: Scheduler;

  constructor(private readonly runtime: Runtime) {
    this.store = new Store(runtime.sql);
    this.scheduler = new Scheduler(this.store, runtime);
  }

  private readonly publicHandlers: Handlers<PublicRoutes, null> = {
    setup: ({ code, device }) =>
      this.enroll(
        device,
        code,
        () => !this.store.devices.everEnrolled() && sameSecret(code, this.runtime.secrets.setupCode.toUpperCase()),
        () => {},
      ),
    join: ({ code, device }) =>
      this.enroll(
        device,
        code,
        () => this.pairCodeAccepts(code),
        () => this.store.setMeta('pair', 'null'),
      ),
  };

  private readonly deviceHandlers: Handlers<DeviceRoutes, DeviceRow> = {
    pair: () => this.issuePairCode(),
    subscribe: (keys, device) => {
      this.store.devices.subscribe(device.id, keys);
      return null;
    },
    health: () => ({
      devices: this.store.devices.all().map(deviceInfo),
    }),
    revoke: ({ id }) => {
      this.runtime.transaction(() => {
        this.store.devices.revoke(id);
        this.store.deliveries.cancelForDevice(id);
      });
      this.runtime.disconnect(id);
      return null;
    },
    test: ({ id, delay }) => this.scheduleTest(id, delay),
    receipt: ({ fire }, device) => {
      const now = this.runtime.now();
      this.runtime.transaction(() => {
        this.store.deliveries.confirm(fire, device.id, now);
        this.store.devices.confirmed(device.id, now);
      });
      return null;
    },
    sync: (request, device) => this.sync(request, device),
  };

  async call<R extends Route>(route: R, caller: Caller, body: unknown): Promise<Reply<Routes[R]['response']>> {
    try {
      if (this.store.meta('origin') !== caller.origin) this.store.setMeta('origin', caller.origin);
      if (isPublicRoute(route)) return { ok: true, data: await this.callPublic(route, body) };
      return { ok: true, data: await this.callDevice(route, this.requireDevice(caller.deviceId), body) };
    } catch (error) {
      if (error instanceof ApiFailure) return { ok: false, error: error.code };
      throw error;
    }
  }

  canConnect(deviceId: string): boolean {
    return this.store.devices.get(deviceId) !== undefined;
  }

  async message(deviceId: string, text: string): Promise<ServerMessage> {
    let ref = '';
    try {
      const message: unknown = JSON.parse(text);
      if (!isRecord(message) || message.kind !== 'sync' || typeof message.ref !== 'string') {
        throw new ApiFailure('bad_request');
      }
      ref = message.ref.slice(0, 64);
      const response = await this.callDevice('sync', this.requireDevice(deviceId), message);
      return { kind: 'synced', ref, ...response };
    } catch (error) {
      if (error instanceof ApiFailure) return { kind: 'failed', ref, error: error.code };
      if (error instanceof SyntaxError) return { kind: 'failed', ref, error: 'bad_request' };
      throw error;
    }
  }

  alarm(): Promise<void> {
    return this.scheduler.run();
  }

  watchdog(): Promise<{ healthy: boolean }> {
    return this.scheduler.watchdog();
  }

  private async callPublic<R extends PublicRoute>(route: R, body: unknown): Promise<PublicRoutes[R]['response']> {
    return this.publicHandlers[route](PUBLIC_REQUESTS[route](body), null);
  }

  private async callDevice<R extends DeviceRoute>(
    route: R,
    device: DeviceRow,
    body: unknown,
  ): Promise<DeviceRoutes[R]['response']> {
    return this.deviceHandlers[route](DEVICE_REQUESTS[route](body), device);
  }

  private requireDevice(deviceId: string | null): DeviceRow {
    const device = deviceId === null ? undefined : this.store.devices.get(deviceId);
    if (!device) throw new ApiFailure('unauthorized');
    return device;
  }

  private recentFailures(now: number): number[] {
    const stored: unknown = JSON.parse(this.store.meta('failures') ?? '[]');
    return Array.isArray(stored)
      ? stored.filter((at): at is number => typeof at === 'number' && now - at < LOCKOUT_MS)
      : [];
  }

  private async enroll(device: DeviceInput, code: string, fresh: () => boolean, consume: () => void): Promise<Session> {
    const credential = await digest(code);
    const now = this.runtime.now();
    const outcome = this.runtime.transaction((): { id: string } | ApiFailure => {
      const failures = this.recentFailures(now);
      if (failures.length >= FAILURE_LIMIT) return new ApiFailure('locked');
      const replayed = this.store.devices.enrolled(credential, device.key);
      if (replayed) return { id: replayed.id };
      if (!fresh()) {
        this.store.setMeta('failures', JSON.stringify([...failures, now]));
        return new ApiFailure('forbidden');
      }
      consume();
      this.store.setMeta('failures', '[]');
      const existing = this.store.devices.byKey(device.key);
      const id = existing?.id ?? ulid(now);
      if (!existing) {
        this.store.devices.add(id, device, now);
        // Enrolling means typing a code on this device, so the person is wherever it is.
        this.scheduler.setZone(device.zone);
        this.store.setMeta('locale', device.locale);
      }
      this.store.devices.recordEnrollment(credential, device.key, id);
      return { id };
    });
    if (outcome instanceof ApiFailure) throw outcome;
    // Both are idempotent, so a replayed enrollment repairs whatever a failure after the commit left undone.
    await this.scheduler.rearm();
    this.runtime.broadcast({ kind: 'changed', version: this.store.version() }, outcome.id);
    return { token: await issueToken(this.runtime.secrets.auth, outcome.id), deviceId: outcome.id };
  }

  private pairCode(): { code: string; expiresAt: number } | null {
    const stored: unknown = JSON.parse(this.store.meta('pair') ?? 'null');
    if (!isRecord(stored) || typeof stored.code !== 'string' || typeof stored.expiresAt !== 'number') return null;
    return { code: stored.code, expiresAt: stored.expiresAt };
  }

  private issuePairCode(): { code: string; expiresAt: number } {
    const [random = 0] = crypto.getRandomValues(new Uint32Array(1));
    const code = String(random % 1_000_000).padStart(6, '0');
    const expiresAt = this.runtime.now() + PAIR_CODE_TTL_MS;
    this.store.setMeta('pair', JSON.stringify({ code, expiresAt }));
    return { code, expiresAt };
  }

  private pairCodeAccepts(given: string): boolean {
    const pair = this.pairCode();
    return pair !== null && pair.expiresAt > this.runtime.now() && sameSecret(given, pair.code);
  }

  private async scheduleTest(id: string, delay: number): Promise<{ at: number }> {
    const existing = this.store.testRequest(id);
    if (existing !== null) {
      await this.scheduler.rearm();
      return { at: existing };
    }
    if (this.store.deliveries.pendingCount('test:') >= MAX_PENDING_TESTS) throw new ApiFailure('locked');
    const at = this.runtime.now() + delay * 1000;
    this.runtime.transaction(() => {
      this.store.recordTestRequest(id, at);
      this.scheduler.queueTest(`test:${id}`, at);
    });
    await this.scheduler.rearm();
    return { at };
  }

  private async sync({ since, zone, changes, theme }: SyncRequest, device: DeviceRow): Promise<SyncResponse> {
    const now = this.runtime.now();
    const madeAt = (at: number) => Math.min(now, Math.max(at, now - MAX_BACKDATE_MS));
    let applied = 0;
    const zoneChanged = this.runtime.transaction(() => {
      // The instance zone follows the device that last moved, so a device that never left home (a laptop left open)
      // cannot keep flipping it back against the one that travelled.
      const changed = device.zone !== zone && this.scheduler.setZone(zone);
      this.store.devices.touch(device.id, zone, now);
      for (const { opId, op, at } of changes) {
        if (this.store.applied(opId)) continue;
        const previous = this.store.reminder(op.id);
        const next = applyOp(previous, op, { now: madeAt(at), zone });
        if (next) {
          this.scheduler.save(next);
          if (op.type !== 'put' || previous?.due !== next.due) this.store.deliveries.cancelForReminder(op.id);
          applied++;
        }
        this.store.recordApplied(opId, now);
      }
      if (theme && !this.store.applied(theme.id)) {
        if (this.store.chooseTheme(theme.theme, madeAt(theme.at))) applied++;
        this.store.recordApplied(theme.id, now);
      }
      return changed;
    });
    const version = this.store.version();
    await this.scheduler.rearm();
    if (zoneChanged || applied > 0) this.runtime.broadcast({ kind: 'changed', version }, device.id);
    const reset = since > version;
    return { version, reminders: this.store.changedSince(reset ? 0 : since), reset, theme: this.store.theme() };
  }
}
