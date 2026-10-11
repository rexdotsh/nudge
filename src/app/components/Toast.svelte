<script lang="ts">
  import { fly } from 'svelte/transition';
  import { toasts } from '../lib/toasts.svelte';

  function undo() {
    toasts.current?.undo?.();
    toasts.dismiss();
  }
</script>

{#if toasts.current}
  {#key toasts.current.id}
    <div class="toast" role="status" transition:fly={{ y: 16, duration: 260 }}>
      <span>{toasts.current.message}</span>
      {#if toasts.current.undo}<button onclick={undo}>Undo</button>{/if}
    </div>
  {/key}
{/if}

<style>
  .toast {
    position: fixed;
    left: 50%;
    bottom: calc(96px + env(safe-area-inset-bottom));
    translate: -50% 0;
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 16px;
    max-width: calc(100vw - 40px);
    height: 42px;
    padding: 0 16px;
    border-radius: 14px;
    background: var(--raised);
    box-shadow:
      inset 0 0 0 1px var(--edge),
      0 18px 40px -16px rgb(0 0 0 / 0.9);
    font-size: 14px;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  button {
    color: var(--accent);
    font-weight: 600;
  }

  @media (min-width: 720px) {
    .toast {
      bottom: 28px;
    }
  }
</style>
