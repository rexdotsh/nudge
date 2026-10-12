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
    onkeydown: handleKey,
    class: className,
    ...rest
  }: {
    anchor: HTMLElement | { x: number; y: number };
    onClose: () => void;
    children: Snippet;
  } & HTMLAttributes<HTMLDivElement> = $props();

  const GAP_PX = 6;
  const MARGIN_PX = 8;
  const MIN_ROOM_PX = 160;

  let popup: HTMLElement | undefined = $state();

  // The top layer keeps it above an open sheet and unclipped by the scrolling pane it opens from.
  function show(node: HTMLElement) {
    node.showPopover();
    const anchored = anchor instanceof HTMLElement;
    const gap = anchored ? GAP_PX : 0;
    const box =
      anchor instanceof HTMLElement
        ? anchor.getBoundingClientRect()
        : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0 };
    // Layout sizes, not the bounding box, which the opening animation is still scaling down.
    const width = node.offsetWidth;
    const below = innerHeight - MARGIN_PX - box.bottom - gap;
    const roomAbove = box.top - gap - MARGIN_PX;
    const above = node.offsetHeight > below && roomAbove > below;
    const room = above ? roomAbove : below;
    const height = Math.min(node.offsetHeight, room >= MIN_ROOM_PX ? room : innerHeight - 2 * MARGIN_PX);
    const start = !anchored || box.left + box.width / 2 < innerWidth / 2;
    node.style.maxHeight = `${height}px`;
    node.style.top = `${Math.max(
      MARGIN_PX,
      Math.min(above ? box.top - gap - height : box.bottom + gap, innerHeight - MARGIN_PX - height),
    )}px`;
    node.style.left = `${Math.max(MARGIN_PX, Math.min(start ? box.left : box.right - width, innerWidth - width - MARGIN_PX))}px`;
    node.style.transformOrigin = `${anchored && above ? 'bottom' : 'top'} ${start ? 'left' : 'right'}`;
    (node.querySelector<HTMLElement>('[data-autofocus]') ?? (node.hasAttribute('tabindex') ? node : null))?.focus({
      preventScroll: true,
    });
  }

  const inside = (target: EventTarget | null) =>
    target instanceof Node &&
    (popup?.contains(target) === true || (anchor instanceof HTMLElement && anchor.contains(target)));

  function close() {
    // Outgoing popovers still receive window and focus events during their exit transition.
    if (!popup?.inert) onClose();
  }

  function outside(event: Event) {
    if (!inside(event.target)) close();
  }

  // Escape must not reach the sheet or editor beneath the popover.
  function keydown(event: KeyboardEvent & { currentTarget: HTMLDivElement }) {
    event.stopPropagation();
    handleKey?.(event);
    if (event.defaultPrevented || event.key !== 'Escape' || composing(event)) return;
    event.preventDefault();
    close();
    if (anchor instanceof HTMLElement) anchor.focus();
  }
</script>

<svelte:window onpointerdowncapture={outside} onscrollcapture={outside} onresize={close} onblur={close} />

<div
  {...rest}
  class={['popup', className]}
  popover="manual"
  bind:this={popup}
  {@attach show}
  out:fade={depart()}
  onkeydown={keydown}
  onfocusout={(event) => event.relatedTarget !== null && !inside(event.relatedTarget) && close()}
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

  .popup:focus {
    outline: none;
  }
</style>
