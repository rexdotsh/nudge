import type { ApiError, Reply, Route, Routes } from '../shared/api';
import { isRecord } from '../shared/validate';
import { get, set } from './kv';

export class ApiRejected extends Error {
  constructor(readonly code: ApiError) {
    super(`request rejected: ${code}`);
  }
}

export class Unreachable extends Error {}

const REQUEST_TIMEOUT_MS = 15_000;

export interface RequestOptions {
  keepalive?: boolean;
  token?: string;
}

export async function request<R extends Route>(
  route: R,
  body: Routes[R]['request'],
  options: RequestOptions = {},
): Promise<Routes[R]['response']> {
  const token = options.token ?? (await get('session'))?.token;
  let response: Response;
  try {
    response = await fetch(`/api/${route}`, {
      method: 'POST',
      keepalive: options.keepalive ?? false,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Unreachable(error instanceof Error ? error.message : 'network error');
  }
  if (!response.headers.get('Content-Type')?.includes('application/json')) {
    throw new Unreachable(`unexpected ${response.status} response`);
  }
  let reply: Reply<Routes[R]['response']>;
  try {
    reply = await response.json();
  } catch (error) {
    throw new Unreachable(error instanceof Error ? error.message : 'could not read the response');
  }
  if (!reply.ok) throw new ApiRejected(reply.error);
  return reply.data;
}

export async function vapidPublicKey(): Promise<string> {
  try {
    const response = await fetch('/api/config', { cache: 'no-store', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`push configuration responded ${response.status}`);
    const config: unknown = await response.json();
    if (!isRecord(config) || typeof config.vapidPublicKey !== 'string')
      throw new Error('push configuration has no key');
    const key = config.vapidPublicKey;
    await set('vapidPublicKey', key);
    return key;
  } catch (error) {
    const cached = await get('vapidPublicKey');
    if (cached) return cached;
    throw new Unreachable(error instanceof Error ? error.message : 'could not load the push key');
  }
}

const INSTALLER_TIMEOUT_MS = 120_000;

export async function windowsInstaller(): Promise<Blob> {
  const token = (await get('session'))?.token ?? '';
  try {
    const response = await fetch('/api/windows', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(INSTALLER_TIMEOUT_MS),
    });
    if (!response.ok) throw new Unreachable(`installer responded ${response.status}`);
    return await response.blob();
  } catch (error) {
    if (error instanceof Unreachable) throw error;
    throw new Unreachable(error instanceof Error ? error.message : 'could not download the installer');
  }
}
