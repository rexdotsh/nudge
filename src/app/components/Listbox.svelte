<script lang="ts" module>
  export const optionId = (list: string, index: number) => `${list}-${index}`;
</script>

<script lang="ts" generics="T extends string">
  import type { HTMLAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';

  let {
    id,
    options,
    selected,
    active,
    onPick,
    reveal = active,
    center = false,
    ...rest
  }: {
    id: string;
    options: readonly { value: T; label: string }[];
    selected: T;
    active: number;
    onPick: (value: T) => void;
    reveal?: number;
    center?: boolean;
  } & HTMLAttributes<HTMLDivElement> = $props();

  let element: HTMLDivElement | undefined = $state();
  let first = true;

  $effect(() => {
    const list = element;
    const index = reveal;
    const centered = first || center;
    if (!list) return;
    // Its enclosing popover must finish attaching before layout can be measured.
    const frame = requestAnimationFrame(() => {
      const option = list.children[index];
      if (!list.isConnected || !(option instanceof HTMLElement)) return;
      const top = option.offsetTop;
      const bottom = top + option.offsetHeight;
      if (centered)
        list.scrollTop = top - Math.floor(list.clientHeight / option.offsetHeight / 2) * option.offsetHeight;
      else if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
      first = false;
    });
    return () => cancelAnimationFrame(frame);
  });
</script>

<!-- Its options take no focus, so the field driving them keeps it while the pointer picks. -->
<div
  {...rest}
  class="list"
  role="listbox"
  {id}
  tabindex="-1"
  bind:this={element}
  onpointerdown={(event) => event.preventDefault()}
>
  {#each options as option, index (option.value)}
    <button
      type="button"
      class="item"
      class:active={index === active}
      role="option"
      id={optionId(id, index)}
      tabindex="-1"
      aria-selected={option.value === selected}
      onclick={() => onPick(option.value)}
      >{option.label}{#if option.value === selected}<Icon name="check" size={15} />{/if}</button
    >
  {/each}
</div>

<style>
  .list {
    position: relative;
    min-height: 0;
    min-width: 176px;
    max-height: 270px;
    overflow-y: auto;
    overscroll-behavior: contain;
    outline: none;
  }

  .list:hover .active:not(:hover) {
    background: none;
  }

  [aria-selected='true'] > :global(svg) {
    color: var(--on);
  }
</style>
