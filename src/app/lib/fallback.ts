import { fire, nextFireAt } from '../../shared/fire';
import { fireId, reminderMessage, type NotificationContent } from '../../shared/notification';
import { lateCount, type Reminder } from '../../shared/reminder';
import { HOUR_MS } from '../../shared/time';

const GRACE_MS = 45_000;
const MAX_WAIT_MS = HOUR_MS;
const LOOKBACK_MS = HOUR_MS;
const READY_TIMEOUT_MS = 10_000;
const RETRY_MS = 60_000;

type Display = (content: NotificationContent) => Promise<void>;

export interface FallbackDeps {
  ready: () => Promise<Display>;
  claim: (fire: string) => Promise<boolean>;
  settle: (fire: string, shown: boolean) => Promise<void>;
  wait: (run: () => Promise<void>, ms: number) => () => void;
  now: () => number;
  origin: string;
  locale: string;
}

// The server advances firedThrough when it plans a push, not when the push arrives, so this ignores it and instead
// trusts only what this device has actually shown, through the claims the service worker shares.
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
    const now = this.deps.now();
    let next = Infinity;
    for (const reminder of reminders) next = Math.min(next, nextFireAt(this.locally(reminder, now), zone) ?? Infinity);
    if (next === Infinity) return;
    const generation = this.generation;
    const wait = Math.min(Math.max(0, next + GRACE_MS - now), MAX_WAIT_MS);
    this.cancel = this.deps.wait(() => this.check(reminders, zone, generation), wait);
  }

  private locally(reminder: Reminder, now: number): Reminder {
    const watermark = this.watermarks.get(reminder.id) ?? -Infinity;
    return { ...reminder, firedThrough: Math.max(watermark, reminder.createdAt, now - LOOKBACK_MS) };
  }

  private advance(id: string, firedThrough: number): void {
    this.watermarks.set(id, Math.max(this.watermarks.get(id) ?? -Infinity, firedThrough));
  }

  private async ready(): Promise<Display> {
    let cancel: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      cancel = this.deps.wait(async () => reject(new Error('the service worker is not ready')), READY_TIMEOUT_MS);
    });
    try {
      return await Promise.race([this.deps.ready(), timeout]);
    } finally {
      cancel?.();
    }
  }

  private async showOnce(key: string, content: NotificationContent, display: Display): Promise<void> {
    if (!(await this.deps.claim(key))) return;
    console.warn(`push for ${key} did not arrive; showing it locally`);
    // Not retried: if this device cannot show a notification, nothing else here can, and retrying would spin.
    const ok = await display(content).then(
      () => true,
      (error: unknown) => {
        console.error(`could not show ${key} locally`, error);
        return false;
      },
    );
    await this.deps.settle(key, ok);
  }

  private async check(reminders: readonly Reminder[], zone: string, generation: number): Promise<void> {
    let display: Display;
    try {
      display = await this.ready();
    } catch (error) {
      console.error('local fallback could not reach the service worker; retrying', error);
      if (generation === this.generation) {
        this.cancel = this.deps.wait(() => this.check(reminders, zone, generation), RETRY_MS);
      }
      return;
    }
    if (generation !== this.generation) return;
    const now = this.deps.now();
    const { origin, locale } = this.deps;
    const view = { origin, zone, locale, badge: lateCount(reminders, now, zone) };
    const shown: Promise<void>[] = [];
    for (const reminder of reminders) {
      const { reminder: advanced, notice } = fire(this.locally(reminder, now), now - GRACE_MS, zone);
      if (!notice) {
        this.advance(reminder.id, advanced.firedThrough);
        continue;
      }
      const key = fireId(reminder.id, notice.at);
      const content = reminderMessage(advanced, notice, view).notification;
      shown.push(
        this.showOnce(key, content, display)
          .catch((error: unknown) => console.error(`could not record ${key}`, error))
          .finally(() => this.advance(reminder.id, advanced.firedThrough)),
      );
    }
    await Promise.all(shown);
    if (generation === this.generation) this.arm(reminders, zone, true);
  }
}
