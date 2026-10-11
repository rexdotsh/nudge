import { request } from '../../browser/api';
import { SOCKET_PROTOCOL, type ServerMessage, type SyncRequest, type SyncResponse } from '../../shared/api';
import { ulid } from '../../shared/ulid';
import { isRecord } from '../../shared/validate';

const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 15_000, 30_000];
const KEEPALIVE_MS = 30_000;
const REPLY_TIMEOUT_MS = 8000;

interface Waiting {
  resolve: (response: SyncResponse) => void;
  reject: (error: Error) => void;
}

function isServerMessage(value: unknown): value is ServerMessage {
  return isRecord(value) && (value.kind === 'synced' || value.kind === 'failed' || value.kind === 'changed');
}

export class Connection {
  private socket: WebSocket | null = null;
  private readonly waiting = new Map<string, Waiting>();
  private attempt = 0;
  private keepalive: ReturnType<typeof setInterval> | undefined;
  private closed = false;

  constructor(
    private readonly token: string,
    private readonly onChanged: (version: number) => void,
    private readonly onOpen: () => void,
  ) {}

  open(): void {
    if (this.closed || (this.socket && this.socket.readyState <= WebSocket.OPEN)) return;
    const url = new URL('/api/socket', location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, [SOCKET_PROTOCOL, this.token]);
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.attempt = 0;
      clearInterval(this.keepalive);
      this.keepalive = setInterval(() => socket.send('ping'), KEEPALIVE_MS);
      this.onOpen();
    });
    socket.addEventListener('message', (event) => this.receive(String(event.data)));
    socket.addEventListener('close', () => this.dropped(socket));
  }

  close(): void {
    this.closed = true;
    this.socket?.close();
  }

  resume(): void {
    this.closed = false;
    this.open();
  }

  async sync(body: SyncRequest): Promise<SyncResponse> {
    const socket = this.socket;
    if (socket?.readyState !== WebSocket.OPEN) return request('sync', body);
    const ref = ulid();
    const reply = new Promise<SyncResponse>((resolve, reject) => {
      this.waiting.set(ref, { resolve, reject });
      setTimeout(() => this.settle(ref, new Error('socket reply timed out')), REPLY_TIMEOUT_MS);
    });
    socket.send(JSON.stringify({ kind: 'sync', ref, ...body }));
    return reply.catch(() => request('sync', body));
  }

  private receive(text: string): void {
    if (text === 'pong') return;
    const message: unknown = JSON.parse(text);
    if (!isServerMessage(message)) return;
    if (message.kind === 'changed') this.onChanged(message.version);
    else if (message.kind === 'synced') this.settle(message.ref, message);
    else this.settle(message.ref, new Error(`sync failed: ${message.error}`));
  }

  private settle(ref: string, outcome: SyncResponse | Error): void {
    const waiting = this.waiting.get(ref);
    if (!waiting) return;
    this.waiting.delete(ref);
    if (outcome instanceof Error) waiting.reject(outcome);
    else waiting.resolve(outcome);
  }

  private dropped(socket: WebSocket): void {
    if (this.socket !== socket) return;
    clearInterval(this.keepalive);
    this.socket = null;
    for (const ref of this.waiting.keys()) this.settle(ref, new Error('socket closed'));
    if (this.closed) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)] ?? 30_000;
    this.attempt++;
    setTimeout(() => this.open(), delay);
  }
}
