import type { Change, Session } from '../shared/api';
import type { Reminder } from '../shared/reminder';

export interface Snapshot {
  version: number;
  reminders: Reminder[];
}

export interface Local {
  replica: Snapshot;
  pending: Change[];
}

export const EMPTY_LOCAL: Local = { replica: { version: 0, reminders: [] }, pending: [] };

export interface Schema {
  session: Session;
  installKey: string;
  vapidPublicKey: string;
  local: Local;
  seen: string[];
  zone: { name: string; since: number };
}
