import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig } from 'vite';

const client = 'dist/client';

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

// index.html is cached as '/', Workers reads _headers itself, and iOS fetches launch images only when the app is added
// to the Home Screen.
const precache = files(client)
  .map((path) => '/' + relative(client, path))
  .filter((url) => !/^\/(\.vite\/|splash\/|index\.html$|_headers$)/.test(url));

const hash = createHash('sha256');
for (const url of [...precache, '/index.html']) hash.update(url).update(readFileSync(join(client, url)));
const build = hash.digest('hex').slice(0, 12);

export default defineConfig({
  publicDir: false,
  define: {
    NUDGE_PRECACHE: JSON.stringify(['/', ...precache]),
    NUDGE_BUILD: JSON.stringify(build),
  },
  build: {
    outDir: client,
    emptyOutDir: false,
    target: 'es2023',
    lib: { entry: 'src/sw/sw.ts', formats: ['iife'], name: 'sw', fileName: () => 'sw.js' },
  },
});
