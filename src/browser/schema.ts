import type {
  Change,
  FollowUpChoice,
  Health,
  InstanceZone,
  Session,
  Theme,
  ThemeChoice,
  ZoneChoice,
} from '../shared/api';
import type { FollowUpSetting } from '../shared/fire';
import type { StoredReminder } from '../shared/reminder';

export interface Snapshot {
  version: number;
  reminders: StoredReminder[];
  /** The instance zone, from the same response as the reminders; absent before the first sync and in older saves. */
  zone?: InstanceZone;
  /** The instance's follow-up, from the same response; absent before the first sync and in older saves. */
  followUp?: FollowUpSetting;
}

export interface Local {
  replica: Snapshot;
  pending: Change[];
}

export type Claim = 'seen' | 'busy' | 'won';

export interface Notices {
  seen: string[];
  claims: Record<string, number>;
}

export interface ThemeState {
  theme: Theme;
  version: number;
  pending: ThemeChoice | null;
}

export const EMPTY_LOCAL: Local = { replica: { version: 0, reminders: [] }, pending: [] };

export interface Schema {
  session: Session;
  installKey: string;
  vapidPublicKey: string;
  /** Read and written by bundles from before pausing, which may still be open in another tab; see `legacy.ts`. */
  local: Local;
  state: Local;
  notices: Notices;
  zone: { name: string; since: number };
  /** A zone choice made on this device and not yet answered by a sync. */
  zoneChoice: ZoneChoice | null;
  /** A follow-up setting chosen on this device and not yet answered by a sync. */
  followUpChoice: FollowUpChoice | null;
  zoneControls: boolean;
  health: Health;
  theme: ThemeState;
}
