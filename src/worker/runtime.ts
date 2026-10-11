import type { ServerMessage } from '../shared/api';
import type { Sql } from './store';
import type { PushOptions, PushResult, PushTarget } from './webpush';

export const DEVICE_HEADER = 'X-Nudge-Device';

export interface Runtime {
  sql: Sql;
  transaction: <T>(run: () => T) => T;
  alarm: {
    get: () => Promise<number | null>;
    set: (at: number) => Promise<void>;
    clear: () => Promise<void>;
  };
  broadcast: (message: ServerMessage, except?: string) => void;
  disconnect: (deviceId: string) => void;
  push: (target: PushTarget, json: string, subject: string, options: PushOptions) => Promise<PushResult>;
  alert: (text: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  secrets: { auth: string; setupCode: string };
}
