import { fire, nextFireAt, type Notice } from '../shared/fire';
import {
  fireId,
  occurrenceTopic,
  reminderMessage,
  testMessage,
  type Presentation,
  type PushMessage,
} from '../shared/notification';
import { lateCount, type Reminder } from '../shared/reminder';
import { DAY_MS, HOUR_MS, MINUTE_MS, toInstant, toLocal } from '../shared/time';
import type { DeliveryRow, Outgoing } from './deliveries';
import type { Target } from './devices';
import type { Runtime } from './runtime';
import type { Store } from './store';
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
const ALERT_RETRY_MS = 5 * MINUTE_MS;

const isOk = (status: number) => status >= 200 && status < 300;
const isRetryable = (status: number) => status === 0 || status === 429 || status >= 500;
const isGone = (status: number) => status === 404 || status === 410;
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

function outgoing(id: string, title: string, topic: string, message: PushMessage): Outgoing {
  return { fire: id, title, topic, payload: JSON.stringify(message) };
}

// Every fire of an occurrence (its early alerts, due notice and nags) replaces the last on screen, so a problem
// delivering one of them is one problem with the occurrence, reported once per cooldown rather than once per nag.
function occurrenceAlertKey(problem: string, delivery: Pick<Outgoing, 'topic'>): string {
  return `${problem}:${delivery.topic}`;
}

export class Scheduler {
  constructor(
    private readonly store: Store,
    private readonly runtime: Runtime,
  ) {}

  private zone(): string {
    return this.store.meta('zone') ?? 'UTC';
  }

  // Floating reminders keep their wall time when the instance zone changes, so what has already fired must move with
  // it: otherwise flying west re-fires an occurrence and flying east silently skips one.
  setZone(zone: string): void {
    const previous = this.store.meta('zone');
    if (previous === zone) return;
    this.store.setMeta('zone', zone);
    for (const reminder of this.store.reminders()) {
      if (reminder.zone !== null) continue;
      const firedThrough =
        previous === null ? reminder.firedThrough : toInstant(toLocal(reminder.firedThrough, previous), zone);
      this.save({ ...reminder, firedThrough });
    }
  }

  save(reminder: Reminder): void {
    this.store.saveReminder(reminder, nextFireAt(reminder, this.zone()));
  }

  private origin(): string {
    return this.store.meta('origin') ?? '';
  }

  private presentation(badge: number): Presentation {
    return {
      origin: this.origin(),
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
    for (const target of this.store.devices.targets()) this.store.deliveries.queue(item, target.deviceId, at, now);
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
      this.store.deliveries.purge(now - DELIVERY_RETENTION_MS);
      this.store.purgeAlertMarks(now - DAY_MS);
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
    const badge = lateCount(
      this.store.reminders().map((reminder) => updated.get(reminder.id) ?? reminder),
      now,
      zone,
    );
    const view = this.presentation(badge);

    const unreached = this.runtime.transaction(() => {
      const targets = this.store.devices.targets();
      const missed: Outgoing[] = [];
      for (const { reminder, notices } of fired) {
        this.save(reminder);
        for (const notice of notices) {
          const item = this.noticeFor(reminder, notice, view);
          if (targets.length === 0) missed.push(item);
          for (const target of targets) this.store.deliveries.queue(item, target.deviceId, now, now);
        }
      }
      return missed;
    });
    if (fired.length > 0) this.runtime.broadcast({ kind: 'changed', version: this.store.version() });
    await Promise.all(
      unreached.map((item) =>
        this.alertOnce(
          occurrenceAlertKey('unreached', item),
          `No device has notifications on, so "${item.title}" was not sent.`,
        ),
      ),
    );

    const lease = crypto.randomUUID();
    const claimed = this.runtime.transaction(() => this.store.deliveries.claim(now, LEASE_MS, lease));
    await Promise.all(claimed.map((row) => (row.sends >= 2 ? this.escalate(row) : this.send(row))));
  }

  private async escalate(row: DeliveryRow): Promise<void> {
    const device = this.store.devices.get(row.device_id);
    if (!device) {
      this.store.deliveries.release(row, null);
      return;
    }
    const delivered = await this.alertOnce(
      occurrenceAlertKey(`unconfirmed:${row.device_id}`, row),
      `"${device.label}" has not confirmed "${row.title}" after a resend.`,
    );
    this.store.deliveries.release(row, delivered ? null : this.runtime.now() + ALERT_RETRY_MS);
  }

  private async send(row: DeliveryRow): Promise<void> {
    const target = this.store.devices.target(row.device_id);
    if (!target) {
      this.store.deliveries.release(row, null);
      return;
    }
    const result = await this.pushWithRetry(target, row);
    const ok = isOk(result.status);
    const gone = isGone(result.status);
    const now = this.runtime.now();
    const current = this.store.devices.target(row.device_id);
    if (gone && current !== undefined && current.endpoint !== target.endpoint) {
      this.store.deliveries.release(row, now);
      return;
    }
    const followUp = row.sends === 0 ? RESEND_AFTER_MS : ESCALATE_AFTER_MS;
    const nextAt = (ok && target.confirms) || isRetryable(result.status) ? now + followUp : null;
    const owned = this.runtime.transaction(() => {
      if (!this.store.deliveries.recordSend(row, result.status, nextAt, now)) return false;
      if (gone) this.store.devices.dropSubscription(target);
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
    if (this.store.devices.target(target.deviceId)?.endpoint !== target.endpoint) return result;
    return this.pushWithRetry(target, row, later);
  }

  private async attempt(target: Target, row: DeliveryRow): Promise<PushResult> {
    try {
      return await this.runtime.push(target, row.payload, this.origin(), {
        ttl: PUSH_TTL_SECONDS,
        urgency: 'high',
        topic: row.topic,
      });
    } catch (error) {
      return { status: 0, detail: describe(error) };
    }
  }

  private readonly alerting = new Map<string, Promise<boolean>>();

  private alertOnce(key: string, text: string): Promise<boolean> {
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
    const host = URL.parse(this.origin())?.host ?? 'nudge';
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
