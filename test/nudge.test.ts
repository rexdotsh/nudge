import { beforeEach, describe, expect, test } from 'bun:test';
import type { DeviceInfo } from '../src/shared/api';
import { NAG_INTERVAL_MS } from '../src/shared/fire';
import { fireId } from '../src/shared/notification';
import type { Op } from '../src/shared/ops';
import { HOUR_MS, MINUTE_MS } from '../src/shared/time';
import { ulid } from '../src/shared/ulid';
import { DEAD_MAN_MS, ESCALATE_AFTER_MS, LEASE_MS, RESEND_AFTER_MS } from '../src/worker/scheduler';
import { verifyToken } from '../src/worker/tokens';
import { AUTH, ORIGIN, SETUP_CODE, ZONE, device, fields, harness, keys, type Pushed } from './harness';

const DUE = Date.UTC(2026, 9, 12, 3, 30);
const TODAY = '2026-10-12T09:00';
const daily = { rule: 'FREQ=DAILY', anchor: 'schedule' } as const;

const pushOf = (info: DeviceInfo | undefined) => (info?.kind === 'device' ? info.push : undefined);

let h: ReturnType<typeof harness>;
beforeEach(() => {
  h = harness();
});

describe('enrollment', () => {
  test('setup needs the code, works once, and is safe to retry with the same install key', async () => {
    const phone = device('iPhone');
    expect(await h.call('setup', { code: 'NOPE', device: phone })).toMatchObject({ ok: false, error: 'forbidden' });
    const first = await h.ok('setup', { code: SETUP_CODE, device: phone });
    expect(await verifyToken(AUTH, first.token)).toBe(first.deviceId);
    expect((await h.ok('setup', { code: SETUP_CODE, device: phone })).deviceId).toBe(first.deviceId);
    expect(await h.call('setup', { code: SETUP_CODE, device: device('Intruder') })).toMatchObject({
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
    expect(await h.call('join', { code, device: device('Intruder') })).toMatchObject({ ok: false, error: 'forbidden' });

    const late = await h.ok('pair', null, deviceId);
    h.state.now += 11 * MINUTE_MS;
    expect(await h.call('join', { code: late.code, device: device('Late') })).toMatchObject({
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
    expect(await h.call('join', { code, device: device('Someone else') })).toMatchObject({
      ok: false,
      error: 'forbidden',
    });
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
    expect(await h.call('setup', { code: SETUP_CODE, device: device('iPhone') })).toMatchObject({
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
      ['sync', { since: 0, zone: ZONE, changes: [{ opId: ulid(), op: { type: 'complete' }, at: 0 }] }],
      ['sync', { since: 0, zone: ZONE, changes: [{ opId: 'not-an-id', op: { type: 'delete', id: ulid() }, at: 0 }] }],
      ['test', { id: ulid(), delay: 99_999 }],
      ['sync', { since: 0, zone: ZONE, changes: [], theme: { id: ulid(), theme: 'neon', at: 0 } }],
      ['sync', { since: 0, zone: ZONE, changes: [], zoneChoice: { id: ulid(), zone: 'Mars/Olympus', at: 0 } }],
    ] as const;
    const results = await Promise.all(malformed.map(([route, body]) => h.call(route, body, deviceId)));
    expect(results.every((result) => !result.ok && result.error === 'bad_request')).toBe(true);
    await h.ok('revoke', { id: deviceId }, deviceId);
    expect(await h.call('health', null, deviceId)).toMatchObject({ ok: false, error: 'unauthorized' });
  });
});

const chooseZone = (deviceId: string, zone: string | null, here = ZONE, choice = { id: ulid(), at: h.state.now }) =>
  h.ok('sync', { since: 0, zone: here, changes: [], zoneChoice: { ...choice, zone } }, deviceId);

describe('sync', () => {
  test('a replayed change never overwrites a newer edit', async () => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    const id = ulid();
    const first = { opId: ulid(), op: { type: 'put', id, fields: fields({ title: 'Old' }) }, at: h.state.now };
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

  test('the zone follows the device that moved, and one left at home cannot flip it back', async () => {
    const { phone, laptop } = await h.pair();
    await h.put(phone);
    await h.sync(phone, [], 'Europe/Paris');
    const abroad = h.state.alarm;
    expect(abroad).toBe(Date.UTC(2026, 9, 12, 7, 0));
    await h.sync(laptop, []);
    await h.sync(laptop, []);
    expect(h.state.alarm).toBe(abroad);
    await h.sync(phone, []);
    expect(h.state.alarm).toBe(DUE);
  });

  test('enrolling a device moves the zone to wherever that device is', async () => {
    const { phone } = await h.pair();
    await h.put(phone);
    await h.sync(phone, [], 'Europe/Paris');
    const { code } = await h.ok('pair', null, phone);
    const laptop = { ...device('Windows PC'), zone: ZONE };
    await h.ok('join', { code, device: laptop });
    expect(h.state.alarm).toBe(DUE);
    h.state.alarm = null;
    await h.ok('join', { code, device: laptop });
    expect(h.state).toMatchObject({ alarm: DUE });
  });

  test('a device left at home schedules floating repeats in the instance zone, not its stale zone', async () => {
    const { phone, laptop } = await h.pair();
    h.state.now = Date.UTC(2026, 9, 12, 8);
    await h.sync(phone, [], 'America/New_York');
    await h.put(laptop, { repeat: daily });
    expect(h.state.alarm).toBe(Date.UTC(2026, 9, 12, 13));
  });

  test('moving zones preserves the millisecond separating an upcoming early alert from the current due notice', async () => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.ok('subscribe', keys(1, 'apple'), deviceId);
    await h.put(deviceId, { repeat: daily, alerts: [1440] });
    await h.runAlarmsThrough(DUE + 1);
    await h.sync(deviceId, [], 'America/New_York');
    expect(h.state.alarm).toBe(Date.UTC(2026, 9, 13, 13));
  });

  test('a change made offline is applied at the time it was made, so a missed reminder still goes out', async () => {
    const { phone } = await h.pair();
    const madeAt = h.state.now;
    h.state.now = DUE + 60 * MINUTE_MS;
    const change = { opId: ulid(), op: { type: 'put', id: ulid(madeAt), fields: fields() }, at: madeAt };
    await h.ok('sync', { since: 0, zone: ZONE, changes: [change] }, phone);
    await h.nudge.alarm();
    expect(h.sentTo(1)).toBe(1);
  });

  test('replaying a committed change repairs an alarm that was lost after the commit', async () => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    const change = { opId: ulid(), op: { type: 'put', id: ulid(), fields: fields() }, at: h.state.now };
    await h.ok('sync', { since: 0, zone: ZONE, changes: [change] }, deviceId);
    h.state.alarm = null;
    await h.ok('sync', { since: 0, zone: ZONE, changes: [change] }, deviceId);
    expect(h.state).toMatchObject({ alarm: DUE });
  });

  test('flying west after a floating reminder fired does not fire it again', async () => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.ok('subscribe', keys(1), deviceId);
    await h.put(deviceId, { repeat: { rule: 'FREQ=DAILY', anchor: 'schedule' } });
    await h.runAlarm();
    await h.ok('receipt', { fire: h.state.pushes[0]?.message.notification.data.fire }, deviceId);
    await h.sync(deviceId, [], 'America/New_York');
    if (h.state.alarm !== null && h.state.alarm <= h.state.now) await h.nudge.alarm();
    expect(h.sentTo(1)).toBe(1);
  });

  test.each([
    ['still brings it back after the snooze', false, 2],
    ['does not bring it back once a pause covered the end of the snooze', true, 1],
  ])('snoozing a notification after flying west %s', async (_, paused, sent) => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.ok('subscribe', keys(1), deviceId);
    const id = await h.put(deviceId, { repeat: { rule: 'FREQ=DAILY', anchor: 'schedule' } });
    await h.runAlarm();
    await h.ok('receipt', { fire: h.state.pushes[0]?.message.notification.data.fire }, deviceId);
    await h.sync(deviceId, [], 'America/New_York');
    const until = h.state.now + 15 * MINUTE_MS;
    await h.sync(deviceId, [{ type: 'snooze', id, due: '2026-10-12T09:00', until }], 'America/New_York');
    if (paused) await h.sync(deviceId, [{ type: 'pause', id, until: until + 15 * MINUTE_MS }], 'America/New_York');
    expect(h.state.alarm).toBe(paused ? until + 15 * MINUTE_MS : until);
    await h.runAlarm();
    expect(h.sentTo(1)).toBe(sent);
  });

  test.each<[string, number | null]>([
    ['on its date', Date.UTC(2026, 9, 12, 11)],
    ['by hand', null],
  ])('a snooze that ended during a pause stays quiet after flying west and resuming %s', async (_, until) => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.ok('subscribe', keys(1), deviceId);
    const id = ulid(h.state.now);
    await h.sync(deviceId, [{ type: 'put', id, fields: fields({ repeat: daily }) }], 'UTC');
    await h.runAlarm();
    await h.ok('receipt', { fire: h.state.pushes[0]?.message.notification.data.fire }, deviceId);
    h.state.now = Date.UTC(2026, 9, 12, 9, 30);
    const snoozedUntil = Date.UTC(2026, 9, 12, 10, 30);
    await h.sync(deviceId, [{ type: 'snooze', id, due: TODAY, until: snoozedUntil }], 'UTC');
    h.state.now = Date.UTC(2026, 9, 12, 10);
    await h.sync(deviceId, [{ type: 'pause', id, until }], 'UTC');
    h.state.now = Date.UTC(2026, 9, 12, 10, 15);
    await h.sync(deviceId, [], 'America/New_York');
    if (until === null) {
      h.state.now = Date.UTC(2026, 9, 12, 15);
      await h.sync(deviceId, [{ type: 'resume', id }], 'America/New_York');
    } else {
      expect(h.state.alarm).toBe(Date.UTC(2026, 9, 12, 15));
    }
    await h.runAlarmsThrough(Date.UTC(2026, 9, 12, 16));
    expect(h.sentTo(1)).toBe(1);
  });

  test('flying east past a floating reminder that has not fired yet still fires it', async () => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.ok('subscribe', keys(1), deviceId);
    await h.put(deviceId, { repeat: { rule: 'FREQ=DAILY', anchor: 'schedule' } });
    await h.sync(deviceId, [], 'Asia/Tokyo');
    expect(h.state.alarm).not.toBeNull();
    if (h.state.alarm !== null && h.state.alarm <= h.state.now) await h.nudge.alarm();
    expect(h.sentTo(1)).toBe(1);
  });

  test('a theme choice reaches the other devices; neither a replay from a fast clock nor an older offline choice undoes a newer one', async () => {
    const { phone, laptop } = await h.pair();
    const choose = (deviceId: string, theme: { id: string; theme: string; at: number }) =>
      h.ok('sync', { since: 0, zone: ZONE, changes: [], theme }, deviceId);
    const madeOffline = { id: ulid(), theme: 'rex', at: h.state.now - MINUTE_MS };
    const fromPhone = { id: ulid(), theme: 'rex', at: h.state.now + 60 * MINUTE_MS };
    h.state.broadcasts.length = 0;

    expect((await choose(phone, fromPhone)).theme).toBe('rex');
    expect(h.state.broadcasts.map(({ except }) => except)).toEqual([phone]);
    h.state.now += MINUTE_MS;
    expect((await choose(laptop, { id: ulid(), theme: 'classic', at: h.state.now })).theme).toBe('classic');
    expect((await choose(phone, fromPhone)).theme).toBe('classic');
    expect((await choose(laptop, madeOffline)).theme).toBe('classic');
  });

  test.each([
    ['a device syncs from elsewhere', (phone: string) => h.sync(phone, [], 'America/New_York')],
    [
      'a new device enrolls elsewhere',
      async (phone: string) => {
        const { code } = await h.ok('pair', null, phone);
        await h.ok('join', { code, device: { ...device('Windows PC'), zone: 'America/New_York' } });
      },
    ],
  ])('a fixed zone stays put when %s', async (_, move) => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.put(deviceId);
    await chooseZone(deviceId, 'Europe/Paris');
    const fixed = Date.UTC(2026, 9, 12, 7);
    expect(h.state.alarm).toBe(fixed);
    await move(deviceId);
    expect(h.state.alarm).toBe(fixed);
    expect((await h.sync(deviceId, [])).zone).toEqual({ name: 'Europe/Paris', fixed: true });
  });

  test.each([
    {
      name: 'fixing a zone west of a daily reminder that just fired does not fire it again',
      now: Date.UTC(2026, 9, 12, 2),
      start: '2026-10-12T09:00',
      before: null,
      choice: 'America/New_York',
      here: ZONE,
      through: Date.UTC(2026, 9, 13, 14),
      due: ['2026-10-12T09:00', '2026-10-13T09:00'],
    },
    {
      name: 'following again from a device east of the fixed zone fires the occurrence that already passed there',
      now: Date.UTC(2026, 9, 12, 2),
      start: '2026-10-12T09:00',
      before: 'Europe/Paris',
      choice: null,
      here: 'Asia/Tokyo',
      through: Date.UTC(2026, 9, 12, 23),
      due: ['2026-10-12T09:00'],
    },
    {
      name: 'fixing a zone whose clocks skip the time a daily reminder just fired at does not fire it again',
      now: Date.UTC(2026, 2, 7, 20),
      start: '2026-03-08T02:30',
      before: null,
      choice: 'America/New_York',
      here: ZONE,
      through: Date.UTC(2026, 2, 9, 7),
      due: ['2026-03-08T02:30', '2026-03-09T02:30'],
    },
  ])('$name', async ({ now, start, before, choice, here, through, due }) => {
    h.state.now = now;
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.ok('subscribe', keys(1, 'apple'), deviceId);
    if (before) await chooseZone(deviceId, before);
    await h.put(deviceId, { start, repeat: daily });
    if (!before) await h.runAlarm();
    await chooseZone(deviceId, choice, here);
    if (h.state.alarm !== null && h.state.alarm < h.state.now) await h.nudge.alarm();
    await h.runAlarmsThrough(through);
    expect(h.state.pushes.map((push) => push.message.notification.data.fire.split('/')[1])).toEqual([...due]);
  });

  test('fixing a zone whose clocks skip an unfired reminder and fixing it back still fires it once', async () => {
    h.state.now = Date.UTC(2026, 2, 8, 2);
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.ok('subscribe', keys(1, 'apple'), deviceId);
    await chooseZone(deviceId, 'UTC');
    await h.put(deviceId, { start: '2026-03-08T02:30' });
    const alarms = [h.state.alarm];
    await chooseZone(deviceId, 'America/New_York');
    alarms.push(h.state.alarm);
    await chooseZone(deviceId, 'UTC');
    alarms.push(h.state.alarm);
    await h.runAlarmsThrough(Date.UTC(2026, 2, 8, 12));
    const due = Date.UTC(2026, 2, 8, 2, 30);
    expect(alarms).toEqual([due, Date.UTC(2026, 2, 8, 7, 30), due]);
    expect(h.state.pushes.map((push) => push.message.notification.data.fire.split('/')[1])).toEqual([
      '2026-03-08T02:30',
    ]);
  });

  test('a zone choice applies once, and neither its replay nor an older offline choice undoes a newer one', async () => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.put(deviceId);
    const madeOffline = { id: ulid(), at: h.state.now - MINUTE_MS };
    const fixed = { id: ulid(), at: h.state.now };
    expect((await chooseZone(deviceId, 'Europe/Paris', ZONE, fixed)).zone).toEqual({
      name: 'Europe/Paris',
      fixed: true,
    });
    h.state.now += MINUTE_MS;
    expect((await chooseZone(deviceId, null)).zone).toEqual({ name: ZONE, fixed: false });
    expect((await chooseZone(deviceId, 'Europe/Paris', ZONE, fixed)).zone).toEqual({ name: ZONE, fixed: false });
    expect((await chooseZone(deviceId, 'Asia/Tokyo', ZONE, madeOffline)).zone).toEqual({ name: ZONE, fixed: false });
    expect(h.state.alarm).toBe(DUE);
  });

  test.each([
    [
      'change',
      () => ({ changes: [{ opId: ulid(), op: { type: 'put', id: ulid(), fields: fields() }, at: h.state.now }] }),
    ],
    ['theme choice', () => ({ changes: [], theme: { id: ulid(), theme: 'rex', at: h.state.now } })],
    ['zone choice', () => ({ changes: [], zoneChoice: { id: ulid(), zone: 'Europe/Paris', at: h.state.now } })],
  ])('a %s committed just before a failure still reaches the other devices when it is retried', async (_, write) => {
    const { phone } = await h.pair();
    const { version } = await h.ok('sync', { since: 0, zone: ZONE, changes: [] }, phone);
    const request = { since: version, zone: ZONE, ...write() };
    h.state.broadcasts.length = 0;
    h.state.failAlarm = true;
    expect(await h.call('sync', request, phone).catch((error: unknown) => error)).toBeInstanceOf(Error);
    h.state.failAlarm = false;
    await h.ok('sync', request, phone);
    expect(h.state.broadcasts.map(({ except }) => except)).toEqual([phone]);
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
      app_badge: '1',
      notification: { tag: `${id}:2026-10-12T09:00`, navigate: `${ORIGIN}/?open=${id}` },
    });
    expect(h.state.pushes[0]?.topic?.length).toBeLessThanOrEqual(32);
  });

  test.each(['phone', 'laptop'] as const)(
    'a receipt from the %s stops occurrence escalation, not the other device’s resend',
    async (confirmed) => {
      const devices = await h.pair();
      const { phone } = devices;
      await h.put(phone);
      await h.runAlarm();
      await h.ok('receipt', { fire: h.state.pushes[0]?.message.notification.data.fire }, devices[confirmed]);
      expect(h.state.alarm).toBe(DUE + RESEND_AFTER_MS);
      await h.runAlarm();
      expect([h.sentTo(1), h.sentTo(2)]).toEqual(confirmed === 'phone' ? [1, 2] : [2, 1]);
      expect(h.state.alarm).toBe(h.state.now + ESCALATE_AFTER_MS);
      await h.runAlarm();
      expect(h.state.alerts).toHaveLength(0);
      expect(h.state.alarm).toBeNull();
    },
  );

  test.each([false, true])('an Apple device gets each fire once, with prior receipt: %s', async (priorReceipt) => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.ok('subscribe', keys(1, 'apple'), deviceId);
    if (priorReceipt) {
      await h.ok('test', { id: ulid(), delay: 1 }, deviceId);
      await h.runAlarm();
      await h.ok('receipt', { fire: h.state.pushes[0]?.message.notification.data.fire }, deviceId);
    }
    const before = pushOf((await h.ok('health', null, deviceId)).devices[0])?.receiptAt;
    const offset = h.state.pushes.length;
    await h.put(deviceId, { important: true });
    await h.runAlarmsThrough(DUE + HOUR_MS);
    const fires = h.state.pushes.slice(offset).map((push) => push.message.notification.data.fire);
    expect(fires.length).toBeGreaterThan(1);
    expect(new Set(fires).size).toBe(fires.length);
    expect(h.state.alerts).toHaveLength(0);
    expect(pushOf((await h.ok('health', null, deviceId)).devices[0])?.receiptAt).toBe(before);
    expect(h.db.query('SELECT fire FROM deliveries WHERE receipt_at IS NULL OR next_at IS NOT NULL').all()).toEqual([]);
  });

  test.each([
    ['FCM only', 'fcm', 'fcm', 201, 201, 1, [2, 2], false],
    ['Apple accepted, PC silent', 'apple', 'fcm', 201, 201, 0, [1, 2], false],
    ['Apple previously confirmed, PC silent', 'apple', 'fcm', 201, 201, 0, [1, 2], true],
    ['Apple failing, PC silent', 'apple', 'fcm', 503, 201, 1, [6, 2], false],
    ['Both push services failing', 'apple', 'fcm', 503, 503, 1, [6, 6], false],
  ] as const)(
    '%s: retries per device, escalation once per occurrence',
    async (_, first, second, status, otherStatus, alerts, sends, priorReceipt) => {
      const { phone, laptop } = await h.pair(first, second);
      if (priorReceipt) {
        await h.ok('test', { id: ulid(), delay: 1 }, phone);
        await h.runAlarm();
        const fire = h.state.pushes[0]?.message.notification.data.fire;
        await Promise.all([phone, laptop].map((id) => h.ok('receipt', { fire }, id)));
        h.state.pushes.length = 0;
      }
      h.state.status = (target) => (target.endpoint === keys(1, first).endpoint ? status : otherStatus);
      await h.put(phone);
      await h.runAlarmsThrough(DUE + HOUR_MS);
      const escalations = h.state.alerts.filter((text) => !text.includes('Push to'));
      expect(escalations).toHaveLength(alerts);
      expect([h.sentTo(1, first), h.sentTo(2, second)]).toEqual([...sends]);
      if (alerts) {
        expect(escalations[0]).toContain('iPhone');
        expect(escalations[0]).toContain('Windows PC');
      }
      expect(h.state.alerts.filter((text) => text.includes('Push to'))).toHaveLength(
        Number(status === 503) + Number(otherStatus === 503),
      );
      expect(h.state.alarm).toBeNull();
    },
  );

  test.each([1, 2])(
    'an accepted Apple delivery queued by the old policy with %d sends is settled, not resent',
    async (sends) => {
      const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
      await h.ok('subscribe', keys(1, 'apple'), deviceId);
      await h.put(deviceId);
      await h.runAlarm();
      h.db.query('UPDATE deliveries SET receipt_at = NULL, sends = ?, next_at = ?').run(sends, DUE + RESEND_AFTER_MS);
      h.state.now = DUE + RESEND_AFTER_MS;
      await h.nudge.alarm();
      expect(h.sentTo(1, 'apple')).toBe(1);
      expect(h.state.alerts).toHaveLength(0);
      expect(h.state.alarm).toBeNull();
      expect(pushOf((await h.ok('health', null, deviceId)).devices[0])?.receiptAt).toBeNull();
      expect(h.db.query('SELECT sends, receipt_at FROM deliveries').all()).toEqual([{ sends, receipt_at: DUE }]);
    },
  );

  test('Apple acceptance of a later fire suppresses an earlier escalation claimed in the same run', async () => {
    const { phone } = await h.pair('apple', 'fcm');
    h.state.status = (target) => (target.endpoint === keys(1, 'apple').endpoint ? 503 : 201);
    await h.put(phone, { important: true });
    await h.runAlarm();
    await h.runAlarm();
    h.state.status = () => 201;
    h.state.now = DUE + 3 * NAG_INTERVAL_MS;
    await h.nudge.alarm();
    expect(h.state.alerts.filter((text) => !text.includes('Push to'))).toHaveLength(0);
    expect(h.sentTo(1, 'apple')).toBe(7);
  });

  test.each([
    ['answers from the first nag on', 0, DUE + NAG_INTERVAL_MS],
    ['never answers', 1, Infinity],
  ])(
    'an important reminder on a device that %s raises %d alert(s), even after retention and snoozing',
    async (_, alerts, onlineAt) => {
      const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
      await h.ok('subscribe', keys(1), deviceId);
      const id = await h.put(deviceId, { important: true });
      const confirmArrivals = (arrived: Pushed[]) =>
        Promise.all(
          arrived
            .filter(() => h.state.now >= onlineAt)
            .map((push) => h.ok('receipt', { fire: push.message.notification.data.fire }, deviceId)),
        );
      await h.runAlarmsThrough(DUE + 3 * HOUR_MS, confirmArrivals);
      h.state.now = DUE + 15 * 24 * HOUR_MS;
      await h.nudge.watchdog();
      const until = h.state.now + MINUTE_MS;
      await h.sync(deviceId, [{ type: 'snooze', id, due: '2026-10-12T09:00', until }]);
      await h.runAlarmsThrough(until + 3 * HOUR_MS, confirmArrivals);
      expect(h.state.alerts).toHaveLength(alerts);
    },
  );

  test('an occurrence forgets its alert once it is over, so nothing is kept forever', async () => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.ok('subscribe', keys(1), deviceId);
    const id = await h.put(deviceId);
    await h.runAlarmsThrough(DUE + HOUR_MS);
    const marks = () => h.db.query("SELECT key FROM meta WHERE key LIKE 'alert:unconfirmed:%'").all();
    expect([h.state.alerts.length, marks().length]).toEqual([1, 1]);
    await h.nudge.watchdog();
    expect(marks()).toHaveLength(1);
    await h.sync(deviceId, [{ type: 'complete', id, due: '2026-10-12T09:00' }]);
    await h.nudge.watchdog();
    expect(marks()).toHaveLength(0);
  });

  const receipts: [string, 'due' | 'early' | 'nag' | 'unknown', string[]][] = [
    ['a nag confirms the earlier pushes of its occurrence', 'nag', ['due', 'nag']],
    ['the due push confirms only itself', 'due', ['due']],
    ['an early alert for the next occurrence confirms only itself', 'early', ['early']],
    ['an unknown fire confirms nothing', 'unknown', []],
  ];
  test.each(receipts)('a receipt for %s, on that device only', async (_, receipted, confirmed) => {
    const { phone, laptop } = await h.pair();
    const series = await h.put(phone, { important: true, repeat: daily, alerts: [1440] });
    const other = await h.put(phone, { title: 'Call the bank' });
    await h.runAlarmsThrough(DUE + 2 * NAG_INTERVAL_MS);
    const fires = {
      due: fireId(series, { at: DUE, due: TODAY }),
      early: fireId(series, { at: DUE, due: '2026-10-13T09:00' }),
      nag: fireId(series, { at: DUE + NAG_INTERVAL_MS, due: TODAY }),
      later: fireId(series, { at: DUE + 2 * NAG_INTERVAL_MS, due: TODAY }),
      other: fireId(other, { at: DUE, due: TODAY }),
      unknown: fireId(series, { at: DUE + HOUR_MS, due: TODAY }),
    };
    await h.ok('receipt', { fire: fires[receipted] }, phone);
    const rows = h.db
      .query<{ fire: string; device_id: string; receipt_at: number | null }, []>(
        'SELECT fire, device_id, receipt_at FROM deliveries',
      )
      .all();
    const status = (fire: string, deviceId: string) => {
      const row = rows.find((r) => r.fire === fire && r.device_id === deviceId);
      if (row === undefined) return 'absent';
      return row.receipt_at === null ? 'pending' : 'confirmed';
    };
    const pushed = ['due', 'early', 'nag', 'later', 'other'] as const;
    expect(pushed.map((label) => [label, status(fires[label], phone), status(fires[label], laptop)])).toEqual(
      pushed.map((label) => [label, confirmed.includes(label) ? 'confirmed' : 'pending', 'pending']),
    );
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

  test.each(['apple', 'fcm'] as const)(
    'a %s push outliving its lease cannot undo the retry that replaced it',
    async (service) => {
      const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
      await h.ok('subscribe', keys(1, service), deviceId);
      await h.put(deviceId);
      h.state.holdNext = true;
      h.state.now = DUE;
      const stalled = h.nudge.alarm();
      h.state.now = DUE + LEASE_MS + MINUTE_MS;
      await h.nudge.watchdog();
      expect(h.sentTo(1, service)).toBe(2);
      h.state.held?.(410);
      await stalled;
      const health = await h.ok('health', null, deviceId);
      expect(pushOf(health.devices[0])?.enabled).toBe(true);
      expect(h.state.alarm).toBe(service === 'apple' ? null : DUE + LEASE_MS + MINUTE_MS + RESEND_AFTER_MS);
    },
  );

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
    expect(health.devices.map((d) => pushOf(d)?.enabled)).toEqual([true, true]);
  });

  test.each(['receipt', 'complete', 'lease'] as const)(
    'quick retries stop after a %s ends their claim',
    async (end) => {
      const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
      await h.ok('subscribe', keys(1), deviceId);
      const id = await h.put(deviceId);
      h.state.holdNext = true;
      const pushed = new Promise<void>((resolve) => (h.state.onPush = () => resolve()));
      h.state.now = DUE;
      const sending = h.nudge.alarm();
      await pushed;
      if (end === 'receipt') await h.ok('receipt', { fire: fireId(id, { at: DUE, due: TODAY }) }, deviceId);
      if (end === 'complete') await h.sync(deviceId, [{ type: 'complete', id, due: '2026-10-12T09:00' }]);
      if (end === 'lease') {
        h.state.now += LEASE_MS;
        await h.nudge.alarm();
      }
      h.state.held?.(503);
      await sending;
      expect(h.sentTo(1)).toBe(end === 'lease' ? 2 : 1);
    },
  );

  test.each([503, 429, 0])(
    'a push outage (%d) outlasting quick retries is resent later, then escalated',
    async (status) => {
      const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
      await h.ok('subscribe', keys(1), deviceId);
      h.state.status = () => {
        if (status === 0) throw new Error('network unavailable');
        return status;
      };
      await h.put(deviceId);
      await h.runAlarm();
      expect(h.state.alarm).toBe(DUE + RESEND_AFTER_MS);
      await h.runAlarm();
      expect(h.sentTo(1)).toBe(6);
      await h.runAlarm();
      expect(h.state.alerts).toHaveLength(2);
      expect(h.state.alarm).toBeNull();
    },
  );

  test.each([404, 410, 403])(
    'a permanent push failure (%d) still alerts when Apple reached the occurrence',
    async (status) => {
      const { phone } = await h.pair('fcm', 'apple');
      h.state.status = (target) => (target.endpoint === keys(1).endpoint ? status : 201);
      await h.put(phone);
      await h.runAlarmsThrough(DUE + HOUR_MS);
      expect([h.sentTo(1), h.sentTo(2, 'apple')]).toEqual([1, 1]);
      expect(h.state.alerts).toHaveLength(1);
      expect(pushOf((await h.ok('health', null, phone)).devices.find((d) => d.id === phone))?.enabled).toBe(
        status === 403,
      );
      expect(h.state.alarm).toBeNull();
    },
  );

  test('pausing ends the resends and nags already under way, and the series comes back by itself on its date', async () => {
    const { phone } = await h.pair();
    const id = await h.put(phone, { repeat: daily, important: true });
    await h.runAlarm();
    const until = Date.UTC(2026, 9, 14, 18, 30);
    await h.sync(phone, [{ type: 'pause', id, until }]);
    expect(h.state.alarm).toBe(until);
    const sent = h.state.pushes.length;
    await h.runAlarm();
    expect(h.state.pushes).toHaveLength(sent);
    const { reminders } = await h.sync(phone, []);
    expect(reminders.find((reminder) => reminder.id === id)).toMatchObject({ paused: null, due: '2026-10-15T09:00' });
    await h.runAlarm();
    expect(h.state.now).toBe(Date.UTC(2026, 9, 15, 3, 30));
    expect([h.sentTo(1), h.sentTo(2)]).toEqual([2, 2]);
  });

  test.each<[string, (id: string, revision: number) => Op]>([
    ['undoing the pause', (id, revision) => ({ type: 'unpause', id, revision })],
    ['resuming before anything else came due', (id) => ({ type: 'resume', id })],
  ])('a push that never got through is retried after %s', async (_, end) => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.ok('subscribe', keys(1), deviceId);
    const id = await h.put(deviceId, { repeat: daily });
    h.state.status = () => 503;
    await h.runAlarm();
    const retry = h.state.alarm;
    h.state.now += 1000;
    const { reminders } = await h.sync(deviceId, [{ type: 'pause', id, until: null }]);
    expect(h.state.alarm).toBeNull();
    const paused = reminders.find((reminder) => reminder.id === id);
    h.state.now += 1000;
    await h.sync(deviceId, [end(id, paused?.revision ?? 0)]);
    expect(h.state.alarm).toBe(retry);
    h.state.status = () => 201;
    const tried = h.sentTo(1);
    await h.runAlarm();
    expect(h.sentTo(1)).toBe(tried + 1);
    expect(h.state.pushes.at(-1)?.message.notification.data.reminder).toEqual({ id, due: TODAY });
  });

  test.each<[string, (id: string, deviceId: string) => Promise<unknown>, number]>([
    [
      'a later occurrence came due while it was paused',
      async () => {
        h.state.now = DUE + 25 * HOUR_MS;
      },
      DUE + 48 * HOUR_MS,
    ],
    [
      'its time was changed while it was paused',
      (id, deviceId) =>
        h.sync(deviceId, [{ type: 'put', id, fields: fields({ start: '2026-10-12T18:00', repeat: daily }) }]),
      DUE + 9 * HOUR_MS,
    ],
  ])('pushes held for an occurrence that is no longer due are dropped on resume: %s', async (_, meanwhile, next) => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.ok('subscribe', keys(1), deviceId);
    const id = await h.put(deviceId, { repeat: daily });
    h.state.status = () => 503;
    await h.runAlarm();
    await h.sync(deviceId, [{ type: 'pause', id, until: null }]);
    await meanwhile(id, deviceId);
    await h.sync(deviceId, [{ type: 'resume', id }]);
    expect(h.state.alarm).toBe(next);
  });

  test('a store from before pausing and agents is upgraded in place, and pausing works on it', async () => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.ok('subscribe', keys(1), deviceId);
    const id = await h.put(deviceId, { repeat: daily });
    h.state.status = () => 503;
    await h.runAlarm();
    h.db.run('ALTER TABLE deliveries DROP COLUMN held_at');
    h.db.run('ALTER TABLE devices DROP COLUMN kind');
    h.db.run('DROP TABLE agent_keys');
    h.db.run("UPDATE meta SET value = '1' WHERE key = 'schema'");
    h.restart();
    h.restart();
    const { reminders } = await h.sync(deviceId, [{ type: 'pause', id, until: null }]);
    expect(reminders.find((reminder) => reminder.id === id)?.paused).not.toBeNull();
    expect(h.state.alarm).toBeNull();
  });

  test('reminders stored before pausing existed load as not paused, and can be paused', async () => {
    const { phone } = await h.pair();
    const id = await h.put(phone, { repeat: daily });
    h.db.run("UPDATE reminders SET data = json_remove(data, '$.paused')");
    const { reminders } = await h.sync(phone, []);
    expect(reminders.find((reminder) => reminder.id === id)?.paused).toBeNull();
    await h.sync(phone, [{ type: 'pause', id, until: null }]);
    expect(h.state.alarm).toBeNull();
  });

  test('completing a reminder cancels the resends of its notification', async () => {
    const { phone } = await h.pair();
    const id = await h.put(phone);
    await h.runAlarm();
    await h.sync(phone, [{ type: 'complete', id, due: '2026-10-12T09:00' }]);
    h.state.now += RESEND_AFTER_MS + MINUTE_MS;
    await h.nudge.alarm();
    expect([h.sentTo(1), h.sentTo(2)]).toEqual([1, 1]);
  });

  test.each([false, true])(
    'occurrence escalation stays independent within the cooldown, first confirmed: %s',
    async (confirmed) => {
      const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
      await h.ok('subscribe', keys(1), deviceId);
      const first = await h.put(deviceId, { title: 'First' });
      await h.put(deviceId, { title: 'Second' });
      await h.runAlarm();
      if (confirmed) await h.ok('receipt', { fire: fireId(first, { at: DUE, due: TODAY }) }, deviceId);
      await h.runAlarm();
      await h.runAlarm();
      expect(h.state.alerts).toHaveLength(confirmed ? 1 : 2);
    },
  );

  test('a due reminder with no device to notify raises an alert', async () => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.put(deviceId);
    await h.runAlarm();
    expect(h.state.alerts).toHaveLength(1);
  });

  test('with no device to notify, each occurrence raises one alert per cooldown, not one per nag', async () => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.put(deviceId, { title: 'First', important: true });
    await h.put(deviceId, { title: 'Second', important: true, start: '2026-10-12T09:10' });
    await h.runAlarmsThrough(DUE + HOUR_MS - MINUTE_MS);
    expect(h.state.alerts).toHaveLength(2);
  });

  test('a subscription that expired while being replaced is retried on its replacement', async () => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.ok('subscribe', keys(1), deviceId);
    await h.put(deviceId);
    h.state.status = (target) => (target.endpoint === keys(1).endpoint ? 410 : 201);
    h.state.onPush = (target) => {
      if (target.endpoint === keys(1).endpoint) void h.ok('subscribe', keys(3), deviceId);
    };
    await h.runAlarm();
    await h.runAlarm();
    expect(h.sentTo(3)).toBe(1);
    expect(h.state.alerts).toHaveLength(0);
    expect(h.state.alarm).toBe(h.state.now + RESEND_AFTER_MS);
  });

  test('an endpoint taken over by a new enrollment is sent each notification once', async () => {
    const { phone, laptop } = await h.pair();
    await h.ok('subscribe', keys(1), laptop);
    await h.ok('test', { id: ulid(), delay: 1 }, phone);
    h.state.alarm = h.state.now + 1000;
    await h.runAlarm();
    expect(h.sentTo(1)).toBe(1);
  });

  test('test notifications are capped, go out on time, and replays return the original schedule', async () => {
    const { phone } = await h.pair();
    const [first = '', ...rest] = Array.from({ length: 5 }, () => ulid());
    const original = await h.ok('test', { id: first, delay: 30 }, phone);
    await Promise.all(rest.map((id, i) => h.ok('test', { id, delay: 31 + i }, phone)));
    expect(await h.call('test', { id: ulid(), delay: 30 }, phone)).toMatchObject({ ok: false, error: 'locked' });
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
