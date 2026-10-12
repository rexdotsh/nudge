import { execFileSync } from 'node:child_process';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { SPLASH_IMAGES } from './scripts/splash';

// Workers Builds checks out a detached commit and names it here; local builds ask git.
const commit =
  process.env.WORKERS_CI_COMMIT_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

export default defineConfig({
  root: 'src/app',
  publicDir: '../../public',
  plugins: [
    svelte(),
    {
      name: 'splash-screens',
      transformIndexHtml: () =>
        SPLASH_IMAGES.map(({ href, media }) => ({
          tag: 'link',
          attrs: { rel: 'apple-touch-startup-image', media, href },
          injectTo: 'head',
        })),
    },
  ],
  define: { NUDGE_COMMIT: JSON.stringify(commit) },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    manifest: true,
    target: 'es2023',
    assetsInlineLimit: 0,
  },
});
