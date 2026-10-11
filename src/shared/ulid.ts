const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(now = Date.now()): string {
  let time = '';
  for (let i = 0, rest = now; i < 10; i++, rest = Math.floor(rest / 32)) time = ALPHABET.charAt(rest % 32) + time;
  let random = '';
  for (const byte of crypto.getRandomValues(new Uint8Array(16))) random += ALPHABET.charAt(byte % 32);
  return time + random;
}

export function isUlid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}
