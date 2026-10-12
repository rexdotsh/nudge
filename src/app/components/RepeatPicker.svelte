<script lang="ts">
  import { parseLocal } from '../../shared/time';
  import { app } from '../lib/app.svelte';
  import type { Draft } from '../lib/draft.svelte';
  import { repeatLabel } from '../lib/format';
  import { PRESETS, isPreset } from '../lib/repeat-choice.svelte';
  import { composing } from '../lib/shortcuts';
  import { ui } from '../lib/ui.svelte';
  import HighlightedInput from './HighlightedInput.svelte';
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

  function apply(event: SubmitEvent) {
    event.preventDefault();
    if (choice.typed) settle(() => draft.applyRepeat());
  }

  function escape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || composing(event)) return;
    event.preventDefault();
    event.stopPropagation();
    settle(() => choice.cancel());
  }
</script>

<div class="field" bind:this={row}>
  <span {id}>Repeat</span>
  <Select value={choice.selected} {options} labelledby={id} onSelect={(value) => choice.select(value)} />
</div>
{#if choice.selected === 'type'}
  <form class="field stacked" onsubmit={apply}>
    <div class="typed">
      <HighlightedInput
        {@attach (node) => node.focus()}
        bind:value={choice.phrase}
        spans={choice.spans}
        placeholder="every other tue, 3 days after done…"
        aria-label="Repeat in words"
        aria-describedby="{id}-result"
        enterkeyhint="done"
        onkeydown={escape}
      />
      <button class="link" type="submit" disabled={!choice.typed}>Apply</button>
    </div>
    <small id="{id}-result" aria-live="polite" hidden={choice.phrase.trim() === ''}>
      {#if result}<span class="result">{result}</span>{:else if choice.phrase.trim() !== ''}Try “every other tue” or “on
        the 1st and 15th”.{/if}
    </small>
  </form>
{/if}

<style>
  .typed {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
  }

  .result {
    color: var(--ink-2);
  }
</style>
