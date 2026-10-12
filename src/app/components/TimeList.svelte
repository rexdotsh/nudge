<script lang="ts">
  import { untrack } from 'svelte';
  import { formatClock } from '../../shared/time';
  import { clockLabel } from '../lib/format';
  import { parseTime, timeSlots } from '../lib/pickers';
  import { composing } from '../lib/shortcuts';
  import Listbox, { optionId } from './Listbox.svelte';

  let { value, onPick }: { value: string; onPick: (value: string) => void } = $props();

  const id = $props.id();
  const listId = `${id}-list`;
  const slots = timeSlots(untrack(() => value));
  const labelOf = (slot: string) => {
    const time = parseTime(slot);
    return time ? clockLabel(time) : slot;
  };

  let text = $state('');
  let typing = $state(false);
  let active = $state(slots.indexOf(untrack(() => value)));
  const typed = $derived(typing ? parseTime(text) : null);
  const invalid = $derived(typing && text.trim() !== '' && typed === null);
  const reveal = $derived(typed ? slots.findLastIndex((slot) => slot <= formatClock(typed)) : active);

  function input() {
    typing = true;
    active = typed ? slots.indexOf(formatClock(typed)) : -1;
  }

  function step(by: number) {
    const from = Math.max(0, reveal);
    active = Math.max(0, Math.min(from + by, slots.length - 1));
    typing = false;
    text = labelOf(slots[active] ?? '');
  }

  function keydown(event: KeyboardEvent) {
    if (composing(event) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'ArrowDown') step(1);
    else if (event.key === 'ArrowUp') step(-1);
    else if (event.key === 'PageDown') step(4);
    else if (event.key === 'PageUp') step(-4);
    else if (event.key === 'Enter') {
      const pick = typing ? typed && formatClock(typed) : slots[active];
      if (pick) onPick(pick);
    } else return;
    event.preventDefault();
  }
</script>

<input
  class="entry"
  role="combobox"
  aria-label="Time"
  aria-expanded="true"
  aria-controls={listId}
  aria-autocomplete="none"
  aria-activedescendant={active >= 0 ? optionId(listId, active) : undefined}
  aria-invalid={invalid}
  placeholder="Type a time"
  data-autofocus
  bind:value={text}
  oninput={input}
  onkeydown={keydown}
/>
<Listbox
  id={listId}
  options={slots.map((slot) => ({ value: slot, label: labelOf(slot) }))}
  selected={value}
  {active}
  {onPick}
  aria-label="Times"
  {reveal}
  center={typing}
/>

<style>
  .entry {
    display: block;
    flex: none;
    width: 100%;
    margin-bottom: 4px;
    height: 32px;
    padding: 0 10px;
    border: 0;
    border-radius: 6px;
    background: var(--bg);
    box-shadow: inset 0 0 0 1px var(--edge);
    font-size: 13.5px;
    outline: none;
  }

  .entry:focus {
    box-shadow: inset 0 0 0 1px var(--ring);
  }

  .entry[aria-invalid='true'] {
    color: var(--accent);
  }
</style>
