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
    element = $bindable(),
    ...rest
  }: {
    id: string;
    options: readonly { value: T; label: string }[];
    selected: T;
    active: number;
    onPick: (value: T) => void;
    element?: HTMLElement;
  } & HTMLAttributes<HTMLDivElement> = $props();
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
    min-width: 176px;
    max-height: 270px;
    overflow-y: auto;
    overscroll-behavior: contain;
    outline: none;
  }

  .list:hover .active:not(:hover) {
    background: none;
  }
</style>
