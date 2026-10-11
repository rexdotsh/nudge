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
    <div class="toast glass" role="status" transition:fly={{ y: 16, duration: 260 }}>
      <span>{toasts.current.message}</span>
      {#if toasts.current.undo}<button onclick={undo}>Undo</button>{/if}
    </div>
  {/key}
{/if}

<style>
  .toast {
    position: fixed;
    left: 50%;
    bottom: calc(150px + env(safe-area-inset-bottom));
    translate: -50% 0;
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 14px;
    max-width: calc(100vw - 32px);
    padding: 11px 16px;
    border-radius: 16px;
    font-size: 15px;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  button {
    color: var(--brand-text);
    font-weight: 600;
  }

  :global([data-platform='windows']) .toast {
    bottom: 24px;
    border-radius: 8px;
    font-size: 14px;
  }
</style>
