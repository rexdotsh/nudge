<script lang="ts" module>
  export const optionId = (list: string, index: number) => `${list}-${index}`;

  /** An option; ones next to each other with the same `group` are listed under it as a heading. */
  export interface Option<T> {
    value: T;
    label: string;
    group?: string;
  }

  export function sections<T>(options: readonly Option<T>[]) {
    const runs: { group: string | undefined; items: { option: Option<T>; index: number }[] }[] = [];
    options.forEach((option, index) => {
      const last = runs.at(-1);
      if (last && last.group === option.group) last.items.push({ option, index });
      else runs.push({ group: option.group, items: [{ option, index }] });
    });
    return runs;
  }
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
    options: readonly Option<T>[];
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
      const option = list.ownerDocument.getElementById(optionId(id, index));
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
  {#each sections(options) as { group, items }, section (items[0]?.index ?? section)}
    {#if group === undefined}
      {#each items as { option, index } (option.value)}{@render item(option, index)}{/each}
    {:else}
      <div role="group" aria-labelledby="{id}-group-{section}">
        <div class="group-label" id="{id}-group-{section}">{group}</div>
        {#each items as { option, index } (option.value)}{@render item(option, index)}{/each}
      </div>
    {/if}
  {/each}
</div>

{#snippet item(option: Option<T>, index: number)}
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
{/snippet}

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

  .group-label {
    padding: 8px 10px 4px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
  }

  [aria-selected='true'] > :global(svg) {
    color: var(--on);
  }
</style>
