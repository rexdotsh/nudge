import { show } from '../../browser/notify';
import { fire, nextFireAt } from '../../shared/fire';
import { fireId, reminderMessage } from '../../shared/notification';
import { lateCount, type Reminder } from '../../shared/reminder';
import { HOUR_MS } from '../../shared/time';

const GRACE_MS = 45_000;
const MAX_WAIT_MS = HOUR_MS;

class Fallback {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly watermarks = new Map<string, number>();

  schedule(reminders: readonly Reminder[], zone: string, enabled: boolean): void {
    clearTimeout(this.timer);
    if (!enabled) return;
    let next = Infinity;
    for (const reminder of reminders) next = Math.min(next, nextFireAt(this.locally(reminder), zone) ?? Infinity);
    if (next === Infinity) return;
    const wait = Math.min(Math.max(0, next + GRACE_MS - Date.now()), MAX_WAIT_MS);
    this.timer = setTimeout(() => this.check(reminders, zone), wait);
  }

  private locally(reminder: Reminder): Reminder {
    const watermark = this.watermarks.get(reminder.id) ?? -Infinity;
    return watermark > reminder.firedThrough ? { ...reminder, firedThrough: watermark } : reminder;
  }

  // Deciding and rearming stay synchronous so a later schedule(…, false) can never be overtaken by this check.
  private check(reminders: readonly Reminder[], zone: string): void {
    const now = Date.now();
    const view = { origin: location.origin, zone, locale: navigator.language, badge: lateCount(reminders, now, zone) };
    for (const reminder of reminders) {
      const { reminder: advanced, notice } = fire(this.locally(reminder), now - GRACE_MS, zone);
      this.watermarks.set(reminder.id, advanced.firedThrough);
      if (!notice) continue;
      console.warn(`push for ${fireId(reminder.id, notice.at)} did not arrive; showing it locally`);
      const content = reminderMessage(advanced, notice, view).notification;
      void navigator.serviceWorker.ready.then((registration) => show(registration, content));
    }
    this.schedule(reminders, zone, true);
  }
}

export const fallback = new Fallback();
