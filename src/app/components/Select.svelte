<script lang="ts" generics="T extends string">
  import { composing } from '../lib/shortcuts';
  import { ui } from '../lib/ui.svelte';
  import Icon from './Icon.svelte';
  import Listbox, { optionId, sections, type Option } from './Listbox.svelte';
  import Popover from './Popover.svelte';

  let {
    value,
    options,
    labelledby,
    onSelect,
  }: {
    value: T;
    options: readonly Option<T>[];
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
  const shown = $derived(options[selected]?.label);
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

<!-- A chip like the editor's pickers; a row marked `.choice` opens it from anywhere on the row. -->
{#if ui.fine}
  <button
    type="button"
    class="trigger picker"
    role="combobox"
    aria-labelledby="{labelledby} {id}"
    aria-haspopup="listbox"
    aria-controls={listId}
    aria-expanded={open}
    aria-activedescendant={open ? optionId(listId, active) : undefined}
    bind:this={trigger}
    onclick={() => (open ? (open = false) : show(selected))}
    onkeydown={keydown}
    onblur={() => (open = false)}><span {id}>{shown}</span><Icon name="chevronDown" size={14} /></button
  >
  {#each open && trigger ? [trigger] : [] as anchor (anchor)}
    <Popover {anchor} onClose={() => (open = false)}>
      <Listbox
        id={listId}
        {options}
        selected={value}
        {active}
        onPick={(picked) => choose(options.findIndex((option) => option.value === picked))}
        aria-labelledby={labelledby}
      />
    </Popover>
  {/each}
{:else}
  <span class="native picker">
    <span aria-hidden="true">{shown}</span><Icon name="chevronDown" size={14} />
    <select
      aria-labelledby={labelledby}
      {value}
      onchange={(event) => {
        const option = options.find((candidate) => candidate.value === event.currentTarget.value);
        if (option) onSelect(option.value);
      }}
    >
      {#each sections(options) as { group, items }, section (items[0]?.index ?? section)}
        {#if group === undefined}
          {#each items as { option } (option.value)}<option value={option.value}>{option.label}</option>{/each}
        {:else}
          <optgroup label={group}>
            {#each items as { option } (option.value)}<option value={option.value}>{option.label}</option>{/each}
          </optgroup>
        {/if}
      {/each}
    </select>
  </span>
{/if}

<style>
  .trigger,
  .native {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    max-width: 60%;
    cursor: pointer;
  }

  .trigger {
    appearance: none;
    border: 0;
    outline: none;
  }

  .trigger > span,
  .native > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :is(.trigger, .native) > :global(svg) {
    flex: none;
    color: var(--muted);
  }

  .native select {
    position: absolute;
    inset: 0;
    width: 100%;
    appearance: none;
    opacity: 0;
    cursor: pointer;
  }

  /* The trigger's own box stays the chip the menu opens from, while its click area covers the row. */
  :global(.choice) .trigger,
  :global(.choice) .native {
    position: static;
  }

  :global(.choice) .trigger::after {
    content: '';
    position: absolute;
    inset: 0;
  }
</style>
