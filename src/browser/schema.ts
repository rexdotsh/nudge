import type { Change, Session } from '../shared/api';
import type { Reminder } from '../shared/reminder';

export interface PendingChange extends Change {
  at: number;
}

export interface Schema {
  session: Session;
  installKey: string;
  vapidPublicKey: string;
  replica: { version: number; reminders: Reminder[] };
  pending: PendingChange[];
  zone: { name: string; since: number };
}
