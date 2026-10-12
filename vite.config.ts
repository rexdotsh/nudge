import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { SPLASH_IMAGES } from './scripts/splash';

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
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    manifest: true,
    target: 'es2023',
    assetsInlineLimit: 0,
  },
});
