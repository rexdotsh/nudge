import type { ApiError, Reply, Route, Routes } from '../shared/api';
import { get, set } from './kv';

export class ApiRejected extends Error {
  constructor(readonly code: ApiError) {
    super(`request rejected: ${code}`);
  }
}

export class Unreachable extends Error {}

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
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Unreachable(error instanceof Error ? error.message : 'network error');
  }
  if (!response.headers.get('Content-Type')?.includes('application/json')) {
    throw new Unreachable(`unexpected ${response.status} response`);
  }
  const reply: Reply<Routes[R]['response']> = await response.json();
  if (!reply.ok) throw new ApiRejected(reply.error);
  return reply.data;
}

export async function vapidPublicKey(): Promise<string> {
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    const { vapidPublicKey: key }: { vapidPublicKey: string } = await response.json();
    await set('vapidPublicKey', key);
    return key;
  } catch (error) {
    const cached = await get('vapidPublicKey');
    if (cached) return cached;
    throw new Unreachable(error instanceof Error ? error.message : 'could not load the push key');
  }
}
