import { Database } from 'bun:sqlite';
import { pushOutcome } from 'declarative-web-push/server';
import type { DeviceInput, PushKeys, Route, ServerMessage } from '../src/shared/api';
import { BASE64URL } from '../src/shared/encoding';
import type { PushMessage } from '../src/shared/notification';
import type { Op } from '../src/shared/ops';
import type { ReminderFields } from '../src/shared/reminder';
import { ulid } from '../src/shared/ulid';
import { Nudge } from '../src/worker/nudge';
import type { Runtime } from '../src/worker/runtime';
import type { SqlValue } from '../src/worker/sql';

export const ORIGIN = 'https://nudge.example';
export const ZONE = 'Asia/Kolkata';
export const SETUP_CODE = 'CORRECT-HORSE';
export const AUTH = 'auth-secret';

export const device = (label: string, key = crypto.randomUUID().replaceAll('-', '')): DeviceInput => ({
  key,
  label,
  platform: 'ios',
  zone: ZONE,
  locale: 'en-IN',
});

export type PushService = 'apple' | 'fcm';
export const keys = (seed: number, service: PushService = 'fcm') => ({
  endpoint: `https://${service === 'apple' ? 'web.push.apple.com' : 'fcm.googleapis.com'}/device-${seed}`,
  p256dh: new Uint8Array(65).fill(seed).toBase64(BASE64URL),
  auth: new Uint8Array(16).fill(seed).toBase64(BASE64URL),
});

export const fields = (overrides: Partial<ReminderFields> = {}): ReminderFields => ({
  title: 'Pay rent',
  notes: '',
  start: '2026-10-12T09:00',
  zone: null,
  repeat: null,
  important: false,
  alerts: [],
  ...overrides,
});

export type Pushed = { endpoint: string; message: PushMessage; topic: string | undefined };

export function harness() {
  const db = new Database(':memory:');
  const state = {
    now: Date.UTC(2026, 9, 12, 2, 0),
    alarm: null as number | null,
    status: (_target: PushKeys, _attempt: number): number => 201,
    onPush: (_target: PushKeys): void => {},
    held: null as ((status: number) => void) | null,
    holdNext: false,
    failTransactions: 0,
    failAlarm: false,
    failAlerts: false,
    pushes: [] as Pushed[],
    alerts: [] as string[],
    broadcasts: [] as { message: ServerMessage; except: string | undefined }[],
  };
  const attempts = new Map<string, number>();
  const runtime: Runtime = {
    sql: {
      exec<T extends Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]) {
        const rows = db.query<T, SqlValue[]>(query).all(...bindings);
        return { toArray: () => rows };
      },
    },
    transaction: (run) => {
      if (state.failTransactions > 0 && --state.failTransactions === 0) throw new Error('storage unavailable');
      return db.transaction(run)();
    },
    alarm: {
      get: async () => {
        if (state.failAlarm) throw new Error('alarm unavailable');
        return state.alarm;
      },
      set: async (at) => {
        state.alarm = at;
      },
      clear: async () => {
        state.alarm = null;
      },
    },
    broadcast: (message, except) => {
      state.broadcasts.push({ message, except });
    },
    disconnect: () => {},
    push: async (target, json, _subject, options) => {
      const attempt = (attempts.get(target.endpoint) ?? 0) + 1;
      attempts.set(target.endpoint, attempt);
      state.onPush(target);
      const message: PushMessage = JSON.parse(json);
      state.pushes.push({ endpoint: target.endpoint, message, topic: options.topic });
      if (state.holdNext) {
        state.holdNext = false;
        const status = await new Promise<number>((resolve) => (state.held = resolve));
        return { status, outcome: pushOutcome(status), detail: '' };
      }
      const status = state.status(target, attempt);
      return { status, outcome: pushOutcome(status), detail: '' };
    },
    alert: async (text) => {
      if (state.failAlerts) throw new Error('telegram down');
      state.alerts.push(text);
    },
    sleep: async () => {},
    now: () => state.now,
    secrets: { auth: AUTH, setupCode: SETUP_CODE },
  };
  let nudge = new Nudge(runtime);
  // A Durable Object evicted and started again on the same storage.
  const restart = () => {
    nudge = new Nudge(runtime);
  };

  const call = <R extends Route>(route: R, body: unknown, deviceId: string | null = null) =>
    nudge.call(route, { deviceId, origin: ORIGIN }, body);

  async function ok<R extends Route>(route: R, body: unknown, deviceId: string | null = null) {
    const result = await call(route, body, deviceId);
    if (!result.ok) throw new Error(`${route} failed with ${result.error}`);
    return result.data;
  }

  const sync = (deviceId: string, ops: Op[], zone = ZONE) =>
    ok('sync', { since: 0, zone, changes: ops.map((op) => ({ opId: ulid(), op, at: state.now })) }, deviceId);

  async function put(deviceId: string, overrides: Partial<ReminderFields> = {}) {
    const id = ulid(state.now);
    await sync(deviceId, [{ type: 'put', id, fields: fields(overrides) }]);
    return id;
  }

  async function runAlarm() {
    if (state.alarm === null) throw new Error('no alarm set');
    state.now = state.alarm;
    await nudge.alarm();
  }

  async function runAlarmsThrough(until: number, arrived: (pushes: Pushed[]) => Promise<unknown> = async () => {}) {
    if (state.alarm === null || state.alarm > until) return;
    const sent = state.pushes.length;
    await runAlarm();
    await arrived(state.pushes.slice(sent));
    await runAlarmsThrough(until, arrived);
  }

  async function pair(firstService: PushService = 'fcm', secondService: PushService = 'fcm') {
    const first = await ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    const { code } = await ok('pair', null, first.deviceId);
    const second = await ok('join', { code, device: device('Windows PC') });
    await ok('subscribe', keys(1, firstService), first.deviceId);
    await ok('subscribe', keys(2, secondService), second.deviceId);
    return { phone: first.deviceId, laptop: second.deviceId };
  }

  const sentTo = (seed: number, service: PushService = 'fcm') =>
    state.pushes.filter((push) => push.endpoint === keys(seed, service).endpoint).length;

  return {
    db,
    get nudge() {
      return nudge;
    },
    restart,
    state,
    attempts,
    call,
    ok,
    sync,
    put,
    runAlarm,
    runAlarmsThrough,
    pair,
    sentTo,
  };
}
