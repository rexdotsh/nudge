import type { Change, InstanceZone, SyncResponse } from '../shared/api';
import { applyOp } from '../shared/ops';
import { fromStored, type Reminder } from '../shared/reminder';
import type { Snapshot } from './schema';

export class Replica {
  private readonly server = new Map<string, Reminder>();
  version = 0;
  zone: InstanceZone | null = null;

  constructor(snapshot?: Snapshot) {
    if (!snapshot) return;
    this.version = snapshot.version;
    this.zone = snapshot.zone ?? null;
    for (const reminder of snapshot.reminders) this.server.set(reminder.id, fromStored(reminder));
  }

  receive(response: SyncResponse, since = this.version): void {
    if (response.version < this.version && !(response.reset && this.version >= since)) return;
    if (response.reset) this.server.clear();
    for (const reminder of response.reminders) this.server.set(reminder.id, reminder);
    this.version = response.version;
    this.zone = response.zone;
  }

  snapshot(): Snapshot {
    return { version: this.version, reminders: [...this.server.values()], zone: this.zone ?? undefined };
  }

  /**
   * The zone this device may plan notifications in: only one the server confirmed, never one guessed from where the
   * device is now, which the server may not adopt. Null before the first sync, or after an older bundle saved the
   * replica without it, until the next sync brings it back.
   */
  plannedZone(): string | null {
    return this.zone?.name ?? null;
  }

  view(pending: readonly Change[], zone: string): Reminder[] {
    const merged = new Map(this.server);
    for (const { op, at } of pending) {
      const next = applyOp(merged.get(op.id), op, { now: at, zone });
      if (next) merged.set(next.id, next);
    }
    return [...merged.values()];
  }
}
