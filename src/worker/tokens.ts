import { BASE64URL, utf8 } from '../shared/encoding';
import { memoize } from '../shared/memoize';

const hmacKey = memoize((secret) =>
  crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']),
);

export async function issueToken(secret: string, deviceId: string): Promise<string> {
  const payload = `${deviceId}.${Date.now().toString(36)}`;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), utf8(payload));
  return `${payload}.${new Uint8Array(signature).toBase64(BASE64URL)}`;
}

export async function verifyToken(secret: string, token: string): Promise<string | null> {
  const [deviceId, issued, signature, ...rest] = token.split('.');
  if (!deviceId || !issued || !signature || rest.length > 0) return null;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.fromBase64(signature, BASE64URL);
  } catch {
    return null;
  }
  const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), bytes, utf8(`${deviceId}.${issued}`));
  return valid ? deviceId : null;
}
