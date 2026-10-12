<script lang="ts">
  import { parseLocal } from '../../shared/time';
  import { app } from '../lib/app.svelte';
  import { repeatLabel } from '../lib/format';
  import { PRESETS, isPreset, type RepeatChoice } from '../lib/repeat-choice.svelte';
  import Select from './Select.svelte';

  let { choice, start }: { choice: RepeatChoice; start: string } = $props();

  const id = $props.id();
  const custom = $derived(choice.custom && parseLocal(start) ? repeatLabel(choice.custom, start, app.zone) : null);
  const options = $derived([
    ...Object.entries(PRESETS).map(([value, preset]) => ({ value, label: preset.label })),
    ...(!isPreset(choice.selected) && custom ? [{ value: 'custom', label: custom }] : []),
    { value: 'type', label: 'Type a repeat…' },
  ]);
</script>

<div class="field">
  <span {id}>Repeat</span>
  <Select value={choice.selected} {options} labelledby={id} onSelect={(value) => choice.select(value)} />
</div>
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
