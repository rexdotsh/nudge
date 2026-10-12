<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { fade } from 'svelte/transition';
  import { depart } from '../lib/motion.svelte';
  import { composing } from '../lib/shortcuts';

  let {
    anchor,
    onClose,
    children,
    ...rest
  }: { anchor: HTMLElement; onClose: () => void; children: Snippet } & HTMLAttributes<HTMLDivElement> = $props();

  const GAP_PX = 6;
  const MARGIN_PX = 8;
  const MIN_ROOM_PX = 160;

  let left = $state(0);
  let top = $state(0);
  let maxHeight = $state<number | null>(null);
  let origin = $state('top left');
  let popup: HTMLElement | undefined = $state();

  // The top layer keeps it above an open sheet and unclipped by the scrolling pane it opens from.
  function show(node: HTMLElement) {
    node.showPopover();
    const box = anchor.getBoundingClientRect();
    // Layout sizes, not the bounding box, which the opening animation is still scaling down.
    const width = node.offsetWidth;
    const below = innerHeight - MARGIN_PX - box.bottom - GAP_PX;
    const roomAbove = box.top - GAP_PX - MARGIN_PX;
    const above = node.offsetHeight > below && roomAbove > below;
    const room = above ? roomAbove : below;
    const height = Math.min(node.offsetHeight, room >= MIN_ROOM_PX ? room : innerHeight - 2 * MARGIN_PX);
    const start = box.left + box.width / 2 < innerWidth / 2;
    maxHeight = height;
    top = Math.max(
      MARGIN_PX,
      Math.min(above ? box.top - GAP_PX - height : box.bottom + GAP_PX, innerHeight - MARGIN_PX - height),
    );
    left = Math.max(MARGIN_PX, Math.min(start ? box.left : box.right - width, innerWidth - width - MARGIN_PX));
    origin = `${above ? 'bottom' : 'top'} ${start ? 'left' : 'right'}`;
    node.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }

  const inside = (target: EventTarget | null) =>
    target instanceof Node && (popup?.contains(target) === true || anchor.contains(target));

  function outside(event: Event) {
    if (!inside(event.target)) onClose();
  }

  // It owns the keyboard while open, as the row menu does; Escape is kept from the sheet or editor around it.
  function keydown(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.key !== 'Escape' || composing(event)) return;
    event.preventDefault();
    onClose();
    anchor.focus();
  }
</script>

<svelte:window onpointerdowncapture={outside} onscrollcapture={outside} onresize={onClose} onblur={onClose} />

<div
  {...rest}
  class="popup"
  popover="manual"
  style:left="{left}px"
  style:top="{top}px"
  style:max-height={maxHeight === null ? null : `${maxHeight}px`}
  style:transform-origin={origin}
  bind:this={popup}
  {@attach show}
  out:fade={depart()}
  onkeydown={keydown}
  onfocusout={(event) => event.relatedTarget !== null && !inside(event.relatedTarget) && onClose()}
>
  {@render children()}
</div>

<style>
  .popup {
    position: fixed;
    inset: auto;
    margin: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .popup:popover-open {
    display: flex;
    flex-direction: column;
  }

  .popup > :global(.list) {
    min-height: 0;
  }
</style>
