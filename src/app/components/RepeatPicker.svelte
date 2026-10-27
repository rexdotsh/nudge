<script lang="ts">
  import { parseLocal } from '../../shared/time';
  import { app } from '../lib/app.svelte';
  import type { Draft } from '../lib/draft.svelte';
  import { repeatLabel } from '../lib/format';
  import { PRESETS, isPreset } from '../lib/repeat-choice.svelte';
  import { ui } from '../lib/ui.svelte';
  import PhraseField from './PhraseField.svelte';
  import Select from './Select.svelte';

  let { draft }: { draft: Draft } = $props();

  const id = $props.id();
  const choice = $derived(draft.repeat);
  const start = $derived(draft.fields.start);
  const dated = $derived(parseLocal(start) !== null);
  const custom = $derived(choice.custom && dated ? repeatLabel(choice.custom, start, app.zone) : null);
  const result = $derived(
    choice.typed && dated ? repeatLabel(choice.typed, start, app.zone, { withTime: true }) : null,
  );
  const options = $derived([
    ...Object.entries(PRESETS).map(([value, preset]) => ({ value, label: preset.label })),
    ...(!isPreset(choice.selected) && custom ? [{ value: 'custom', label: custom }] : []),
    { value: 'type', label: 'Type a repeat…' },
  ]);
  let row: HTMLDivElement | undefined = $state();

  // Focus goes back to the repeat it changed, but only under a pointer: on touch it would open the native picker.
  function settle(change: () => void) {
    change();
    if (ui.fine) row?.querySelector<HTMLElement>('[role="combobox"]')?.focus();
  }
</script>

<div class="field" bind:this={row}>
  <span {id}>Repeat</span>
  <Select value={choice.selected} {options} labelledby={id} onSelect={(value) => choice.select(value)} />
</div>
{#if choice.selected === 'type'}
  <PhraseField
    bind:value={choice.phrase}
    spans={choice.spans}
    placeholder="every other tue, 3 days after done…"
    label="Repeat in words"
    action="Apply"
    {result}
    hint="Try “every other tue” or “on the 1st and 15th”."
    onApply={() => settle(() => draft.applyRepeat())}
    onCancel={() => settle(() => choice.cancel())}
  />
{/if}
