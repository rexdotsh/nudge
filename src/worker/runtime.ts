import type { PushKeys, ServerMessage } from '../shared/api';
import type { Sql } from './sql';
import type { SendOptions, SendResult } from 'declarative-web-push/server';

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
  push: (target: PushKeys, json: string, subject: string, options: SendOptions) => Promise<SendResult>;
  alert: (text: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  secrets: { auth: string; setupCode: string };
}
