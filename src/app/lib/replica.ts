import type { Schema } from '../../browser/schema';
import type { Change } from '../../shared/api';
import type { SyncResponse } from '../../shared/api';
import { applyOp } from '../../shared/ops';
import type { Reminder } from '../../shared/reminder';

export class Replica {
  private readonly server = new Map<string, Reminder>();
  version = 0;

  constructor(snapshot?: Schema['replica']) {
    if (!snapshot) return;
    this.version = snapshot.version;
    for (const reminder of snapshot.reminders) this.server.set(reminder.id, reminder);
  }

  receive(response: SyncResponse): void {
    if (response.reset) this.server.clear();
    for (const reminder of response.reminders) this.server.set(reminder.id, reminder);
    this.version = response.version;
  }

  snapshot(): Schema['replica'] {
    return { version: this.version, reminders: [...this.server.values()] };
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
