<script lang="ts">
  import { fly } from 'svelte/transition';
  import { arrive, depart } from '../lib/motion.svelte';
  import { toasts } from '../lib/toasts.svelte';
</script>

<!-- Keyed by toast, so one leaves on its own when it ends, without holding up a screen that is going away. -->
{#each toasts.current ? [toasts.current] : [] as toast (toast.id)}
  <div class="toast" role="status" in:fly={arrive({ y: 16 })} out:fly={depart({ y: 8 })}>
    <span>{toast.message}</span>
    {#if toast.undo}<button class="link" onclick={() => toasts.undo()}>Undo</button>{/if}
  </div>
{/each}

<style>
  .toast {
    position: fixed;
    left: calc((100% - var(--pane, 0px)) / 2);
    bottom: calc(82px + max(12px, env(safe-area-inset-bottom)));
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
      var(--shadow);
    font-size: 14px;
    white-space: nowrap;
  }

  /* One on its way out (Svelte makes it inert) passes under the toast replacing it. */
  .toast:global([inert]) {
    z-index: 29;
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (min-width: 720px) {
    .toast {
      bottom: 28px;
    }
  }
</style>
