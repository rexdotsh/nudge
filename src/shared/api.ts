import type { Op } from './ops';
import type { Reminder } from './reminder';

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

export interface DeviceInfo {
  id: string;
  label: string;
  platform: Platform;
  zone: string;
  createdAt: number;
  seenAt: number;
  push: { enabled: boolean; failures: number; okAt: number | null; receiptAt: number | null };
}

export interface DeliveryInfo {
  fire: string;
  title: string;
  deviceId: string;
  sentAt: number | null;
  status: number;
  receiptAt: number | null;
}

export interface Health {
  devices: DeviceInfo[];
  deliveries: DeliveryInfo[];
}

export interface Change {
  opId: string;
  op: Op;
}

export interface SyncRequest {
  since: number;
  zone: string;
  changes: Change[];
}

export interface SyncResponse {
  version: number;
  reminders: Reminder[];
  reset: boolean;
  rejected: number;
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
  test: { request: { delay: number }; response: { at: number } };
  receipt: { request: { fire: string }; response: null };
  sync: { request: SyncRequest; response: SyncResponse };
}

export type Routes = PublicRoutes & DeviceRoutes;
export type PublicRoute = keyof PublicRoutes;
export type DeviceRoute = keyof DeviceRoutes;
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
};

export function isPublicRoute(route: string): route is PublicRoute {
  return Object.hasOwn(PUBLIC, route);
}

export function isDeviceRoute(route: string): route is DeviceRoute {
  return Object.hasOwn(DEVICE, route);
}

export const API_ERRORS = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  locked: 429,
} as const;

export type ApiError = keyof typeof API_ERRORS;

export type Reply<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export const SOCKET_PROTOCOL = 'nudge';

export type ClientMessage = { kind: 'sync'; ref: string } & SyncRequest;

export type ServerMessage =
  | ({ kind: 'synced'; ref: string } & SyncResponse)
  | { kind: 'failed'; ref: string; error: ApiError }
  | { kind: 'changed'; version: number };
