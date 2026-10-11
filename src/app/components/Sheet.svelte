<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade, fly } from 'svelte/transition';

  let { label, onClose, children }: { label: string; onClose: () => void; children: Snippet } = $props();

  const DISMISS_PX = 120;

  let drag = $state(0);
  let startY = $state<number | null>(null);

  function down(event: PointerEvent & { currentTarget: HTMLElement }) {
    startY = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent) {
    if (startY !== null) drag = Math.max(0, event.clientY - startY);
  }

  function release() {
    if (drag > DISMISS_PX) onClose();
    startY = null;
    drag = 0;
  }

  function cancel() {
    startY = null;
    drag = 0;
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={keydown} />

<button class="backdrop" aria-label="Close" tabindex="-1" onclick={onClose} transition:fade={{ duration: 180 }}
></button>
<div class="frame">
  <div
    class="sheet"
    class:dragging={startY !== null}
    role="dialog"
    aria-modal="true"
    aria-label={label}
    style:translate="0 {drag}px"
    transition:fly={{ y: 80, duration: 300, easing: (t) => 1 - (1 - t) ** 3 }}
  >
    <div
      class="grabber"
      role="presentation"
      onpointerdown={down}
      onpointermove={move}
      onpointerup={release}
      onpointercancel={cancel}
    >
      <span></span>
    </div>
    {@render children()}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgb(0 0 0 / 0.55);
    cursor: default;
  }

  .frame {
    position: fixed;
    inset: 0;
    z-index: 41;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    pointer-events: none;
  }

  .sheet {
    width: 100%;
    max-width: 560px;
    max-height: calc(100dvh - 48px - env(safe-area-inset-top));
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 18px calc(18px + env(safe-area-inset-bottom));
    border-radius: 26px 26px 0 0;
    background: var(--bg);
    box-shadow: inset 0 1px 0 var(--edge);
    pointer-events: auto;
    transition: translate 0.35s var(--spring);
  }

  .dragging {
    transition: none;
  }

  .grabber {
    position: sticky;
    top: 0;
    z-index: 1;
    display: grid;
    place-items: center;
    height: 22px;
    margin: 0 -18px 2px;
    background: var(--bg);
    touch-action: none;
  }

  .grabber span {
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: var(--faint);
  }

  @media (min-width: 720px) {
    .frame {
      justify-content: center;
    }

    .sheet {
      max-height: calc(100dvh - 80px);
      padding-bottom: 20px;
      border-radius: 20px;
      box-shadow: inset 0 0 0 1px var(--edge);
    }

    .grabber span {
      visibility: hidden;
    }
  }
</style>
