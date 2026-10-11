import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import type { DeviceInput, Route, ServerMessage } from '../src/shared/api';
import { BASE64URL } from '../src/shared/encoding';
import type { PushMessage } from '../src/shared/notification';
import type { Op } from '../src/shared/ops';
import type { ReminderFields } from '../src/shared/reminder';
import { MINUTE_MS } from '../src/shared/time';
import { ulid } from '../src/shared/ulid';
import { Nudge } from '../src/worker/nudge';
import type { Runtime } from '../src/worker/runtime';
import { DEAD_MAN_MS, ESCALATE_AFTER_MS, LEASE_MS, RESEND_AFTER_MS } from '../src/worker/scheduler';
import type { SqlValue } from '../src/worker/store';
import { verifyToken } from '../src/worker/tokens';
import type { PushTarget } from '../src/worker/webpush';

const ORIGIN = 'https://nudge.example';
const ZONE = 'Asia/Kolkata';
const SETUP_CODE = 'CORRECT-HORSE';
const AUTH = 'auth-secret';
const DUE = Date.UTC(2026, 9, 12, 3, 30);

const device = (label: string, key = crypto.randomUUID().replaceAll('-', '')): DeviceInput => ({
  key,
  label,
  platform: 'ios',
  zone: ZONE,
  locale: 'en-IN',
});

const keys = (seed: number) => ({
  endpoint: `https://web.push.apple.com/device-${seed}`,
  p256dh: new Uint8Array(65).fill(seed).toBase64(BASE64URL),
  auth: new Uint8Array(16).fill(seed).toBase64(BASE64URL),
});

const fields = (overrides: Partial<ReminderFields> = {}): ReminderFields => ({
  title: 'Pay rent',
  notes: '',
  start: '2026-10-12T09:00',
  zone: null,
  repeat: null,
  important: false,
  alerts: [],
  ...overrides,
});

function harness() {
  const db = new Database(':memory:');
  const state = {
    now: Date.UTC(2026, 9, 12, 2, 0),
    alarm: null as number | null,
    status: (_target: PushTarget, _attempt: number): number => 201,
    onPush: (_target: PushTarget): void => {},
    held: null as ((status: number) => void) | null,
    holdNext: false,
    failTransactions: 0,
    failAlerts: false,
    pushes: [] as { endpoint: string; message: PushMessage; topic: string }[],
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
      get: async () => state.alarm,
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
        return { status: await new Promise<number>((resolve) => (state.held = resolve)), detail: '' };
      }
      return { status: state.status(target, attempt), detail: '' };
    },
    alert: async (text) => {
      if (state.failAlerts) throw new Error('telegram down');
      state.alerts.push(text);
    },
    sleep: async () => {},
    now: () => state.now,
    secrets: { auth: AUTH, setupCode: SETUP_CODE },
  };
  const nudge = new Nudge(runtime);

  const call = <R extends Route>(route: R, body: unknown, deviceId: string | null = null) =>
    nudge.call(route, { deviceId, origin: ORIGIN }, body);

  async function ok<R extends Route>(route: R, body: unknown, deviceId: string | null = null) {
    const result = await call(route, body, deviceId);
    if (!result.ok) throw new Error(`${route} failed with ${result.error}`);
    return result.data;
  }

  const sync = (deviceId: string, ops: Op[], zone = ZONE) =>
    ok('sync', { since: 0, zone, changes: ops.map((op) => ({ opId: ulid(), op })) }, deviceId);

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

  async function pair() {
    const first = await ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    const { code } = await ok('pair', null, first.deviceId);
    const second = await ok('join', { code, device: device('Windows PC') });
    await ok('subscribe', keys(1), first.deviceId);
    await ok('subscribe', keys(2), second.deviceId);
    return { phone: first.deviceId, laptop: second.deviceId };
  }

  const sentTo = (seed: number) => state.pushes.filter((push) => push.endpoint === keys(seed).endpoint).length;

  return { nudge, state, attempts, call, ok, sync, put, runAlarm, pair, sentTo };
}

let h: ReturnType<typeof harness>;
beforeEach(() => {
  h = harness();
});

describe('enrollment', () => {
  test('setup needs the code, works once, and is safe to retry with the same install key', async () => {
    const phone = device('iPhone');
    expect(await h.call('setup', { code: 'NOPE', device: phone })).toEqual({ ok: false, error: 'forbidden' });
    const first = await h.ok('setup', { code: SETUP_CODE, device: phone });
    expect(await verifyToken(AUTH, first.token)).toBe(first.deviceId);
    expect((await h.ok('setup', { code: SETUP_CODE, device: phone })).deviceId).toBe(first.deviceId);
    expect(await h.call('setup', { code: SETUP_CODE, device: device('Intruder') })).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  test('pair codes are single-use and short-lived; a join can be retried by the device that used it', async () => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    const { code } = await h.ok('pair', null, deviceId);
    const laptop = device('Windows PC');
    const joined = await h.ok('join', { code, device: laptop });
    await h.ok('pair', null, deviceId);
    expect((await h.ok('join', { code, device: laptop })).deviceId).toBe(joined.deviceId);
    expect(await h.call('join', { code, device: device('Intruder') })).toEqual({ ok: false, error: 'forbidden' });

    const late = await h.ok('pair', null, deviceId);
    h.state.now += 11 * MINUTE_MS;
    expect(await h.call('join', { code: late.code, device: device('Late') })).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });

  test('a fresh code used by an already-enrolled install is consumed, and its retry still works', async () => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    const laptop = device('Windows PC');
    const joined = await h.ok('join', { code: (await h.ok('pair', null, deviceId)).code, device: laptop });
    const { code } = await h.ok('pair', null, deviceId);
    await h.ok('join', { code, device: laptop });
    await h.ok('pair', null, deviceId);
    expect((await h.ok('join', { code, device: laptop })).deviceId).toBe(joined.deviceId);
    expect(await h.call('join', { code, device: device('Someone else') })).toEqual({ ok: false, error: 'forbidden' });
  });

  test('a revoked install can enroll again as a new device', async () => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    const laptop = device('Windows PC');
    const first = await h.ok('join', { code: (await h.ok('pair', null, deviceId)).code, device: laptop });
    await h.ok('revoke', { id: first.deviceId }, deviceId);
    const again = await h.ok('join', { code: (await h.ok('pair', null, deviceId)).code, device: laptop });
    expect(again.deviceId).not.toBe(first.deviceId);
  });

  test('ten failures lock enrollment for fifteen minutes', async () => {
    await Promise.all(Array.from({ length: 10 }, () => h.call('setup', { code: 'GUESS', device: device('x') })));
    expect(await h.call('setup', { code: SETUP_CODE, device: device('iPhone') })).toEqual({
      ok: false,
      error: 'locked',
    });
    h.state.now += 16 * MINUTE_MS;
    expect((await h.call('setup', { code: SETUP_CODE, device: device('iPhone') })).ok).toBe(true);
  });

  test('revoked devices and malformed requests are rejected', async () => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    const malformed = [
      ['subscribe', { endpoint: 'https://evil.example/x', p256dh: 'a', auth: 'b' }],
      ['sync', { since: 0, zone: ZONE, changes: [{ opId: ulid(), op: { type: 'complete' } }] }],
      ['sync', { since: 0, zone: ZONE, changes: [{ opId: 'not-an-id', op: { type: 'delete', id: ulid() } }] }],
      ['test', { id: ulid(), delay: 99_999 }],
    ] as const;
    const results = await Promise.all(malformed.map(([route, body]) => h.call(route, body, deviceId)));
    expect(results.every((result) => !result.ok && result.error === 'bad_request')).toBe(true);
    await h.ok('revoke', { id: deviceId }, deviceId);
    expect(await h.call('health', null, deviceId)).toEqual({ ok: false, error: 'unauthorized' });
  });
});

describe('sync', () => {
  test('a replayed change never overwrites a newer edit', async () => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    const id = ulid();
    const first = { opId: ulid(), op: { type: 'put', id, fields: fields({ title: 'Old' }) } };
    await h.ok('sync', { since: 0, zone: ZONE, changes: [first] }, deviceId);
    await h.sync(deviceId, [{ type: 'put', id, fields: fields({ title: 'New' }) }]);
    h.state.now += 90 * 24 * 60 * MINUTE_MS;
    await h.nudge.watchdog();
    const replay = await h.ok('sync', { since: 0, zone: ZONE, changes: [first] }, deviceId);
    expect(replay.reminders.find((r) => r.id === id)?.title).toBe('New');
  });

  test('returns only newer changes, and resets a client that is ahead', async () => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.put(deviceId);
    const second = await h.put(deviceId, { title: 'Second' });
    const delta = await h.ok('sync', { since: 1, zone: ZONE, changes: [] }, deviceId);
    expect(delta.reminders.map((r) => r.id)).toEqual([second]);
    const ahead = await h.ok('sync', { since: 99, zone: ZONE, changes: [] }, deviceId);
    expect({ reset: ahead.reset, count: ahead.reminders.length }).toEqual({ reset: true, count: 2 });
  });

  test('travelling re-times floating reminders but not pinned ones', async () => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.put(deviceId);
    await h.put(deviceId, { zone: ZONE, start: '2026-10-12T10:00' });
    expect(h.state.alarm).toBe(DUE);
    await h.sync(deviceId, [], 'Europe/Paris');
    expect(h.state.alarm).toBe(Date.UTC(2026, 9, 12, 4, 30));
  });

  test('socket messages run the same sync and echo their ref', async () => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    const message = { kind: 'sync', ref: 'r1', since: 0, zone: ZONE, changes: [] };
    expect(await h.nudge.message(deviceId, JSON.stringify(message))).toMatchObject({ kind: 'synced', ref: 'r1' });
    expect(await h.nudge.message(deviceId, '{oops')).toEqual({ kind: 'failed', ref: '', error: 'bad_request' });
    expect(await h.nudge.message('ghost', JSON.stringify(message))).toMatchObject({
      kind: 'failed',
      error: 'unauthorized',
    });
  });
});

describe('delivery', () => {
  test('a due reminder reaches every device as a declarative notification for that occurrence', async () => {
    const { phone } = await h.pair();
    const id = await h.put(phone, { notes: 'Transfer before noon' });
    await h.runAlarm();
    expect([h.sentTo(1), h.sentTo(2)]).toEqual([1, 1]);
    expect(h.state.pushes[0]?.message).toMatchObject({
      web_push: 8030,
      mutable: true,
      notification: { tag: `${id}:2026-10-12T09:00`, navigate: `${ORIGIN}/?open=${id}`, app_badge: '1' },
    });
    expect(h.state.pushes[0]?.topic.length).toBeLessThanOrEqual(32);
  });

  test('receipts stop resends; a silent device gets one resend, then an alert', async () => {
    const { phone } = await h.pair();
    await h.put(phone);
    await h.runAlarm();
    await h.ok('receipt', { fire: h.state.pushes[0]?.message.notification.data.fire }, phone);
    expect(h.state.alarm).toBe(DUE + RESEND_AFTER_MS);
    await h.runAlarm();
    expect([h.sentTo(1), h.sentTo(2)]).toEqual([1, 2]);
    expect(h.state.alarm).toBe(h.state.now + ESCALATE_AFTER_MS);
    await h.runAlarm();
    expect(h.state.alerts).toHaveLength(1);
    expect(h.state.alarm).toBeNull();
  });

  test('an escalation whose alert could not be delivered is retried until it is', async () => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.ok('subscribe', keys(1), deviceId);
    await h.put(deviceId);
    await h.runAlarm();
    await h.runAlarm();
    h.state.failAlerts = true;
    await h.runAlarm();
    expect(h.state.alerts).toHaveLength(0);
    expect(h.state.alarm).not.toBeNull();
    h.state.failAlerts = false;
    await h.runAlarm();
    expect(h.state.alerts).toHaveLength(1);
    expect(h.state.alarm).toBeNull();
  });

  test('a receipt that lands while an escalation alert is failing ends the work', async () => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.ok('subscribe', keys(1), deviceId);
    await h.put(deviceId);
    await h.runAlarm();
    await h.runAlarm();
    h.state.failAlerts = true;
    const fire = h.state.pushes[0]?.message.notification.data.fire;
    const escalating = h.runAlarm();
    await h.ok('receipt', { fire }, deviceId);
    await escalating;
    expect(h.state.alarm).toBeNull();
  });

  test('a push that outlives its lease cannot undo the retry that replaced it', async () => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.ok('subscribe', keys(1), deviceId);
    await h.put(deviceId);
    h.state.holdNext = true;
    h.state.now = DUE;
    const stalled = h.nudge.alarm();
    h.state.now = DUE + LEASE_MS + MINUTE_MS;
    await h.nudge.watchdog();
    expect(h.sentTo(1)).toBe(2);
    h.state.held?.(410);
    await stalled;
    const health = await h.ok('health', null, deviceId);
    expect(health.devices[0]?.push.enabled).toBe(true);
    expect(h.state.alarm).toBe(DUE + LEASE_MS + MINUTE_MS + RESEND_AFTER_MS);
  });

  test('a crash after claiming a delivery resends it once the lease runs out', async () => {
    const { phone } = await h.pair();
    await h.put(phone);
    h.state.failTransactions = 3;
    await h.runAlarm();
    expect(h.state.alarm).toBe(DUE + DEAD_MAN_MS);
    await h.runAlarm();
    expect(h.state.alarm).toBe(DUE + LEASE_MS);
    await h.runAlarm();
    expect([h.sentTo(1), h.sentTo(2)]).toEqual([2, 1]);
    expect(h.state.alarm).toBe(DUE + RESEND_AFTER_MS);
  });

  test('transient failures are retried; expired subscriptions are dropped only if still current', async () => {
    const { phone, laptop } = await h.pair();
    h.state.status = (target, attempt) => {
      if (target.endpoint === keys(1).endpoint) return attempt < 3 ? 503 : 201;
      return 410;
    };
    h.state.onPush = (target) => {
      if (target.endpoint === keys(2).endpoint) void h.ok('subscribe', keys(3), laptop);
    };
    await h.put(phone);
    await h.runAlarm();
    expect(h.attempts.get(keys(1).endpoint)).toBe(3);
    const health = await h.ok('health', null, phone);
    expect(health.devices.map((d) => d.push.enabled)).toEqual([true, true]);
  });

  test('test notifications are capped, go out on time, and replays return the original schedule', async () => {
    const { phone } = await h.pair();
    const [first = '', ...rest] = Array.from({ length: 5 }, () => ulid());
    const original = await h.ok('test', { id: first, delay: 30 }, phone);
    await Promise.all(rest.map((id, i) => h.ok('test', { id, delay: 31 + i }, phone)));
    expect(await h.call('test', { id: ulid(), delay: 30 }, phone)).toEqual({ ok: false, error: 'locked' });
    h.state.now += 10_000;
    expect(await h.ok('test', { id: first, delay: 99 }, phone)).toEqual(original);
    h.state.alarm = h.state.now + 40_000;
    await h.runAlarm();
    expect(h.state.pushes).toHaveLength(10);
    h.state.now += 30 * 24 * 60 * MINUTE_MS;
    await h.nudge.watchdog();
    expect(await h.ok('test', { id: first, delay: 1 }, phone)).toEqual(original);
  });
});

describe('resilience', () => {
  test('a failing run keeps the dead-man alarm and alerts once', async () => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.put(deviceId);
    h.state.failTransactions = 1;
    await h.runAlarm();
    expect(h.state.alarm).toBe(DUE + DEAD_MAN_MS);
    expect(h.state.alerts).toHaveLength(1);
  });

  test('the watchdog repairs a lost alarm even when alerts cannot be delivered', async () => {
    const { phone } = await h.pair();
    await h.put(phone);
    h.state.alarm = null;
    h.state.failAlerts = true;
    h.state.now = DUE + 30 * MINUTE_MS;
    expect(await h.nudge.watchdog()).toEqual({ healthy: false });
    expect(h.state.pushes).toHaveLength(2);
    h.state.failAlerts = false;
    h.state.now += 3 * MINUTE_MS;
    expect(await h.nudge.watchdog()).toEqual({ healthy: true });
  });
});
