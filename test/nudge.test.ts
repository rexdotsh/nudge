import { Database } from 'bun:sqlite';
import { beforeEach, describe, expect, test } from 'bun:test';
import type { DeviceInput, Route, ServerMessage } from '../src/shared/api';
import { BASE64URL } from '../src/shared/encoding';
import type { PushMessage } from '../src/shared/notification';
import type { ReminderFields } from '../src/shared/reminder';
import { MINUTE_MS } from '../src/shared/time';
import { ulid } from '../src/shared/ulid';
import { Nudge } from '../src/worker/nudge';
import type { Runtime } from '../src/worker/runtime';
import { DEAD_MAN_MS, ESCALATE_AFTER_MS, RESEND_AFTER_MS } from '../src/worker/scheduler';
import type { SqlValue } from '../src/worker/store';
import { verifyToken } from '../src/worker/tokens';
import type { PushTarget } from '../src/worker/webpush';

const ORIGIN = 'https://nudge.example';
const ZONE = 'Asia/Kolkata';
const SETUP_CODE = 'correct-horse';
const AUTH = 'auth-secret';

const phone: DeviceInput = { label: 'iPhone', platform: 'ios', zone: ZONE, locale: 'en-IN' };
const laptop: DeviceInput = { label: 'Windows PC', platform: 'windows', zone: ZONE, locale: 'en-IN' };

function keys(seed: number) {
  return {
    endpoint: `https://web.push.apple.com/device-${seed}`,
    p256dh: new Uint8Array(65).fill(seed).toBase64(BASE64URL),
    auth: new Uint8Array(16).fill(seed).toBase64(BASE64URL),
  };
}

function fields(overrides: Partial<ReminderFields> = {}): ReminderFields {
  return {
    title: 'Pay rent',
    notes: '',
    start: '2026-10-12T09:00',
    zone: null,
    repeat: null,
    important: false,
    alerts: [],
    ...overrides,
  };
}

function harness() {
  const db = new Database(':memory:');
  const state = {
    now: Date.UTC(2026, 9, 12, 2, 0),
    alarm: null as number | null,
    status: (_target: PushTarget, _attempt: number): number => 201,
    failTransactions: 0,
    pushes: [] as { endpoint: string; message: PushMessage; topic: string }[],
    alerts: [] as string[],
    broadcasts: [] as { message: ServerMessage; except: string | undefined }[],
    disconnected: [] as string[],
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
      if (state.failTransactions > 0) {
        state.failTransactions--;
        throw new Error('storage unavailable');
      }
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
    disconnect: (deviceId) => {
      state.disconnected.push(deviceId);
    },
    push: async (target, json, subject, options) => {
      expect(subject).toBe(ORIGIN);
      const attempt = (attempts.get(target.endpoint) ?? 0) + 1;
      attempts.set(target.endpoint, attempt);
      const message: PushMessage = JSON.parse(json);
      state.pushes.push({ endpoint: target.endpoint, message, topic: options.topic });
      return { status: state.status(target, attempt), detail: '' };
    },
    alert: async (text) => {
      state.alerts.push(text);
    },
    sleep: async () => {},
    now: () => state.now,
    secrets: { auth: AUTH, setupCode: SETUP_CODE },
  };
  const nudge = new Nudge(runtime);

  async function call<R extends Route>(route: R, body: unknown, deviceId: string | null = null) {
    return nudge.call(route, { deviceId, origin: ORIGIN }, body);
  }

  async function ok<R extends Route>(route: R, body: unknown, deviceId: string | null = null) {
    const result = await call(route, body, deviceId);
    if (!result.ok) throw new Error(`${route} failed with ${result.error}`);
    return result.data;
  }

  async function setup(device = phone) {
    return ok('setup', { code: SETUP_CODE, device });
  }

  async function put(deviceId: string, overrides: Partial<ReminderFields> = {}, id = ulid(state.now)) {
    const response = await ok(
      'sync',
      { since: 0, zone: ZONE, ops: [{ type: 'put', id, fields: fields(overrides) }] },
      deviceId,
    );
    return { id, response };
  }

  async function runAlarm(at = state.alarm) {
    if (at === null) throw new Error('no alarm set');
    state.now = at;
    await nudge.alarm();
  }

  return { nudge, state, call, ok, setup, put, runAlarm, attempts };
}

let h: ReturnType<typeof harness>;
beforeEach(() => {
  h = harness();
});

describe('enrollment', () => {
  test('the first device needs the setup code, and only the first', async () => {
    expect(await h.call('setup', { code: 'nope', device: phone })).toEqual({ ok: false, error: 'forbidden' });
    const session = await h.setup();
    expect(await verifyToken(AUTH, session.token)).toBe(session.deviceId);
    expect(await h.call('setup', { code: SETUP_CODE, device: laptop })).toEqual({ ok: false, error: 'forbidden' });
  });

  test('repeated failures lock enrollment for a while', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) => h.call('setup', { code: `guess-${i}`, device: phone })));
    expect(await h.call('setup', { code: SETUP_CODE, device: phone })).toEqual({ ok: false, error: 'locked' });
    h.state.now += 16 * MINUTE_MS;
    expect((await h.call('setup', { code: SETUP_CODE, device: phone })).ok).toBe(true);
  });

  test('further devices join with a single-use, short-lived pair code', async () => {
    const { deviceId } = await h.setup();
    const { code } = await h.ok('pair', null, deviceId);
    expect(await h.call('join', { code: '000000x', device: laptop })).toEqual({ ok: false, error: 'forbidden' });
    expect((await h.call('join', { code, device: laptop })).ok).toBe(true);
    expect(await h.call('join', { code, device: laptop })).toEqual({ ok: false, error: 'forbidden' });

    const second = await h.ok('pair', null, deviceId);
    h.state.now += 11 * MINUTE_MS;
    expect(await h.call('join', { code: second.code, device: laptop })).toEqual({ ok: false, error: 'forbidden' });
  });

  test('unknown or revoked devices are unauthorized', async () => {
    const { deviceId } = await h.setup();
    expect(await h.call('health', null, 'not-a-device')).toEqual({ ok: false, error: 'unauthorized' });
    await h.ok('revoke', { id: deviceId }, deviceId);
    expect(h.state.disconnected).toEqual([deviceId]);
    expect(await h.call('health', null, deviceId)).toEqual({ ok: false, error: 'unauthorized' });
  });

  test('malformed requests are rejected at the boundary', async () => {
    const { deviceId } = await h.setup();
    expect(await h.call('subscribe', { endpoint: 'https://evil.example/x', p256dh: 'a', auth: 'b' }, deviceId)).toEqual(
      {
        ok: false,
        error: 'bad_request',
      },
    );
    expect(await h.call('sync', { since: 0, zone: ZONE, ops: [{ type: 'complete' }] }, deviceId)).toEqual({
      ok: false,
      error: 'bad_request',
    });
    expect(await h.call('test', { delay: 99999 }, deviceId)).toEqual({ ok: false, error: 'bad_request' });
  });
});

describe('sync', () => {
  test('writes return the change, arm the alarm and notify other devices', async () => {
    const { deviceId } = await h.setup();
    const { id, response } = await h.put(deviceId);
    expect(response.version).toBe(1);
    expect(response.reminders.map((r) => r.id)).toEqual([id]);
    expect(h.state.alarm).toBe(Date.UTC(2026, 9, 12, 3, 30));
    expect(h.state.broadcasts.at(-1)).toEqual({ message: { kind: 'changed', version: 1 }, except: deviceId });
  });

  test('only changes after `since` are returned, and a client ahead of the server is reset', async () => {
    const { deviceId } = await h.setup();
    await h.put(deviceId);
    const { id } = await h.put(deviceId, { title: 'Second' });
    const delta = await h.ok('sync', { since: 1, zone: ZONE, ops: [] }, deviceId);
    expect(delta.reminders.map((r) => r.id)).toEqual([id]);
    const ahead = await h.ok('sync', { since: 99, zone: ZONE, ops: [] }, deviceId);
    expect(ahead.reset).toBe(true);
    expect(ahead.reminders).toHaveLength(2);
  });

  test('stale occurrence ops are counted as rejected, not applied twice', async () => {
    const { deviceId } = await h.setup();
    const { id } = await h.put(deviceId);
    const complete = { type: 'complete', id, due: '2026-10-12T09:00' };
    expect((await h.ok('sync', { since: 0, zone: ZONE, ops: [complete] }, deviceId)).rejected).toBe(0);
    expect((await h.ok('sync', { since: 0, zone: ZONE, ops: [complete] }, deviceId)).rejected).toBe(1);
  });

  test('travelling re-times floating reminders', async () => {
    const { deviceId } = await h.setup();
    await h.put(deviceId);
    await h.put(deviceId, { title: 'Pinned', zone: ZONE, start: '2026-10-12T10:00' });
    expect(h.state.alarm).toBe(Date.UTC(2026, 9, 12, 3, 30));
    await h.ok('sync', { since: 0, zone: 'Europe/Paris', ops: [] }, deviceId);
    expect(h.state.alarm).toBe(Date.UTC(2026, 9, 12, 4, 30));
  });

  test('socket messages run the same sync and answer with their ref', async () => {
    const { deviceId } = await h.setup();
    const answer = await h.nudge.message(
      deviceId,
      JSON.stringify({ kind: 'sync', ref: 'r1', since: 0, zone: ZONE, ops: [] }),
    );
    expect(answer).toMatchObject({ kind: 'synced', ref: 'r1', version: 0 });
    expect(await h.nudge.message(deviceId, '{oops')).toEqual({ kind: 'failed', ref: '', error: 'bad_request' });
    expect(
      await h.nudge.message('ghost', JSON.stringify({ kind: 'sync', ref: 'r2', since: 0, zone: ZONE, ops: [] })),
    ).toEqual({
      kind: 'failed',
      ref: 'r2',
      error: 'unauthorized',
    });
  });
});

async function subscribedPair() {
  const first = await h.setup();
  const { code } = await h.ok('pair', null, first.deviceId);
  const second = await h.ok('join', { code, device: laptop });
  await h.ok('subscribe', keys(1), first.deviceId);
  await h.ok('subscribe', keys(2), second.deviceId);
  return { phoneId: first.deviceId, laptopId: second.deviceId };
}

describe('delivery', () => {
  test('a due reminder is pushed to every device as a declarative notification', async () => {
    const { phoneId } = await subscribedPair();
    const { id } = await h.put(phoneId, { notes: 'Transfer before noon' });
    await h.runAlarm();

    expect(h.state.pushes.map((p) => p.endpoint).toSorted()).toEqual([keys(1).endpoint, keys(2).endpoint]);
    const first = h.state.pushes[0];
    if (!first) throw new Error('nothing was pushed');
    const { message, topic } = first;
    expect(topic).toBe(id);
    expect(message).toMatchObject({
      web_push: 8030,
      mutable: true,
      notification: {
        title: 'Pay rent',
        body: 'Transfer before noon',
        tag: id,
        navigate: `${ORIGIN}/?open=${id}`,
        app_badge: '1',
        data: { id, due: '2026-10-12T09:00' },
      },
    });
    expect(h.state.alarm).toBe(Date.UTC(2026, 9, 12, 3, 30) + RESEND_AFTER_MS);
  });

  test('a confirmed delivery is not resent; an unconfirmed one is resent once, then escalated', async () => {
    const { phoneId, laptopId } = await subscribedPair();
    await h.put(phoneId);
    await h.runAlarm();
    const fire = h.state.pushes[0]?.message.notification.data.fire ?? '';
    await h.ok('receipt', { fire }, phoneId);

    await h.runAlarm();
    expect(h.state.pushes.filter((p) => p.endpoint === keys(1).endpoint)).toHaveLength(1);
    expect(h.state.pushes.filter((p) => p.endpoint === keys(2).endpoint)).toHaveLength(2);
    expect(h.state.alarm).toBe(h.state.now + ESCALATE_AFTER_MS);

    await h.runAlarm();
    expect(h.state.alerts.at(-1)).toContain('"Windows PC" has not confirmed "Pay rent"');
    expect(h.state.alarm).toBeNull();

    const health = await h.ok('health', null, laptopId);
    expect(health.devices.find((d) => d.id === phoneId)?.push.receiptAt).not.toBeNull();
  });

  test('transient push failures are retried before giving up', async () => {
    const { phoneId } = await subscribedPair();
    h.state.status = (target, attempt) => (target.endpoint === keys(1).endpoint && attempt < 3 ? 503 : 201);
    await h.put(phoneId);
    await h.runAlarm();
    expect(h.attempts.get(keys(1).endpoint)).toBe(3);
    expect(h.state.alerts).toEqual([]);
  });

  test('an expired subscription is dropped and reported once', async () => {
    const { phoneId } = await subscribedPair();
    h.state.status = (target) => (target.endpoint === keys(2).endpoint ? 410 : 201);
    await h.put(phoneId);
    await h.runAlarm();
    expect(h.state.alerts).toHaveLength(1);
    expect(h.state.alerts[0]).toContain('Notifications stopped on "Windows PC"');
    const health = await h.ok('health', null, phoneId);
    expect(health.devices.map((d) => d.push.enabled)).toEqual([true, false]);
  });

  test('test notifications go out at the requested time', async () => {
    const { phoneId } = await subscribedPair();
    const { at } = await h.ok('test', { delay: 30 }, phoneId);
    expect(h.state.alarm).toBe(at);
    await h.runAlarm();
    expect(h.state.pushes.map((p) => p.message.notification.title)).toEqual([
      'Notifications work',
      'Notifications work',
    ]);
  });
});

describe('resilience', () => {
  test('a failing run leaves the dead-man alarm in place and alerts', async () => {
    const { deviceId } = await h.setup();
    await h.put(deviceId);
    h.state.failTransactions = 1;
    await h.runAlarm();
    expect(h.state.alarm).toBe(h.state.now + DEAD_MAN_MS);
    expect(h.state.alerts[0]).toContain('The scheduler failed');
    await h.runAlarm();
    expect(h.state.alarm).toBeNull();
  });

  test('the watchdog catches up when the alarm was lost', async () => {
    const { deviceId } = await h.setup();
    await h.ok('subscribe', keys(1), deviceId);
    await h.put(deviceId);
    h.state.alarm = null;
    h.state.now = Date.UTC(2026, 9, 12, 4, 0);
    expect(await h.nudge.watchdog()).toEqual({ healthy: false });
    expect(h.state.pushes).toHaveLength(1);
    expect(h.state.alerts[0]).toContain('were late');
    expect(await h.nudge.watchdog()).toEqual({ healthy: true });
  });
});
