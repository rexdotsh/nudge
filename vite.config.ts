import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/app',
  publicDir: '../../public',
  plugins: [svelte()],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    manifest: true,
    target: 'es2023',
    assetsInlineLimit: 0,
  },
});
