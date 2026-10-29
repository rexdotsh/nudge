import { API_ERRORS, MAX_REQUEST_BYTES, type AgentRoute, type Reply } from '../shared/api';
import type { AgentEnvelope } from './agent-requests';
import { readJson } from './body';

interface Endpoint {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: RegExp;
  route: AgentRoute;
  action?: string;
}

const ID = '(?<id>[^/]+)';

const ENDPOINTS: Endpoint[] = [
  { method: 'GET', path: /^\/api\/v1\/today$/, route: 'today' },
  { method: 'GET', path: /^\/api\/v1\/reminders$/, route: 'list' },
  { method: 'POST', path: /^\/api\/v1\/reminders$/, route: 'create' },
  { method: 'GET', path: new RegExp(`^/api/v1/reminders/${ID}$`), route: 'get' },
  { method: 'PATCH', path: new RegExp(`^/api/v1/reminders/${ID}$`), route: 'update' },
  { method: 'DELETE', path: new RegExp(`^/api/v1/reminders/${ID}$`), route: 'act', action: 'delete' },
  { method: 'POST', path: new RegExp(`^/api/v1/reminders/${ID}/(?<action>[a-z]+)$`), route: 'act' },
];

export interface AgentDeps {
  verify: (token: string) => Promise<string | null>;
  call: (route: AgentRoute, deviceId: string, envelope: AgentEnvelope) => Promise<Reply<unknown>>;
}

const problem = (status: number, error: string, headers?: HeadersInit) => Response.json({ error }, { status, headers });

export async function serveAgent(request: Request, token: string, deps: AgentDeps): Promise<Response> {
  const url = new URL(request.url);
  const found = ENDPOINTS.flatMap((endpoint) => {
    const match = endpoint.path.exec(url.pathname);
    return match ? [{ endpoint, params: match.groups ?? {} }] : [];
  });
  if (found.length === 0) return problem(404, 'not found');
  const chosen = found.find(({ endpoint }) => endpoint.method === request.method);
  if (!chosen)
    return problem(405, 'method not allowed', { Allow: found.map(({ endpoint }) => endpoint.method).join(', ') });
  const deviceId = token === '' ? null : await deps.verify(token);
  if (deviceId === null) return problem(401, 'unauthorized: send Authorization: Bearer $NUDGE_TOKEN');
  const parsed = request.method === 'GET' ? { body: null } : await readJson(request, MAX_REQUEST_BYTES);
  if (!parsed) return problem(400, 'the body must be JSON');
  const { endpoint, params } = chosen;
  const reply = await deps.call(endpoint.route, deviceId, {
    id: params.id ?? null,
    action: endpoint.action ?? params.action ?? null,
    key: request.headers.get('Idempotency-Key'),
    query: Object.fromEntries(url.searchParams),
    body: parsed.body,
  });
  if (reply.ok) return Response.json(reply.data, { status: endpoint.route === 'create' ? 201 : 200 });
  const body = reply.error === 'conflict' ? { error: reply.message, current: reply.current } : { error: reply.message };
  return Response.json(body, { status: API_ERRORS[reply.error] });
}
