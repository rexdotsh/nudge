<script lang="ts" generics="T extends string">
  import { composing } from '../lib/shortcuts';
  import { ui } from '../lib/ui.svelte';
  import Listbox, { optionId } from './Listbox.svelte';
  import Popover from './Popover.svelte';

  let {
    value,
    options,
    labelledby,
    onSelect,
  }: {
    value: T;
    options: readonly { value: T; label: string }[];
    labelledby: string;
    onSelect: (value: T) => void;
  } = $props();

  const TYPEAHEAD_MS = 600;

  const id = $props.id();
  const listId = `${id}-list`;
  const selected = $derived(
    Math.max(
      0,
      options.findIndex((option) => option.value === value),
    ),
  );
  let trigger: HTMLButtonElement | undefined = $state();
  let open = $state(false);
  let active = $state(0);
  let typed = '';
  let typedAt = 0;

  function show(index: number) {
    active = index;
    open = true;
  }

  function choose(index: number) {
    open = false;
    const option = options[index];
    if (option && option.value !== value) onSelect(option.value);
  }

  function highlight(index: number) {
    active = Math.max(0, Math.min(index, options.length - 1));
  }

  function typeahead(key: string): number {
    typed = performance.now() - typedAt < TYPEAHEAD_MS ? typed + key.toLowerCase() : key.toLowerCase();
    typedAt = performance.now();
    const from = open ? active : selected;
    const order = options.map((_, offset) => (from + offset + (typed.length === 1 ? 1 : 0)) % options.length);
    return order.find((index) => options[index]?.label.toLowerCase().startsWith(typed)) ?? from;
  }

  // The select-only combobox pattern: focus stays on the button, which drives the list.
  function keydown(event: KeyboardEvent) {
    if (open) event.stopPropagation();
    if (composing(event) || event.ctrlKey || event.metaKey) return;
    const printable = event.key.length === 1 && event.key !== ' ';
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) show(selected);
      else if (event.key === 'Home') show(0);
      else if (event.key === 'End') show(options.length - 1);
      else if (printable) show(typeahead(event.key));
      else return;
      event.preventDefault();
      return;
    }
    if (event.key === 'Tab') return choose(active);
    if (event.key === 'Escape') open = false;
    else if (event.key === 'Enter' || event.key === ' ' || (event.altKey && event.key === 'ArrowUp')) choose(active);
    else if (event.key === 'ArrowDown') highlight(active + 1);
    else if (event.key === 'ArrowUp') highlight(active - 1);
    else if (event.key === 'Home' || event.key === 'PageUp') highlight(0);
    else if (event.key === 'End' || event.key === 'PageDown') highlight(options.length - 1);
    else if (printable) highlight(typeahead(event.key));
    else return;
    event.preventDefault();
  }
</script>

{#if ui.fine}
  <button
    type="button"
    class="trigger"
    role="combobox"
    aria-labelledby="{labelledby} {id}"
    aria-haspopup="listbox"
    aria-controls={listId}
    aria-expanded={open}
    aria-activedescendant={open ? optionId(listId, active) : undefined}
    bind:this={trigger}
    onclick={() => (open ? (open = false) : show(selected))}
    onkeydown={keydown}
    onblur={() => (open = false)}><span {id}>{options[selected]?.label}</span></button
  >
  {#if open && trigger}
    <Popover anchor={trigger} onClose={() => (open = false)}>
      <Listbox
        id={listId}
        {options}
        selected={value}
        {active}
        onPick={(picked) => choose(options.findIndex((option) => option.value === picked))}
        aria-labelledby={labelledby}
      />
    </Popover>
  {/if}
{:else}
  <select
    aria-labelledby={labelledby}
    {value}
    onchange={(event) => {
      const option = options.find((candidate) => candidate.value === event.currentTarget.value);
      if (option) onSelect(option.value);
    }}
  >
    {#each options as option (option.value)}<option value={option.value}>{option.label}</option>{/each}
  </select>
{/if}

<style>
  .trigger,
  select {
    appearance: none;
    min-width: 0;
    max-width: 60%;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ink-2);
    font-size: inherit;
    text-align: right;
    outline: none;
    cursor: pointer;
  }

  .trigger span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .trigger[aria-expanded='true'] {
    color: var(--ink);
  }

  :is(.trigger, select):focus-visible {
    border-radius: 4px;
    outline: 2px solid var(--faint);
    outline-offset: 3px;
  }
</style>
