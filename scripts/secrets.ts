import { $ } from 'bun';
import { existsSync, writeFileSync } from 'node:fs';
import { BASE64URL } from '../src/shared/encoding';

const READABLE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const OPTIONAL = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'HEALTHCHECK_URL'] as const;

function setupCode(): string {
  const chars = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    READABLE.charAt(byte % READABLE.length),
  );
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

async function generated(): Promise<Record<string, string>> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return {
    AUTH_SECRET: crypto.getRandomValues(new Uint8Array(32)).toBase64(BASE64URL),
    SETUP_CODE: setupCode(),
    VAPID_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)),
  };
}

function fromEnvironment(): Record<string, string> {
  return Object.fromEntries(OPTIONAL.flatMap((name) => (process.env[name] ? [[name, process.env[name]]] : [])));
}

const [target] = process.argv.slice(2);
if (!target) {
  console.error('usage: bun run secrets <worker-name>   (or --dev to write .dev.vars)');
  process.exit(1);
}

const fresh = await generated();

if (target === '--dev') {
  if (existsSync('.dev.vars')) {
    console.error('.dev.vars already exists; delete it to regenerate');
    process.exit(1);
  }
  const values = { ...fresh, ...fromEnvironment() };
  writeFileSync(
    '.dev.vars',
    Object.entries(values)
      .map(([key, value]) => `${key}='${value}'`)
      .join('\n') + '\n',
  );
  console.error(`wrote .dev.vars, setup code ${fresh.SETUP_CODE}`);
} else {
  const listed: unknown = JSON.parse(await $`bunx wrangler secret list --name ${target} --format json`.text());
  const existing = new Set(Array.isArray(listed) ? listed.map((entry: { name?: unknown }) => entry.name) : []);
  const missing = Object.fromEntries(Object.entries(fresh).filter(([name]) => !existing.has(name)));
  const values = { ...missing, ...fromEnvironment() };
  if (Object.keys(values).length === 0) {
    console.error(`${target} already has every secret`);
  } else {
    await $`bunx wrangler secret bulk --name ${target} < ${new Response(JSON.stringify(values))}`;
    console.error(`set ${Object.keys(values).join(', ')} on ${target}`);
    if (missing.SETUP_CODE) console.error(`setup code for the first device: ${missing.SETUP_CODE}`);
  }
}
