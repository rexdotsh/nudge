import type { Op } from './ops';
import type { Reminder, ReminderFields, Repeat } from './reminder';

export const PLATFORMS = ['ios', 'windows', 'mac', 'android', 'other'] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface DeviceInput {
  key: string;
  label: string;
  platform: Platform;
  zone: string;
  locale: string;
}

export interface Session {
  token: string;
  deviceId: string;
}

export interface PushKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type DeviceInfo =
  | { kind: 'device'; id: string; label: string; push: { enabled: boolean; receiptAt: number | null } }
  | { kind: 'agent'; id: string; label: string; usedAt: number | null };

export interface Health {
  devices: DeviceInfo[];
}

export const MAX_CHANGES = 200;
export const MAX_REQUEST_BYTES = 256 * 1024;

export interface Change {
  opId: string;
  op: Op;
  at: number;
}

export const THEMES = ['classic', 'rex', 'rex-light'] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = 'classic';

/** A theme picked on one device, sent with every sync until a response to one of them arrives. */
export interface ThemeChoice {
  id: string;
  theme: Theme;
  at: number;
}

export interface SyncRequest {
  since: number;
  zone: string;
  changes: Change[];
  theme: ThemeChoice | null;
}

export interface SyncResponse {
  version: number;
  reminders: Reminder[];
  reset: boolean;
  theme: Theme;
}

export interface PublicRoutes {
  setup: { request: { code: string; device: DeviceInput }; response: Session };
  join: { request: { code: string; device: DeviceInput }; response: Session };
}

export interface DeviceRoutes {
  pair: { request: null; response: { code: string; expiresAt: number } };
  subscribe: { request: PushKeys | null; response: null };
  health: { request: null; response: Health };
  revoke: { request: { id: string }; response: null };
  test: { request: { id: string; delay: number }; response: { at: number } };
  receipt: { request: { fire: string }; response: null };
  sync: { request: SyncRequest; response: SyncResponse };
  agent: { request: { id: string; name: string }; response: { token: string } };
}

/** A reminder as agents see it: its fields, plus what they mean right now. Instants carry the zone's offset. */
export interface AgentReminder extends Omit<ReminderFields, 'repeat'> {
  id: string;
  rev: number;
  /** The occurrence that is current, as a wall time in the reminder's zone; null once a one-off is done. */
  due: string | null;
  dueAt: string | null;
  late: boolean;
  done: boolean;
  snoozedUntil: string | null;
  repeat: (Repeat & { text: string }) | null;
  paused: { since: string; until: string | null } | null;
  deleted: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Snapshot {
  zone: string;
  now: string;
}

export const REMINDER_STATUSES = ['open', 'done', 'deleted', 'all'] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

/** When a snooze or pause ends: a span from when it starts counting, a wall time in the instance zone, or an instant. */
export type Moment = { after: number } | { wall: string } | { at: number };

export type AgentAction =
  | { type: 'complete' | 'skip' | 'reopen'; due: string | null }
  | { type: 'snooze'; due: string | null; until: Moment }
  | { type: 'pause'; until: Moment | null }
  | { type: 'resume' | 'delete' | 'restore' };

/** What typed text was read as, so an agent can confirm it. */
export interface Understood {
  title: string;
  when: string | null;
  repeat: string | null;
  important: boolean;
  /** False when the text named no time and the reminder took the default one. */
  timed: boolean;
}

export interface AgentRoutes {
  list: {
    request: { status: ReminderStatus; q: string; limit: number };
    response: Snapshot & { reminders: AgentReminder[] };
  };
  today: {
    request: null;
    response: Snapshot & { late: AgentReminder[]; today: AgentReminder[]; next: AgentReminder | null };
  };
  get: { request: { id: string }; response: AgentReminder };
  create: {
    request: { key: string | null; text: string | null; fields: Partial<ReminderFields> };
    response: { reminder: AgentReminder; understood: Understood | null };
  };
  update: {
    request: { id: string; key: string | null; rev: number; fields: Partial<ReminderFields> };
    response: AgentReminder;
  };
  act: { request: { id: string; key: string | null; action: AgentAction }; response: AgentReminder };
}

export type Routes = PublicRoutes & DeviceRoutes & AgentRoutes;
export type PublicRoute = keyof PublicRoutes;
export type DeviceRoute = keyof DeviceRoutes;
export type AgentRoute = keyof AgentRoutes;
export type Route = keyof Routes;

const PUBLIC: Record<PublicRoute, true> = { setup: true, join: true };
const DEVICE: Record<DeviceRoute, true> = {
  pair: true,
  subscribe: true,
  health: true,
  revoke: true,
  test: true,
  receipt: true,
  sync: true,
  agent: true,
};
const AGENT: Record<AgentRoute, true> = { list: true, today: true, get: true, create: true, update: true, act: true };

export function isPublicRoute(route: string): route is PublicRoute {
  return Object.hasOwn(PUBLIC, route);
}

export function isDeviceRoute(route: string): route is DeviceRoute {
  return Object.hasOwn(DEVICE, route);
}

export function isAgentRoute(route: string): route is AgentRoute {
  return Object.hasOwn(AGENT, route);
}

export const API_ERRORS = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  locked: 429,
} as const;

export type ApiError = keyof typeof API_ERRORS;

type Failure =
  | { ok: false; error: Exclude<ApiError, 'conflict'>; message: string }
  | { ok: false; error: 'conflict'; message: string; current: AgentReminder };

export type Reply<T> = { ok: true; data: T } | Failure;

export const SOCKET_PROTOCOL = 'nudge';

export type ClientMessage = { kind: 'sync'; ref: string } & SyncRequest;

export type ServerMessage =
  | ({ kind: 'synced'; ref: string } & SyncResponse)
  | { kind: 'failed'; ref: string; error: ApiError }
  | { kind: 'changed'; version: number };
