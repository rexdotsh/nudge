import { canReplace, pushOutcome, type SendResult } from 'declarative-web-push/server';
import type { InstanceZone } from '../shared/api';
import { fire, nextFireAt, type Notice } from '../shared/fire';
import {
  fireId,
  occurrenceTopic,
  reminderMessage,
  testMessage,
  type Presentation,
  type PushMessage,
} from '../shared/notification';
import { applyOp, type Op } from '../shared/ops';
import { lateCount, movedZone, type Reminder } from '../shared/reminder';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../shared/time';
import type { DeliveryRow, Outgoing } from './deliveries';
import type { Target } from './devices';
import type { Runtime } from './runtime';
import type { Store } from './store';

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

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

function outgoing(id: string, title: string, topic: string, message: PushMessage): Outgoing {
  return { fire: id, title, topic, payload: JSON.stringify(message) };
}

function occurrenceAlertKey(problem: string, delivery: Pick<Outgoing, 'topic'>): string {
  return `${problem}:${delivery.topic}`;
}

export class Scheduler {
  constructor(
    private readonly store: Store,
    private readonly runtime: Runtime,
  ) {}

  zone(): string {
    return this.store.zone().name;
  }

  /** Moves the zone to where a device now is, unless it was fixed. */
  follow(zone: string): void {
    if (!this.store.zone().fixed) this.setZone({ name: zone, fixed: false });
  }

  /** The latest choice wins by when it was made, so a device coming back online cannot undo a newer one. */
  chooseZone(choice: string | null, here: string, at: number): void {
    if (at < Number(this.store.meta('zone_chosen_at') ?? 0)) return;
    this.store.setMeta('zone_chosen_at', String(at));
    this.setZone({ name: choice ?? here, fixed: choice !== null });
  }

  private setZone(zone: InstanceZone): void {
    const previous = this.store.meta('zone');
    this.store.setZone(zone);
    if (previous === zone.name) return;
    for (const reminder of this.store.reminders()) {
      if (reminder.zone === null) this.save(previous === null ? reminder : movedZone(reminder, previous, zone.name));
    }
  }

  save(reminder: Reminder): void {
    this.store.saveReminder(reminder, nextFireAt(reminder, this.zone()));
  }

  /**
   * Saves a change and settles what is queued for the reminder: a pause holds it, ending the pause goes on with it if
   * the same occurrence is still due, and any other change that settles the occurrence cancels it.
   */
  saveChange(previous: Reminder | undefined, next: Reminder, settles: boolean): void {
    this.save(next);
    const { deliveries } = this.store;
    if (next.paused && !next.deleted) deliveries.holdForReminder(next.id);
    else if (previous?.paused && !next.paused && previous.due === next.due && next.due !== null) {
      deliveries.releaseForReminder(next.id, occurrenceTopic(next.id, next.due));
    } else if (settles || previous?.paused) deliveries.cancelForReminder(next.id);
  }

  /** Applies an op made at `at` and records it as applied, returning the reminder it changed, if it changed one. */
  commit(opId: string, op: Op, at: number, now: number): Reminder | null {
    const previous = this.store.reminder(op.id);
    const next = applyOp(previous, op, { now: at, zone: this.zone() });
    if (next) this.saveChange(previous, next, op.type !== 'put' || previous?.due !== next.due);
    this.store.recordApplied(opId, now);
    return next;
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
      // An occurrence alerts once for as long as it lasts, however long it is snoozed.
      const live = this.store
        .reminders()
        .flatMap((reminder) =>
          reminder.deleted || reminder.due === null
            ? []
            : [`alert:${occurrenceAlertKey('unconfirmed', { topic: occurrenceTopic(reminder.id, reminder.due) })}`],
        );
      this.store.purgeAlertMarks(now - DAY_MS, 'alert:unconfirmed:', new Set(live));
    });
    if (late > 0) await this.alertOnce('late', `${late} notification(s) were late, sent them now.`);
    if (stalled) await this.alertOnce('stalled', 'The scheduler had no alarm set while work was pending, re-armed it.');
    return { healthy: late === 0 && !stalled };
  }

  private noticeFor(reminder: Reminder, notice: Notice, view: Presentation): Outgoing {
    return outgoing(
      fireId(reminder.id, notice),
      reminder.title,
      occurrenceTopic(reminder.id, notice.due),
      reminderMessage(reminder, notice, view),
    );
  }

  private async process(now: number): Promise<void> {
    const zone = this.zone();
    const fired = this.store.dueReminders(now).map((previous) => {
      const { reminder, notices } = fire(previous, now, zone);
      return { previous, reminder, notices };
    });
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
      for (const { previous, reminder, notices } of fired) {
        this.saveChange(previous, reminder, false);
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
    const pending = claimed.filter((row) => {
      const endpoint = this.store.devices.target(row.device_id)?.endpoint;
      if (row.sends > 0 && pushOutcome(row.status) === 'sent' && endpoint !== undefined && !canReplace(endpoint)) {
        this.store.deliveries.settle(row, row.sent_at ?? now);
        return false;
      }
      return true;
    });
    await Promise.all(pending.filter((row) => row.sends < 2).map((row) => this.send(row)));
    await Promise.all(pending.filter((row) => row.sends >= 2).map((row) => this.escalate(row)));
  }

  private async escalate(row: DeliveryRow): Promise<void> {
    if (!this.store.deliveries.owns(row)) return;
    if (this.store.deliveries.reached(row.topic) || !this.store.devices.get(row.device_id)) {
      this.store.deliveries.release(row, null);
      return;
    }
    const silent = this.store.deliveries
      .silentDevices(row.topic)
      .flatMap((id) => this.store.devices.get(id)?.label ?? [])
      .map((label) => `"${label}"`);
    const delivered = await this.alertOnce(
      occurrenceAlertKey('unconfirmed', row),
      `No device confirmed "${row.title}" after a resend. Silent devices: ${silent.join(', ')}.`,
      Infinity,
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
    const ok = result.outcome === 'sent';
    const gone = result.outcome === 'gone';
    const now = this.runtime.now();
    const current = this.store.devices.target(row.device_id);
    if (gone && current !== undefined && current.endpoint !== target.endpoint) {
      this.store.deliveries.release(row, now);
      return;
    }
    const followUp = row.sends === 0 ? RESEND_AFTER_MS : ESCALATE_AFTER_MS;
    const settled = ok && !canReplace(target.endpoint);
    const nextAt = (ok && !settled) || result.outcome === 'retry' ? now + followUp : null;
    const owned = this.runtime.transaction(() => {
      if (!this.store.deliveries.recordSend(row, result.status, nextAt, now, settled)) return false;
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

  private async pushWithRetry(target: Target, row: DeliveryRow, delays = RETRY_DELAYS_MS): Promise<SendResult> {
    const result = await this.attempt(target, row);
    const [delay, ...later] = delays;
    if (delay === undefined || result.outcome !== 'retry') return result;
    await this.runtime.sleep(delay);
    if (!this.store.deliveries.owns(row) || this.store.devices.target(target.deviceId)?.endpoint !== target.endpoint) {
      return result;
    }
    return this.pushWithRetry(target, row, later);
  }

  private async attempt(target: Target, row: DeliveryRow): Promise<SendResult> {
    try {
      return await this.runtime.push(target, row.payload, this.origin(), {
        ttl: PUSH_TTL_SECONDS,
        urgency: 'high',
        topic: row.topic,
      });
    } catch (error) {
      return { status: 0, outcome: 'retry', detail: describe(error) };
    }
  }

  private readonly alerting = new Map<string, Promise<boolean>>();

  private alertOnce(key: string, text: string, cooldown = ALERT_COOLDOWN_MS): Promise<boolean> {
    let pending = this.alerting.get(key);
    if (!pending) {
      pending = this.deliverAlert(key, text, cooldown).finally(() => this.alerting.delete(key));
      this.alerting.set(key, pending);
    }
    return pending;
  }

  private async deliverAlert(key: string, text: string, cooldown: number): Promise<boolean> {
    const now = this.runtime.now();
    const metaKey = `alert:${key}`;
    const previous = this.store.meta(metaKey);
    if (previous !== null && now - Number(previous) < cooldown) return true;
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
