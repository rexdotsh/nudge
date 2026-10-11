import { expect, test } from 'bun:test';
import { issueToken, verifyToken } from '../src/worker/tokens';

const secret = 'test-secret-of-reasonable-length';

test('a token verifies back to the device it was issued for', async () => {
  expect(await verifyToken(secret, await issueToken(secret, 'device-1'))).toBe('device-1');
});

test('tampered, foreign and malformed tokens are rejected', async () => {
  const token = await issueToken(secret, 'device-1');
  const [, issued, signature] = token.split('.');

  expect(await verifyToken(secret, `device-2.${issued}.${signature}`)).toBeNull();
  expect(await verifyToken('another-secret', token)).toBeNull();
  expect(await verifyToken(secret, `${token}.extra`)).toBeNull();
  expect(await verifyToken(secret, 'device-1')).toBeNull();
  expect(await verifyToken(secret, `device-1.${issued}.not base64!`)).toBeNull();
});
