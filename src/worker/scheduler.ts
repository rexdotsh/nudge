import { fire, nextFireAt, type Notice } from '../shared/fire';
import {
  fireId,
  occurrenceTopic,
  reminderMessage,
  testMessage,
  type Presentation,
  type PushMessage,
} from '../shared/notification';
import { isOverdue, type Reminder } from '../shared/reminder';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../shared/time';
import type { Runtime } from './runtime';
import type { DeliveryRow, Outgoing, Store, Target } from './store';
import type { PushResult } from './webpush';

export const DEAD_MAN_MS = MINUTE_MS;
export const LEASE_MS = 90_000;
export const RESEND_AFTER_MS = 2 * MINUTE_MS;
export const ESCALATE_AFTER_MS = 10 * MINUTE_MS;
const LATE_GRACE_MS = 2 * MINUTE_MS;
const RETRY_DELAYS_MS = [1000, 4000];
const ALERT_COOLDOWN_MS = HOUR_MS;
const PUSH_TTL_SECONDS = 24 * 3600;
const DELIVERY_RETENTION_MS = 14 * DAY_MS;
const TOMBSTONE_RETENTION_MS = 30 * DAY_MS;
const ALERT_RETRY_MS = 5 * MINUTE_MS;

const isOk = (status: number) => status >= 200 && status < 300;
const isRetryable = (status: number) => status === 0 || status === 429 || status >= 500;
const isGone = (status: number) => status === 404 || status === 410;
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

function outgoing(id: string, title: string, topic: string, message: PushMessage): Outgoing {
  return { fire: id, title, topic, payload: JSON.stringify(message) };
}

export class Scheduler {
  constructor(
    private readonly store: Store,
    private readonly runtime: Runtime,
  ) {}

  zone(): string {
    return this.store.meta('zone') ?? 'UTC';
  }

  setZone(zone: string): boolean {
    if (this.store.meta('zone') === zone) return false;
    this.store.setMeta('zone', zone);
    for (const reminder of this.store.reminders()) {
      if (reminder.zone === null) this.store.setFireAt(reminder.id, nextFireAt(reminder, zone));
    }
    return true;
  }

  save(reminder: Reminder, now: number): void {
    this.store.saveReminder(reminder, nextFireAt(reminder, this.zone()), now);
  }

  presentation(badge: number): Presentation {
    return {
      origin: this.store.meta('origin') ?? '',
      zone: this.zone(),
      locale: this.store.meta('locale') ?? 'en',
      badge,
    };
  }

  queueTest(testFire: string, at: number): void {
    const now = this.runtime.now();
    const item = outgoing(
      testFire,
      'Test notification',
      `test${at.toString(36)}`,
      testMessage(testFire, this.presentation(0)),
    );
    for (const target of this.store.targets()) this.store.queue(item, target.deviceId, at, now);
  }

  async rearm(): Promise<void> {
    const next = this.store.nextWake();
    const current = await this.runtime.alarm.get();
    if (next === null) {
      if (current !== null) await this.runtime.alarm.clear();
    } else if (current !== next) {
      await this.runtime.alarm.set(next);
    }
  }

  async run(): Promise<void> {
    const now = this.runtime.now();
    await this.runtime.alarm.set(now + DEAD_MAN_MS);
    try {
      await this.process(now);
    } catch (error) {
      await this.alertOnce('alarm', `The scheduler failed and will retry in a minute: ${describe(error)}`);
      return;
    }
    await this.rearm();
  }

  async watchdog(): Promise<{ healthy: boolean }> {
    const now = this.runtime.now();
    const late = this.store.lateCount(now - LATE_GRACE_MS);
    const stalled = !late && this.store.nextWake() !== null && (await this.runtime.alarm.get()) === null;
    if (late > 0) await this.run();
    else if (stalled) await this.rearm();
    this.runtime.transaction(() => {
      this.store.purgeDeliveries(now - DELIVERY_RETENTION_MS);
      if (this.store.purgeTombstones(now - TOMBSTONE_RETENTION_MS) > 0) {
        this.store.setMeta('purged', String(this.store.version()));
      }
    });
    if (late > 0) await this.alertOnce('late', `${late} notification(s) were late, sent them now.`);
    if (stalled) await this.alertOnce('stalled', 'The scheduler had no alarm set while work was pending, re-armed it.');
    return { healthy: late === 0 && !stalled };
  }

  private noticeFor(reminder: Reminder, notice: Notice, view: Presentation): Outgoing {
    return outgoing(
      fireId(reminder.id, notice.at),
      reminder.title,
      occurrenceTopic(reminder.id, notice.due),
      reminderMessage(reminder, notice, view),
    );
  }

  private async process(now: number): Promise<void> {
    const zone = this.zone();
    const fired = this.store.dueReminders(now).map((reminder) => fire(reminder, now, zone));
    const updated = new Map(fired.map(({ reminder }) => [reminder.id, reminder]));
    const badge = this.store
      .reminders()
      .map((reminder) => updated.get(reminder.id) ?? reminder)
      .filter((reminder) => !reminder.deleted && isOverdue(reminder, now, zone)).length;
    const view = this.presentation(badge);

    this.runtime.transaction(() => {
      const targets = this.store.targets();
      for (const { reminder, notice } of fired) {
        this.save(reminder, now);
        if (!notice) continue;
        const item = this.noticeFor(reminder, notice, view);
        for (const target of targets) this.store.queue(item, target.deviceId, now, now);
      }
    });
    if (fired.length > 0) this.runtime.broadcast({ kind: 'changed', version: this.store.version() });

    const lease = crypto.randomUUID();
    const claimed = this.runtime.transaction(() => this.store.claim(now, LEASE_MS, lease));
    await Promise.all(claimed.map((row) => (row.sends >= 2 ? this.escalate(row) : this.send(row))));
  }

  private async escalate(row: DeliveryRow): Promise<void> {
    const label = this.store.device(row.device_id)?.label ?? 'a device';
    const delivered = await this.alertOnce(
      `unconfirmed:${row.device_id}`,
      `"${label}" has not confirmed "${row.title}" after a resend.`,
    );
    this.store.release(row, delivered ? null : this.runtime.now() + ALERT_RETRY_MS);
  }

  private async send(row: DeliveryRow): Promise<void> {
    const target = this.store.target(row.device_id);
    if (!target) {
      this.store.release(row, null);
      return;
    }
    const result = await this.pushWithRetry(target, row);
    const ok = isOk(result.status);
    const gone = isGone(result.status);
    const now = this.runtime.now();
    const followUp = row.sends === 0 ? RESEND_AFTER_MS : ESCALATE_AFTER_MS;
    const owned = this.runtime.transaction(() => {
      if (!this.store.recordSend(row, result.status, ok ? now + followUp : null, now)) return false;
      this.store.recordPush(target, ok, gone, now);
      return true;
    });
    if (!owned) return;
    if (gone) {
      await this.alertOnce(
        `gone:${target.deviceId}`,
        `Notifications stopped on "${target.label}" (the subscription expired). Open Nudge there to turn them back on.`,
      );
    } else if (!ok) {
      await this.alertOnce(
        `failed:${target.deviceId}`,
        `Push to "${target.label}" failed: ${result.status} ${result.detail}`,
      );
    }
  }

  private async pushWithRetry(target: Target, row: DeliveryRow, delays = RETRY_DELAYS_MS): Promise<PushResult> {
    const result = await this.attempt(target, row);
    const [delay, ...later] = delays;
    if (delay === undefined || !isRetryable(result.status)) return result;
    await this.runtime.sleep(delay);
    if (this.store.target(target.deviceId)?.endpoint !== target.endpoint) return result;
    return this.pushWithRetry(target, row, later);
  }

  private async attempt(target: Target, row: DeliveryRow): Promise<PushResult> {
    try {
      return await this.runtime.push(target, row.payload, this.store.meta('origin') ?? '', {
        ttl: PUSH_TTL_SECONDS,
        urgency: 'high',
        topic: row.topic,
      });
    } catch (error) {
      return { status: 0, detail: describe(error) };
    }
  }

  private readonly alerting = new Map<string, Promise<boolean>>();

  alertOnce(key: string, text: string): Promise<boolean> {
    let pending = this.alerting.get(key);
    if (!pending) {
      pending = this.deliverAlert(key, text).finally(() => this.alerting.delete(key));
      this.alerting.set(key, pending);
    }
    return pending;
  }

  private async deliverAlert(key: string, text: string): Promise<boolean> {
    const now = this.runtime.now();
    const metaKey = `alert:${key}`;
    if (now - Number(this.store.meta(metaKey) ?? 0) < ALERT_COOLDOWN_MS) return true;
    const host = URL.parse(this.store.meta('origin') ?? '')?.host ?? 'nudge';
    try {
      await this.runtime.alert(`⚠️ ${host}: ${text}`);
    } catch (error) {
      console.error(`alert could not be delivered: ${describe(error)}`);
      return false;
    }
    this.store.setMeta(metaKey, String(now));
    return true;
  }
}
