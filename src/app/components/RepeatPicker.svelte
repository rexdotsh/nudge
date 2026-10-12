<script lang="ts">
  import { parseLocal } from '../../shared/time';
  import { app } from '../lib/app.svelte';
  import { repeatLabel } from '../lib/format';
  import { PRESETS, isPreset, type RepeatChoice } from '../lib/repeat-choice.svelte';

  let { choice, start }: { choice: RepeatChoice; start: string } = $props();

  const custom = $derived(choice.custom && parseLocal(start) ? repeatLabel(choice.custom, start, app.zone) : null);
</script>

<label class="field">
  <span>Repeat</span>
  <select value={choice.selected} onchange={(event) => choice.select(event.currentTarget.value)}>
    {#each Object.entries(PRESETS) as [key, preset] (key)}<option value={key}>{preset.label}</option>{/each}
    {#if !isPreset(choice.selected) && custom}<option value="custom">{custom}</option>{/if}
    <option value="type">Type a repeat…</option>
  </select>
</label>
{#if choice.selected === 'type'}
  <div class="field stacked">
    <input
      class="bare"
      {@attach (node) => node.focus()}
      bind:value={choice.phrase}
      placeholder="every other tue, 3 days after done…"
      aria-label="Repeat in words"
    />
    {#if !choice.understood}<small>Try “every other tue” or “on the 1st and 15th”.</small>{/if}
  </div>
{/if}

<style>
  select {
    appearance: none;
    min-width: 0;
    max-width: 60%;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ink-2);
    font-size: 15px;
    text-align: right;
    outline: none;
    text-overflow: ellipsis;
    cursor: pointer;
  }

  select:focus-visible {
    border-radius: 4px;
    outline: 2px solid var(--faint);
    outline-offset: 3px;
  }
</style>
