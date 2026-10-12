import { fire, nextFireAt } from '../../shared/fire';
import { fireId, reminderMessage, type NotificationContent } from '../../shared/notification';
import { lateCount, type Reminder } from '../../shared/reminder';
import { HOUR_MS } from '../../shared/time';

const GRACE_MS = 45_000;
const MAX_WAIT_MS = HOUR_MS;

type Display = (content: NotificationContent) => Promise<void>;

export interface FallbackDeps {
  ready: () => Promise<Display>;
  wait: (run: () => Promise<void>, ms: number) => () => void;
  now: () => number;
  origin: string;
  locale: string;
}

export class Fallback {
  private cancel = () => {};
  private generation = 0;
  private readonly watermarks = new Map<string, number>();

  constructor(private readonly deps: FallbackDeps) {}

  schedule(reminders: readonly Reminder[], zone: string, enabled: boolean): void {
    this.generation++;
    this.arm(reminders, zone, enabled);
  }

  private arm(reminders: readonly Reminder[], zone: string, enabled: boolean): void {
    this.cancel();
    if (!enabled) return;
    let next = Infinity;
    for (const reminder of reminders) next = Math.min(next, nextFireAt(this.locally(reminder), zone) ?? Infinity);
    if (next === Infinity) return;
    const generation = this.generation;
    const wait = Math.min(Math.max(0, next + GRACE_MS - this.deps.now()), MAX_WAIT_MS);
    this.cancel = this.deps.wait(() => this.check(reminders, zone, generation), wait);
  }

  private locally(reminder: Reminder): Reminder {
    const watermark = this.watermarks.get(reminder.id) ?? -Infinity;
    return watermark > reminder.firedThrough ? { ...reminder, firedThrough: watermark } : reminder;
  }

  private async check(reminders: readonly Reminder[], zone: string, generation: number): Promise<void> {
    const display = await this.deps.ready();
    if (generation !== this.generation) return;
    const now = this.deps.now();
    const { origin, locale } = this.deps;
    const view = { origin, zone, locale, badge: lateCount(reminders, now, zone) };
    for (const reminder of reminders) {
      const { reminder: advanced, notice } = fire(this.locally(reminder), now - GRACE_MS, zone);
      this.watermarks.set(reminder.id, advanced.firedThrough);
      if (!notice) continue;
      console.warn(`push for ${fireId(reminder.id, notice.at)} did not arrive; showing it locally`);
      void display(reminderMessage(advanced, notice, view).notification);
    }
    this.arm(reminders, zone, true);
  }
}
