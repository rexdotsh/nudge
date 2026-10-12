import type { Change, Session } from '../shared/api';
import type { Reminder } from '../shared/reminder';

export interface Schema {
  session: Session;
  installKey: string;
  vapidPublicKey: string;
  replica: { version: number; reminders: Reminder[] };
  pending: Change[];
  zone: { name: string; since: number };
}
