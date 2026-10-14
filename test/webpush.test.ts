import { describe, expect, spyOn, test } from 'bun:test';
import { decrypt } from 'http_ece';
import { createECDH } from 'node:crypto';
import { BASE64URL, utf8 } from '../src/shared/encoding';
import {
  MAX_PUSH_PLAINTEXT,
  canReplace,
  encrypt,
  isPushServiceEndpoint,
  sendPush,
  vapidAuthorization,
  vapidKeys,
} from '../src/worker/webpush';

async function newVapidJwk(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
}

function newReceiver() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    ecdh,
    auth,
    target: { p256dh: new Uint8Array(ecdh.getPublicKey()).toBase64(BASE64URL), auth: auth.toBase64(BASE64URL) },
  };
}

function decodeJson(part: string): unknown {
  return JSON.parse(new TextDecoder().decode(Uint8Array.fromBase64(part, BASE64URL)));
}

describe('encrypt', () => {
  test('round-trips through the RFC 8188 reference implementation', async () => {
    const receiver = newReceiver();
    const plaintext = JSON.stringify({ title: 'Pay rent 🏠', body: 'x'.repeat(2000) });

    const body = await encrypt(utf8(plaintext), receiver.target);
    const decrypted = decrypt(Buffer.from(body), {
      version: 'aes128gcm',
      privateKey: receiver.ecdh,
      authSecret: Buffer.from(receiver.auth),
    });

    expect(decrypted.toString()).toBe(plaintext);
  });

  test('fills a push body up to 4096 bytes and rejects anything larger', async () => {
    const receiver = newReceiver();
    const largest = await encrypt(new Uint8Array(MAX_PUSH_PLAINTEXT), receiver.target);

    expect(largest.length).toBe(4096);
    expect(
      await encrypt(new Uint8Array(MAX_PUSH_PLAINTEXT + 1), receiver.target).catch((error: unknown) => error),
    ).toBeInstanceOf(RangeError);
  });
});

describe('vapidAuthorization', () => {
  test('signs an ES256 JWT for the push service origin that verifies with the advertised key', async () => {
    const keys = vapidKeys(await newVapidJwk());
    const now = Date.UTC(2026, 0, 1);
    const header = await vapidAuthorization(
      'https://web.push.apple.com/QGuQyavXutnMH',
      { keys, subject: 'https://example.com' },
      now,
    );

    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    if (!match) throw new Error(`unexpected header: ${header}`);
    const [, head = '', claims = '', signature = '', publicKey = ''] = match;

    expect(publicKey).toBe(keys.publicKey);
    expect(decodeJson(head)).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(decodeJson(claims)).toEqual({
      aud: 'https://web.push.apple.com',
      exp: now / 1000 + 12 * 3600,
      sub: 'https://example.com',
    });

    const verifier = await crypto.subtle.importKey(
      'raw',
      Uint8Array.fromBase64(publicKey, BASE64URL),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      verifier,
      Uint8Array.fromBase64(signature, BASE64URL),
      utf8(`${head}.${claims}`),
    );
    expect(valid).toBe(true);
  });

  test('rejects keys that are not P-256 private JWKs', () => {
    expect(() => vapidKeys(JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'a', y: 'b' }))).toThrow();
  });
});

test('isPushServiceEndpoint only accepts https endpoints of known push services', () => {
  expect(isPushServiceEndpoint('https://web.push.apple.com/abc')).toBe(true);
  expect(isPushServiceEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
  expect(isPushServiceEndpoint('https://wns2-par02p.notify.windows.com/w/?token=abc')).toBe(true);
  expect(isPushServiceEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(true);
  expect(isPushServiceEndpoint('http://web.push.apple.com/abc')).toBe(false);
  expect(isPushServiceEndpoint('https://evil.example/web.push.apple.com')).toBe(false);
  expect(isPushServiceEndpoint('https://push.apple.com.evil.example/abc')).toBe(false);
  expect(isPushServiceEndpoint('https://web.push.apple.com:8443/abc')).toBe(false);
  expect(isPushServiceEndpoint('https://user:pass@web.push.apple.com/abc')).toBe(false);
  expect(isPushServiceEndpoint('not a url')).toBe(false);
});

test.each([
  ['https://push.apple.com/abc', false],
  ['https://web.push.apple.com/abc', false],
  ['https://other.push.apple.com/abc', false],
  ['https://fcm.googleapis.com/fcm/send/abc', true],
  ['https://wns2-par02p.notify.windows.com/w/?token=abc', true],
  ['https://updates.push.services.mozilla.com/wpush/v2/abc', true],
  ['https://evil.example/fcm.googleapis.com', false],
  ['https://fcm.googleapis.com:8443/abc', false],
] as const)('canReplace follows the validated push service for %s', (endpoint, replaceable) => {
  expect(canReplace(endpoint)).toBe(replaceable);
});

test('sendPush never contacts endpoints outside the allowlist', async () => {
  const fetchSpy = spyOn(globalThis, 'fetch');
  const sender = { keys: vapidKeys(await newVapidJwk()), subject: 'https://example.com' };
  const target = { ...newReceiver().target, endpoint: 'https://attacker.example/collect' };

  const outcome = await sendPush(target, '{}', sender, { ttl: 60, urgency: 'high', topic: 't' }).catch(
    (error: unknown) => error,
  );

  expect(outcome).toBeInstanceOf(Error);
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});
