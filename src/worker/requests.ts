import {
  MAX_CHANGES,
  PLATFORMS,
  type ApiError,
  type Change,
  type DeviceInput,
  type DeviceRoute,
  type DeviceRoutes,
  type PublicRoute,
  type PublicRoutes,
  type PushKeys,
  type SyncRequest,
} from '../shared/api';
import { BASE64URL } from '../shared/encoding';
import { parseOp } from '../shared/input';
import { isTimeZone } from '../shared/time';
import { isUlid } from '../shared/ulid';
import { isInteger, isRecord, isText } from '../shared/validate';
import { isPushServiceEndpoint } from './webpush';

export class ApiFailure extends Error {
  constructor(readonly code: ApiError) {
    super(code);
  }
}

function invalid(): never {
  throw new ApiFailure('bad_request');
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : invalid();
}

function isLocale(value: unknown): value is string {
  if (!isText(value, 35, 2)) return false;
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

function base64urlLength(value: unknown, bytes: number): value is string {
  if (!isText(value, 200, 1)) return false;
  try {
    return Uint8Array.fromBase64(value, BASE64URL).length === bytes;
  } catch {
    return false;
  }
}

function deviceInput(value: unknown): DeviceInput {
  const { key, label, platform, zone, locale } = record(value);
  const known = PLATFORMS.find((candidate) => candidate === platform);
  if (!isText(key, 64, 22) || !/^[\w-]+$/.test(key)) invalid();
  if (!isText(label, 60, 1) || !known || !isText(zone, 64) || !isTimeZone(zone) || !isLocale(locale)) invalid();
  return { key, label: label.trim(), platform: known, zone, locale };
}

function enrollment(value: unknown): { code: string; device: DeviceInput } {
  const body = record(value);
  if (!isText(body.code, 64, 1)) invalid();
  return { code: body.code.trim().toUpperCase(), device: deviceInput(body.device) };
}

function pushKeys(value: unknown): PushKeys | null {
  if (value === null) return null;
  const { endpoint, p256dh, auth } = record(value);
  if (!isText(endpoint, 2000) || !isPushServiceEndpoint(endpoint) || !base64urlLength(p256dh, 65)) invalid();
  if (!base64urlLength(auth, 16)) invalid();
  return { endpoint, p256dh, auth };
}

function change(value: unknown): Change {
  const { opId, op } = record(value);
  return isUlid(opId) ? { opId, op: parseOp(op) ?? invalid() } : invalid();
}

function syncRequest(value: unknown): SyncRequest {
  const { since, zone, changes } = record(value);
  if (!isInteger(since, 0, Number.MAX_SAFE_INTEGER) || !isText(zone, 64) || !isTimeZone(zone)) invalid();
  if (!Array.isArray(changes) || changes.length > MAX_CHANGES) invalid();
  return { since, zone, changes: changes.map(change) };
}

export const PUBLIC_REQUESTS: { [R in PublicRoute]: (body: unknown) => PublicRoutes[R]['request'] } = {
  setup: enrollment,
  join: enrollment,
};

export const DEVICE_REQUESTS: { [R in DeviceRoute]: (body: unknown) => DeviceRoutes[R]['request'] } = {
  pair: () => null,
  subscribe: pushKeys,
  health: () => null,
  revoke: (body) => {
    const { id } = record(body);
    return isUlid(id) ? { id } : invalid();
  },
  test: (body) => {
    const { id, delay } = record(body);
    return isUlid(id) && isInteger(delay, 0, 3600) ? { id, delay } : invalid();
  },
  receipt: (body) => {
    const { fire } = record(body);
    return isText(fire, 80, 1) ? { fire } : invalid();
  },
  sync: syncRequest,
};
