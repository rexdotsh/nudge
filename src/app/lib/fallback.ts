import { show } from '../../browser/notify';
import { fire, nextFireAt } from '../../shared/fire';
import { fireId, reminderMessage } from '../../shared/notification';
import { isOverdue, type Reminder } from '../../shared/reminder';
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
    this.timer = setTimeout(() => void this.check(reminders, zone), wait);
  }

  private locally(reminder: Reminder): Reminder {
    const watermark = this.watermarks.get(reminder.id) ?? -Infinity;
    return watermark > reminder.firedThrough ? { ...reminder, firedThrough: watermark } : reminder;
  }

  private async check(reminders: readonly Reminder[], zone: string): Promise<void> {
    const now = Date.now();
    const registration = await navigator.serviceWorker.ready;
    const badge = reminders.filter((reminder) => !reminder.deleted && isOverdue(reminder, now, zone)).length;
    const view = { origin: location.origin, zone, locale: navigator.language, badge };
    const missed = reminders.flatMap((reminder) => {
      const { reminder: advanced, notice } = fire(this.locally(reminder), now - GRACE_MS, zone);
      this.watermarks.set(reminder.id, advanced.firedThrough);
      if (!notice) return [];
      console.warn(`push for ${fireId(reminder.id, notice.at)} did not arrive; showing it locally`);
      return [show(registration, reminderMessage(advanced, notice, view).notification)];
    });
    await Promise.all(missed);
    this.schedule(reminders, zone, true);
  }
}

export const fallback = new Fallback();
