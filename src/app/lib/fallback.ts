import { fire, nextFireAt } from '../../shared/fire';
import { fireId, reminderMessage, type NotificationContent } from '../../shared/notification';
import type { Claim } from '../../browser/schema';
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
  claim: (fire: string) => Promise<Claim>;
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

  private arm(reminders: readonly Reminder[], zone: string, enabled: boolean, atLeast = 0): void {
    this.cancel();
    if (!enabled) return;
    const now = this.deps.now();
    let next = Infinity;
    for (const reminder of reminders) next = Math.min(next, nextFireAt(this.locally(reminder, now), zone) ?? Infinity);
    if (next === Infinity) return;
    const generation = this.generation;
    const wait = Math.min(Math.max(atLeast, next + GRACE_MS - now), MAX_WAIT_MS);
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

  private async showOnce(
    key: string,
    content: NotificationContent,
    display: Display,
    generation: number,
  ): Promise<boolean> {
    const claimed = await this.deps.claim(key);
    if (claimed !== 'won') return claimed === 'seen';
    if (generation !== this.generation) {
      await this.deps.settle(key, false);
      return false;
    }
    console.warn(`push for ${key} did not arrive; showing it locally`);
    const ok = await display(content).then(
      () => true,
      (error: unknown) => {
        console.error(`could not show ${key} locally`, error);
        return false;
      },
    );
    await this.deps.settle(key, ok);
    return ok;
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
    const outcomes: Promise<boolean>[] = [];
    for (const reminder of reminders) {
      const { reminder: advanced, notices } = fire(this.locally(reminder, now), now - GRACE_MS, zone);
      const shown = notices.map((notice) => {
        const key = fireId(reminder.id, notice.at);
        return this.showOnce(key, reminderMessage(advanced, notice, view).notification, display, generation).catch(
          (error: unknown) => {
            console.error(`could not record ${key}`, error);
            return false;
          },
        );
      });
      outcomes.push(
        Promise.all(shown).then((done) => {
          const all = done.every(Boolean);
          if (all) this.advance(reminder.id, advanced.firedThrough);
          return all;
        }),
      );
    }
    // A fire that is busy elsewhere or failed to show stays unconsumed and is retried until it leaves the lookback.
    const retry = (await Promise.all(outcomes)).includes(false);
    if (generation === this.generation) this.arm(reminders, zone, true, retry ? RETRY_MS : 0);
  }
}
