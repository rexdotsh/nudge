import {
  API_ERRORS,
  MAX_REQUEST_BYTES,
  SOCKET_PROTOCOL,
  isDeviceRoute,
  isPublicRoute,
  type ApiError,
  type Reply,
} from '../shared/api';
import { vapidKeys } from 'declarative-web-push/server';
import { readJson } from './body';
import { DEVICE_HEADER } from './nudge-do';
import { verifyToken } from './tokens';
import { buildInstaller, serveInstaller } from './windows';

export { NudgeDO } from './nudge-do';

const nudge = (env: Env) => env.NUDGE.get(env.NUDGE.idFromName('nudge'));

function reply(result: Reply<unknown>): Response {
  return Response.json(result, { status: result.ok ? 200 : API_ERRORS[result.error] });
}

const failure = (error: ApiError) => reply({ ok: false, error });

async function openSocket(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
  const [protocol, token] = (request.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map((part) => part.trim());
  const deviceId = protocol === SOCKET_PROTOCOL && token ? await verifyToken(env.AUTH_SECRET, token) : null;
  if (!deviceId) return new Response(null, { status: 401 });
  const headers = new Headers(request.headers);
  headers.set(DEVICE_HEADER, deviceId);
  return nudge(env).fetch(new Request(request.url, { headers }));
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/config') return Response.json({ vapidPublicKey: vapidKeys(env.VAPID_JWK).publicKey });
    if (url.pathname === '/api/socket') return openSocket(request, env);
    if (url.pathname === '/api/windows') {
      const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
      return serveInstaller(
        { method: request.method, origin: url.origin, token },
        {
          verify: (value) => verifyToken(env.AUTH_SECRET, value),
          enrolled: (deviceId) => nudge(env).isEnrolled(deviceId),
          build: (origin) => buildInstaller(origin),
        },
      );
    }

    const route = url.pathname.slice('/api/'.length);
    const isPublic = isPublicRoute(route);
    if (!isPublic && !isDeviceRoute(route)) return new Response('not found', { status: 404 });
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
    const bearer = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    const deviceId = isPublic ? null : await verifyToken(env.AUTH_SECRET, bearer);
    if (!isPublic && deviceId === null) return failure('unauthorized');
    const parsed = await readJson(request, MAX_REQUEST_BYTES);
    if (!parsed) return failure('bad_request');
    return reply(await nudge(env).call(route, { deviceId, origin: url.origin }, parsed.body));
  },

  async scheduled(_controller, env): Promise<void> {
    const { healthy } = await nudge(env).watchdog();
    if (env.HEALTHCHECK_URL) await fetch(healthy ? env.HEALTHCHECK_URL : `${env.HEALTHCHECK_URL}/fail`);
  },
} satisfies ExportedHandler<Env>;
