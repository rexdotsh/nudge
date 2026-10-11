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
import { MINUTE_MS } from '../shared/time';
import { ulid } from '../shared/ulid';
import { isRecord } from '../shared/validate';
import { ApiFailure, DEVICE_REQUESTS, PUBLIC_REQUESTS } from './requests';
import type { Runtime } from './runtime';
import { Scheduler } from './scheduler';
import { Store, deliveryInfo, deviceInfo, type DeviceRow } from './store';
import { issueToken, sameSecret } from './tokens';

export interface Caller {
  deviceId: string | null;
  origin: string;
}

const PAIR_CODE_TTL_MS = 10 * MINUTE_MS;
const LOCKOUT_MS = 15 * MINUTE_MS;
const FAILURE_LIMIT = 10;
const MAX_PENDING_TESTS = 5;
const HEALTH_DELIVERIES = 20;

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
        () => this.store.deviceCount() === 0 && sameSecret(code, this.runtime.secrets.setupCode.toUpperCase()),
      ),
    join: ({ code, device }) => this.enroll(device, () => this.consumePairCode(code)),
  };

  private readonly deviceHandlers: Handlers<DeviceRoutes, DeviceRow> = {
    pair: () => this.issuePairCode(),
    subscribe: (keys, device) => {
      this.store.setSubscription(device.id, keys);
      return null;
    },
    health: () => ({
      devices: this.store.devices().map(deviceInfo),
      deliveries: this.store.recentDeliveries(HEALTH_DELIVERIES).map(deliveryInfo),
    }),
    revoke: ({ id }) => {
      this.store.revokeDevice(id);
      this.runtime.disconnect(id);
      return null;
    },
    test: ({ delay }) => this.scheduleTest(delay),
    receipt: ({ fire }, device) => {
      this.store.receipt(fire, device.id, this.runtime.now());
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
    return this.store.device(deviceId) !== undefined;
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
    const device = deviceId === null ? undefined : this.store.device(deviceId);
    if (!device) throw new ApiFailure('unauthorized');
    return device;
  }

  private recentFailures(now: number): number[] {
    const stored: unknown = JSON.parse(this.store.meta('failures') ?? '[]');
    return Array.isArray(stored)
      ? stored.filter((at): at is number => typeof at === 'number' && now - at < LOCKOUT_MS)
      : [];
  }

  private async enroll(device: DeviceInput, authorized: () => boolean): Promise<Session> {
    const now = this.runtime.now();
    const failures = this.recentFailures(now);
    if (failures.length >= FAILURE_LIMIT) throw new ApiFailure('locked');
    if (!authorized()) {
      this.store.setMeta('failures', JSON.stringify([...failures, now]));
      throw new ApiFailure('forbidden');
    }
    const id = ulid(now);
    this.runtime.transaction(() => {
      this.store.addDevice(id, device, now);
      this.store.setMeta('failures', '[]');
    });
    return { token: await issueToken(this.runtime.secrets.auth, id), deviceId: id };
  }

  private issuePairCode(): { code: string; expiresAt: number } {
    const [random = 0] = crypto.getRandomValues(new Uint32Array(1));
    const code = String(random % 1_000_000).padStart(6, '0');
    const expiresAt = this.runtime.now() + PAIR_CODE_TTL_MS;
    this.store.setMeta('pair', JSON.stringify({ code, expiresAt }));
    return { code, expiresAt };
  }

  private consumePairCode(given: string): boolean {
    const stored: unknown = JSON.parse(this.store.meta('pair') ?? 'null');
    if (!isRecord(stored) || typeof stored.code !== 'string' || typeof stored.expiresAt !== 'number') return false;
    const valid = stored.expiresAt > this.runtime.now() && sameSecret(given, stored.code);
    if (valid) this.store.setMeta('pair', 'null');
    return valid;
  }

  private async scheduleTest(delay: number): Promise<{ at: number }> {
    const at = this.runtime.now() + delay * 1000;
    if (this.store.addProbe(at) > MAX_PENDING_TESTS) throw new ApiFailure('locked');
    await this.scheduler.rearm();
    return { at };
  }

  private async sync({ since, zone, ops }: SyncRequest, device: DeviceRow): Promise<SyncResponse> {
    const now = this.runtime.now();
    const previousZone = this.scheduler.zone();
    let rejected = 0;
    const zoneChanged = this.runtime.transaction(() => {
      this.store.touchDevice(device.id, zone, now);
      const changed = this.scheduler.zone() !== previousZone;
      if (changed) this.scheduler.refloat();
      const clock = { now, zone: this.scheduler.zone() };
      for (const op of ops) {
        const next = applyOp(this.store.reminder(op.id), op, clock);
        if (next) this.scheduler.save(next, now);
        else rejected++;
      }
      return changed;
    });
    const version = this.store.version();
    if (zoneChanged || ops.length > rejected) {
      await this.scheduler.rearm();
      this.runtime.broadcast({ kind: 'changed', version }, device.id);
    }
    const purged = Number(this.store.meta('purged') ?? 0);
    const reset = since < purged || since > version;
    return { version, reminders: this.store.changedSince(reset ? 0 : since), reset, rejected };
  }
}
