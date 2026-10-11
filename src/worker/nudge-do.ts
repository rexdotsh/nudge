import { DurableObject } from 'cloudflare:workers';
import { SOCKET_PROTOCOL, type Route } from '../shared/api';
import { sendTelegram } from './alerts';
import { Nudge, type Caller } from './nudge';
import { DEVICE_HEADER } from './runtime';
import { sendPush, vapidKeys } from './webpush';

export class NudgeDO extends DurableObject<Env> {
  private readonly nudge: Nudge;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    const keys = vapidKeys(env.VAPID_JWK);
    this.nudge = new Nudge({
      sql: ctx.storage.sql,
      transaction: (run) => ctx.storage.transactionSync(run),
      alarm: {
        get: () => ctx.storage.getAlarm(),
        set: (at) => ctx.storage.setAlarm(at),
        clear: () => ctx.storage.deleteAlarm(),
      },
      broadcast: (message, except) => {
        const text = JSON.stringify(message);
        for (const socket of ctx.getWebSockets()) if (!ctx.getTags(socket).includes(except ?? '')) socket.send(text);
      },
      disconnect: (deviceId) => {
        for (const socket of ctx.getWebSockets(deviceId)) socket.close(4001, 'device revoked');
      },
      push: (target, json, subject, options) => sendPush(target, json, { keys, subject }, options),
      alert: (text) => sendTelegram(env, text),
      sleep: (ms) => scheduler.wait(ms),
      now: () => Date.now(),
      secrets: { auth: env.AUTH_SECRET, setupCode: env.SETUP_CODE },
    });
  }

  call(route: Route, caller: Caller, body: unknown) {
    return this.nudge.call(route, caller, body);
  }

  watchdog() {
    return this.nudge.watchdog();
  }

  override alarm(): Promise<void> {
    return this.nudge.alarm();
  }

  override fetch(request: Request): Response {
    const deviceId = request.headers.get(DEVICE_HEADER);
    if (!deviceId || !this.nudge.canConnect(deviceId)) return new Response(null, { status: 401 });
    const [client, server] = Object.values(new WebSocketPair());
    if (!client || !server) throw new Error('WebSocketPair did not return two sockets');
    this.ctx.acceptWebSocket(server, [deviceId]);
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'Sec-WebSocket-Protocol': SOCKET_PROTOCOL },
    });
  }

  override async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const [deviceId] = this.ctx.getTags(socket);
    if (!deviceId || typeof message !== 'string') {
      socket.close(1003, 'unsupported message');
      return;
    }
    socket.send(JSON.stringify(await this.nudge.message(deviceId, message)));
  }
}
