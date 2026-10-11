<script lang="ts">
  import type { Snippet } from 'svelte';

  let { title, tagline, children }: { title: string; tagline: string; children: Snippet } = $props();
</script>

<main class="onboarding">
  <img src="/icons/icon-192.png" alt="" width="64" height="64" />
  <h1>{title}</h1>
  <p class="tagline">{tagline}</p>
  {@render children()}
</main>

<style>
  .onboarding {
    max-width: 400px;
    min-height: 100dvh;
    margin: 0 auto;
    padding: calc(24px + env(safe-area-inset-top)) 22px calc(14vh + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    justify-content: center;
    animation: rise 0.5s var(--ease) both;
  }

  img {
    border-radius: 15px;
  }

  h1 {
    margin: 22px 0 6px;
    font-size: 26px;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  .tagline {
    margin: 0 0 26px;
    color: var(--muted);
    font-size: 15.5px;
  }
</style>
