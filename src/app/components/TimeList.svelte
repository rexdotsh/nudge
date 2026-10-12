<script lang="ts">
  import { untrack } from 'svelte';
  import { formatClock } from '../../shared/time';
  import { clockLabel } from '../lib/format';
  import { parseTime, timeSlots } from '../lib/pickers';
  import Listbox from './Listbox.svelte';

  let { value, onPick }: { value: string; onPick: (value: string) => void } = $props();

  const id = $props.id();
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
  let list: HTMLElement | undefined = $state();

  function reveal(index: number, center = false) {
    const option = list?.children[index];
    if (!list || !(option instanceof HTMLElement)) return;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (center) list.scrollTop = top - Math.floor(list.clientHeight / option.offsetHeight / 2) * option.offsetHeight;
    else if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }

  function input() {
    typing = true;
    const time = parseTime(text);
    active = -1;
    if (!time) return;
    const exact = formatClock(time);
    active = slots.indexOf(exact);
    reveal(
      slots.findLastIndex((slot) => slot <= exact),
      true,
    );
  }

  function step(by: number) {
    const from = active >= 0 ? active : typed ? slots.findLastIndex((slot) => slot <= formatClock(typed)) : 0;
    active = Math.max(0, Math.min(from + by, slots.length - 1));
    typing = false;
    text = labelOf(slots[active] ?? '');
    reveal(active);
  }

  function keydown(event: KeyboardEvent) {
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
  aria-controls="{id}-list"
  aria-autocomplete="none"
  aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
  aria-invalid={invalid}
  placeholder="Type a time"
  data-autofocus
  bind:value={text}
  onfocus={() => reveal(active, true)}
  oninput={input}
  onkeydown={keydown}
/>
<Listbox
  id="{id}-list"
  options={slots.map((slot) => ({ value: slot, label: labelOf(slot) }))}
  selected={value}
  {active}
  {onPick}
  aria-label="Times"
  bind:element={list}
/>

<style>
  .entry {
    display: block;
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
    box-shadow: inset 0 0 0 1px var(--faint);
  }

  .entry[aria-invalid='true'] {
    color: var(--accent);
  }
</style>
