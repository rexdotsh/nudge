export const BASE64URL = { alphabet: 'base64url', omitPadding: true } as const;

const encoder = new TextEncoder();

export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(encoder.encode(text));
}
