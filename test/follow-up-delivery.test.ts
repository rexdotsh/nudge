import { beforeEach, describe, expect, test } from 'bun:test';
import type { FollowUpSetting } from '../src/shared/fire';
import { fireId } from '../src/shared/notification';
import { HOUR_MS, MINUTE_MS } from '../src/shared/time';
import { ulid } from '../src/shared/ulid';
import { LEASE_MS, RESEND_AFTER_MS } from '../src/worker/scheduler';
import { SETUP_CODE, ZONE, device, harness, keys } from './harness';

const DUE = Date.UTC(2026, 9, 12, 3, 30);
const TODAY = '2026-10-12T09:00';

let h: ReturnType<typeof harness>;
beforeEach(() => {
  h = harness();
});

const chooseFollowUp = (deviceId: string, followUp: unknown, choice = { id: ulid(), at: h.state.now }) =>
  h.ok('sync', { since: 0, zone: ZONE, changes: [], followUpChoice: { ...choice, followUp } }, deviceId);

describe('the follow-up setting', () => {
  test('follow-ups are off until chosen; a choice applies once, neither its replay nor an older offline choice undoes a newer one, and it replans what waits', async () => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.put(deviceId);
    expect((await h.sync(deviceId, [])).followUp).toBe('off');
    await h.runAlarm();
    expect(h.state.alarm).toBeNull();
    expect((await chooseFollowUp(deviceId, 30)).followUp).toBe(30);
    expect(h.state.alarm).toBe(DUE + 30 * MINUTE_MS);
    h.state.now += MINUTE_MS;
    const fast = { id: ulid(), at: h.state.now + HOUR_MS };
    expect((await chooseFollowUp(deviceId, 60, fast)).followUp).toBe(60);
    h.state.now += MINUTE_MS;
    expect((await chooseFollowUp(deviceId, 120)).followUp).toBe(120);
    expect((await chooseFollowUp(deviceId, 60, fast)).followUp).toBe(120);
    const madeOffline = { id: ulid(), at: h.state.now - 2 * MINUTE_MS };
    expect((await chooseFollowUp(deviceId, 'off', madeOffline)).followUp).toBe(120);
    expect(h.state.alarm).toBe(DUE + 120 * MINUTE_MS);
  });
});

describe('follow-up delivery', () => {
  test.each([false, true])('a reminder not done is followed up once under its tag, done first: %s', async (done) => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.ok('subscribe', keys(1, 'apple'), deviceId);
    await chooseFollowUp(deviceId, 30);
    const id = await h.put(deviceId);
    await h.runAlarm();
    h.state.now += 10 * MINUTE_MS;
    if (done) await h.sync(deviceId, [{ type: 'complete', id, due: TODAY }]);
    await h.runAlarmsThrough(DUE + 4 * HOUR_MS);
    const sent = done ? [DUE] : [DUE, DUE + 30 * MINUTE_MS];
    const { pushes } = h.state;
    expect(pushes.map(({ message }) => message.notification.data.fire)).toEqual(
      sent.map((at) => fireId(id, { at, due: TODAY })),
    );
    expect(new Set(pushes.map(({ message }) => message.notification.tag))).toEqual(new Set([`${id}:${TODAY}`]));
  });

  test.each<[string, (deviceId: string) => Promise<unknown>]>([
    ['its delay grows', (deviceId) => chooseFollowUp(deviceId, 120)],
    [
      'follow-ups are turned off and back on with a longer delay',
      async (deviceId) => {
        await chooseFollowUp(deviceId, 'off');
        h.state.now += MINUTE_MS;
        await chooseFollowUp(deviceId, 120);
      },
    ],
  ])('a follow-up that went out is not sent again when %s', async (_, change) => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.ok('subscribe', keys(1, 'apple'), deviceId);
    await chooseFollowUp(deviceId, 30);
    await h.put(deviceId);
    await h.runAlarmsThrough(DUE + 40 * MINUTE_MS);
    expect(h.sentTo(1, 'apple')).toBe(2);
    await change(deviceId);
    await h.runAlarmsThrough(DUE + 4 * HOUR_MS);
    expect(h.sentTo(1, 'apple')).toBe(2);
  });

  test.each<[string, FollowUpSetting, boolean, number]>([
    ['turning follow-ups off stops it', 'off', false, 0],
    ['turning follow-ups off stops it, even when a crashed run holds its lease', 'off', true, 0],
    ['a new delay lets it go on, and brings no other follow-up', 120, false, 1],
  ])('a follow-up still being resent: %s', async (_, setting, crashed, resent) => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    await h.ok('subscribe', keys(1), deviceId);
    await chooseFollowUp(deviceId, 30);
    const id = await h.put(deviceId);
    await h.runAlarm();
    await h.ok('receipt', { fire: fireId(id, { at: DUE, due: TODAY }) }, deviceId);
    h.state.status = () => 503;
    await h.runAlarmsThrough(DUE + 30 * MINUTE_MS);
    const followUp = fireId(id, { at: DUE + 30 * MINUTE_MS, due: TODAY });
    expect(h.state.alarm).toBe(DUE + 30 * MINUTE_MS + RESEND_AFTER_MS);
    if (crashed) {
      h.db
        .query("UPDATE deliveries SET lease = 'crashed', next_at = ? WHERE fire = ?")
        .run(h.state.now + LEASE_MS, followUp);
    }
    await chooseFollowUp(deviceId, setting);
    h.state.status = () => 201;
    const before = h.state.pushes.length;
    await h.runAlarmsThrough(DUE + 4 * HOUR_MS);
    const later = h.state.pushes.slice(before).map(({ message }) => message.notification.data.fire);
    expect(later).toEqual(Array.from({ length: resent }, () => followUp));
  });

  test.each([
    ['no device has notifications on', false, 120, 0],
    ['no device confirms it', true, 120, 0],
    ['no device has notifications on and the first run comes after the follow-up', false, 30, 40 * MINUTE_MS],
  ])('an occurrence raises one alert, follow-up included, when %s', async (_, subscribed, setting, late) => {
    const { deviceId } = await h.ok('setup', { code: SETUP_CODE, device: device('iPhone') });
    if (subscribed) await h.ok('subscribe', keys(1), deviceId);
    await chooseFollowUp(deviceId, setting);
    await h.put(deviceId);
    h.state.now = DUE + late;
    await h.nudge.alarm();
    await h.runAlarmsThrough(DUE + 4 * HOUR_MS);
    expect(h.state.alerts).toHaveLength(1);
  });
});
