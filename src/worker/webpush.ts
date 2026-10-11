import { BASE64URL, utf8 } from '../shared/encoding';
import { isRecord } from '../shared/validate';
import { memoize } from './memoize';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: Promise<CryptoKey>;
}

export interface Sender {
  keys: VapidKeys;
  subject: string;
}

export interface PushOptions {
  ttl: number;
  urgency: 'very-low' | 'low' | 'normal' | 'high';
  topic: string;
}

export interface PushResult {
  status: number;
  detail: string;
}

const PUSH_SERVICE_HOSTS = [
  /(^|\.)push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /\.notify\.windows\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
];

export function isPushServiceEndpoint(endpoint: string): boolean {
  const url = URL.parse(endpoint);
  return url?.protocol === 'https:' && PUSH_SERVICE_HOSTS.some((host) => host.test(url.hostname));
}

interface PrivateEcJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  d: string;
}

function isPrivateEcJwk(value: unknown): value is PrivateEcJwk {
  return (
    isRecord(value) &&
    value.kty === 'EC' &&
    value.crv === 'P-256' &&
    [value.x, value.y, value.d].every((part) => typeof part === 'string')
  );
}

export const vapidKeys = memoize((json): VapidKeys => {
  const jwk: unknown = JSON.parse(json);
  if (!isPrivateEcJwk(jwk)) throw new Error('VAPID key must be a P-256 private JWK');
  const point = concat(
    new Uint8Array([4]),
    Uint8Array.fromBase64(jwk.x, BASE64URL),
    Uint8Array.fromBase64(jwk.y, BASE64URL),
  );
  return {
    publicKey: point.toBase64(BASE64URL),
    privateKey: crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']),
  };
});

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: ArrayBuffer | Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  bytes: number,
) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

export async function encrypt(
  plaintext: Uint8Array,
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  salt: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(16)),
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = Uint8Array.fromBase64(target.p256dh, BASE64URL);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  if (!('privateKey' in local)) throw new Error('ECDH generateKey did not return a key pair');
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // workers-types spells the ECDH peer key `$public`; the runtime and every other implementation read `public`.
  const ecdh = { name: 'ECDH', public: uaKey, $public: uaKey };
  const [rawPublic, shared] = await Promise.all([
    crypto.subtle.exportKey('raw', local.publicKey),
    crypto.subtle.deriveBits(ecdh, local.privateKey, 256),
  ]);
  if (!(rawPublic instanceof ArrayBuffer)) throw new Error('ECDH raw export did not return bytes');
  const asPublic = new Uint8Array(rawPublic);

  const ikm = await hkdf(
    Uint8Array.fromBase64(target.auth, BASE64URL),
    shared,
    concat(utf8('WebPush: info\0'), uaPublic, asPublic),
    32,
  );
  const [cek, nonce] = await Promise.all([
    hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16),
    hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12),
  ]);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const record = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    aes,
    concat(plaintext, new Uint8Array([2])),
  );

  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, new Uint8Array(record));
}

const JWT_LIFETIME = 12 * 3600_000;
const JWT_RENEW_BEFORE = 3600_000;
const jwts = new Map<string, { token: string; expires: number }>();

function jwtPart(value: object): string {
  return utf8(JSON.stringify(value)).toBase64(BASE64URL);
}

export async function vapidAuthorization(endpoint: string, sender: Sender, now = Date.now()): Promise<string> {
  const aud = new URL(endpoint).origin;
  const cacheKey = `${sender.keys.publicKey} ${sender.subject} ${aud}`;
  let jwt = jwts.get(cacheKey);
  if (!jwt || jwt.expires - now < JWT_RENEW_BEFORE) {
    const expires = now + JWT_LIFETIME;
    const unsigned = `${jwtPart({ typ: 'JWT', alg: 'ES256' })}.${jwtPart({ aud, exp: Math.floor(expires / 1000), sub: sender.subject })}`;
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      await sender.keys.privateKey,
      utf8(unsigned),
    );
    jwt = { token: `${unsigned}.${new Uint8Array(signature).toBase64(BASE64URL)}`, expires };
    jwts.set(cacheKey, jwt);
  }
  return `vapid t=${jwt.token}, k=${sender.keys.publicKey}`;
}

export async function sendPush(
  target: PushTarget,
  json: string,
  sender: Sender,
  options: PushOptions,
): Promise<PushResult> {
  const [body, authorization] = await Promise.all([
    encrypt(utf8(json), target),
    vapidAuthorization(target.endpoint, sender),
  ]);
  const response = await fetch(target.endpoint, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Authorization: authorization,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(options.ttl),
      Urgency: options.urgency,
      Topic: options.topic,
    },
    body,
  });
  return { status: response.status, detail: response.ok ? '' : (await response.text()).slice(0, 200) };
}
