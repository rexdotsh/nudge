<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fly } from 'svelte/transition';
  import { arrive, depart } from '../lib/motion.svelte';

  let { label, onClose, children }: { label: string; onClose: () => void; children: Snippet } = $props();

  const DISMISS_PX = 120;

  let drag = $state(0);
  let startY = $state<number | null>(null);

  // Without a tap since the dialog opened (one a notification opened, say), Android's back gesture closes it outright,
  // with no cancel event to ask first.
  function closed() {
    onClose();
  }

  function open(dialog: HTMLDialogElement) {
    const opener = document.activeElement;
    dialog.addEventListener('close', closed);
    dialog.showModal();
    dialog.focus();
    return () => {
      dialog.removeEventListener('close', closed);
      dialog.close();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }

  function down(event: PointerEvent & { currentTarget: HTMLElement }) {
    startY = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent) {
    if (startY !== null) drag = Math.max(0, event.clientY - startY);
  }

  function release() {
    // A dismissed sheet leaves from where it was let go.
    if (drag > DISMISS_PX) onClose();
    else drag = 0;
    startY = null;
  }

  function cancel() {
    startY = null;
    drag = 0;
  }
</script>

<dialog
  {@attach open}
  tabindex="-1"
  aria-label={label}
  class:dragging={startY !== null}
  style:translate="0 {drag}px"
  oncancel={(event) => {
    event.preventDefault();
    onClose();
  }}
  onclick={(event) => event.target === event.currentTarget && onClose()}
  in:fly|global={arrive({ y: 64 })}
  out:fly|global={depart({ y: 64 })}
>
  <div class="body">
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
</dialog>

<style>
  dialog {
    width: 100%;
    max-width: 560px;
    max-height: calc(100dvh - 48px - env(safe-area-inset-top));
    margin: auto auto 0;
    padding: 0;
    /* A real border, not an inset shadow: content (the sticky grabber) paints over inset shadows but never over borders. */
    border: 1px solid var(--edge);
    border-bottom: 0;
    border-radius: 26px 26px 0 0;
    background: var(--bg);
    color: var(--ink);
    overflow-y: auto;
    overscroll-behavior: contain;
    transition: translate 0.35s var(--spring);
  }

  dialog:focus {
    outline: none;
  }

  dialog::backdrop {
    background: var(--scrim);
    transition: opacity var(--base);
  }

  @starting-style {
    dialog[open]::backdrop {
      opacity: 0;
    }
  }

  /* Svelte makes whatever is on its way out inert. */
  dialog:global([inert])::backdrop {
    opacity: 0;
    transition-duration: var(--fast);
  }

  .dragging {
    transition: none;
  }

  .body {
    padding: 0 18px calc(18px + env(safe-area-inset-bottom));
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
    dialog {
      max-height: calc(100dvh - 80px);
      margin: auto;
      border-bottom: 1px solid var(--edge);
      border-radius: 20px;
    }

    .body {
      padding-bottom: 20px;
    }

    .grabber span {
      visibility: hidden;
    }
  }
</style>
