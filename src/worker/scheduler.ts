import { fire, nextFireAt } from '../shared/fire';
import { fireId, reminderMessage, testMessage, type Presentation, type PushMessage } from '../shared/notification';
import { isOverdue, type Reminder } from '../shared/reminder';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../shared/time';
import type { Runtime } from './runtime';
import type { DeliveryRow, Store, Target } from './store';
import type { PushResult } from './webpush';

export const DEAD_MAN_MS = MINUTE_MS;
export const RESEND_AFTER_MS = 2 * MINUTE_MS;
export const ESCALATE_AFTER_MS = 10 * MINUTE_MS;
export const LATE_GRACE_MS = 2 * MINUTE_MS;
export const RETRY_DELAYS_MS = [1000, 4000];
const ALERT_COOLDOWN_MS = HOUR_MS;
const PUSH_TTL_SECONDS = 24 * 3600;
const DELIVERY_RETENTION_MS = 14 * DAY_MS;
const TOMBSTONE_RETENTION_MS = 30 * DAY_MS;

interface Outgoing {
  fire: string;
  title: string;
  topic: string;
  message: PushMessage;
}

interface Send {
  target: Target;
  row: DeliveryRow;
}

const isOk = (status: number) => status >= 200 && status < 300;
const isRetryable = (status: number) => status === 0 || status === 429 || status >= 500;
const isGone = (status: number) => status === 404 || status === 410;
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class Scheduler {
  constructor(
    private readonly store: Store,
    private readonly runtime: Runtime,
  ) {}

  zone(): string {
    return this.store.latestDevice()?.zone ?? 'UTC';
  }

  save(reminder: Reminder, now: number): void {
    this.store.saveReminder(reminder, nextFireAt(reminder, this.zone()), now);
  }

  refloat(): void {
    const zone = this.zone();
    for (const reminder of this.store.reminders()) {
      if (reminder.zone === null) this.store.setFireAt(reminder.id, nextFireAt(reminder, zone));
    }
  }

  async rearm(): Promise<void> {
    const next = this.store.nextWake(RESEND_AFTER_MS, ESCALATE_AFTER_MS);
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
    const stalled =
      this.store.nextWake(RESEND_AFTER_MS, ESCALATE_AFTER_MS) !== null && (await this.runtime.alarm.get()) === null;
    if (late > 0) {
      await this.alertOnce('late', `${late} notification(s) were late, sending them now.`);
      await this.run();
    } else if (stalled) {
      await this.alertOnce('stalled', 'The scheduler had no alarm set while work was pending, re-armed it.');
      await this.rearm();
    }
    this.runtime.transaction(() => {
      this.store.purgeDeliveries(now - DELIVERY_RETENTION_MS);
      if (this.store.purgeTombstones(now - TOMBSTONE_RETENTION_MS) > 0) {
        this.store.setMeta('purged', String(this.store.version()));
      }
    });
    return { healthy: late === 0 && !stalled };
  }

  presentation(badge: number): Presentation {
    const device = this.store.latestDevice();
    return {
      origin: this.store.meta('origin') ?? '',
      zone: device?.zone ?? 'UTC',
      locale: device?.locale ?? 'en',
      badge,
    };
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
    const targets = this.store.targets();
    const sends: Send[] = [];

    this.runtime.transaction(() => {
      for (const { reminder } of fired) this.save(reminder, now);
      const outgoing: Outgoing[] = [
        ...fired.flatMap(({ reminder, notice }) =>
          notice
            ? [
                {
                  fire: fireId(reminder.id, notice.at),
                  title: reminder.title,
                  topic: reminder.id,
                  message: reminderMessage(reminder, notice, view),
                },
              ]
            : [],
        ),
        ...this.store.takeProbes(now).map((at) => ({
          fire: fireId('test', at),
          title: 'Test notification',
          topic: 'test',
          message: testMessage(at, view),
        })),
      ];
      for (const item of outgoing) {
        for (const target of targets) {
          const row: DeliveryRow = {
            fire: item.fire,
            device_id: target.deviceId,
            title: item.title,
            topic: item.topic,
            payload: JSON.stringify(item.message),
            sent_at: now,
            status: 0,
            attempts: 1,
            receipt_at: null,
          };
          this.store.insertDelivery(row);
          sends.push({ target, row });
        }
      }
    });

    if (fired.length > 0) this.runtime.broadcast({ kind: 'changed', version: this.store.version() });
    await Promise.all([...sends.map((send) => this.send(send)), this.followUp(now, targets)]);
  }

  private async followUp(now: number, targets: Target[]): Promise<void> {
    const byDevice = new Map(targets.map((target) => [target.deviceId, target]));
    const resends: Send[] = [];
    const escalations: { row: DeliveryRow; label: string }[] = [];
    this.runtime.transaction(() => {
      for (const row of this.store.unconfirmed(1, now - RESEND_AFTER_MS)) {
        const target = byDevice.get(row.device_id);
        this.store.markAttempts(row.fire, row.device_id, target ? 2 : 3, now);
        if (target) resends.push({ target, row });
      }
      for (const row of this.store.unconfirmed(2, now - ESCALATE_AFTER_MS)) {
        this.store.markAttempts(row.fire, row.device_id, 3, now);
        escalations.push({ row, label: byDevice.get(row.device_id)?.label ?? 'a device' });
      }
    });
    await Promise.all([
      ...resends.map((send) => this.send(send)),
      ...escalations.map(({ row, label }) =>
        this.alertOnce(`unconfirmed:${row.device_id}`, `"${label}" has not confirmed "${row.title}" after a resend.`),
      ),
    ]);
  }

  private async send({ target, row }: Send): Promise<void> {
    const result = await this.pushWithRetry(target, row);
    const ok = isOk(result.status);
    const gone = isGone(result.status);
    this.runtime.transaction(() => {
      this.store.setDeliveryStatus(row.fire, target.deviceId, result.status);
      if (ok) this.store.recordPushOk(target.deviceId, this.runtime.now());
      else this.store.recordPushFailure(target.deviceId);
      if (gone) this.store.setSubscription(target.deviceId, null);
    });
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

  async alertOnce(key: string, text: string): Promise<void> {
    const now = this.runtime.now();
    const metaKey = `alert:${key}`;
    if (now - Number(this.store.meta(metaKey) ?? 0) < ALERT_COOLDOWN_MS) return;
    this.store.setMeta(metaKey, String(now));
    const host = URL.parse(this.store.meta('origin') ?? '')?.host ?? 'nudge';
    await this.runtime.alert(`⚠️ ${host}: ${text}`);
  }
}
