<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { composing } from '../lib/shortcuts';

  let {
    anchor,
    onClose,
    children,
    ...rest
  }: { anchor: HTMLElement; onClose: () => void; children: Snippet } & HTMLAttributes<HTMLDivElement> = $props();

  const GAP_PX = 6;
  const MARGIN_PX = 8;

  let left = $state(0);
  let top = $state(0);
  let origin = $state('top left');
  let popup: HTMLElement | undefined = $state();

  // The top layer keeps it above an open sheet and unclipped by the scrolling pane it opens from.
  function show(node: HTMLElement) {
    node.showPopover();
    const box = anchor.getBoundingClientRect();
    const { width, height } = node.getBoundingClientRect();
    const above = box.bottom + GAP_PX + height > innerHeight - MARGIN_PX && box.top - GAP_PX - height >= MARGIN_PX;
    const start = box.left + box.width / 2 < innerWidth / 2;
    top = above ? box.top - GAP_PX - height : box.bottom + GAP_PX;
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
  style:transform-origin={origin}
  bind:this={popup}
  {@attach show}
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
    overflow: visible;
  }
</style>
