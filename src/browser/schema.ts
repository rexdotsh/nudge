import type { Change } from '../shared/api';
import type { Reminder } from '../shared/reminder';

export interface PendingChange extends Change {
  at: number;
}

export interface Schema {
  session: { token: string; deviceId: string };
  installKey: string;
  vapidPublicKey: string;
  replica: { version: number; reminders: Reminder[] };
  pending: PendingChange[];
  zone: { name: string; since: number };
}
