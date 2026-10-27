<script lang="ts">
  import { tick } from 'svelte';
  import { fade } from 'svelte/transition';
  import { LIMITS } from '../../shared/input';
  import { PRESET_ALERTS, type AlertChoice } from '../lib/alert-choice.svelte';
  import { alertLabel } from '../lib/format';
  import { arrive, depart } from '../lib/motion.svelte';
  import { ui } from '../lib/ui.svelte';
  import Icon from './Icon.svelte';
  import PhraseField from './PhraseField.svelte';

  let { choice }: { choice: AlertChoice } = $props();

  const HINTS: Record<AlertChoice['typed']['kind'], string> = {
    empty: '',
    new: '',
    unclear: 'Try “30 min”, “2 hours” or “3 days”.',
    long: `Up to ${alertLabel(LIMITS.alertMinutes)} before.`,
    full: `Up to ${LIMITS.alerts} alerts.`,
    chosen: 'That one is already on.',
  };

  const id = $props.id();
  const typed = $derived(choice.typed);
  const result = $derived(typed.kind === 'new' ? `${alertLabel(typed.minutes)} before` : null);
  const spans = $derived(result === null ? [] : [{ start: 0, end: choice.phrase.length, kind: 'when' as const }]);
  let other: HTMLButtonElement | undefined = $state();

  // Focus returns to the control that opened the field, but only under a pointer: on touch it would hold the keyboard.
  async function settle(change: () => void) {
    change();
    await tick();
    if (ui.fine) other?.focus();
  }
</script>

<div class="field stacked">
  <span id="{id}-label">Also remind me before</span>
  <div class="presets" role="group" aria-labelledby="{id}-label">
    {#each PRESET_ALERTS as minutes (minutes)}
      {@const on = choice.chosen.includes(minutes)}
      <button class="press" aria-pressed={on} disabled={!on && choice.full} onclick={() => choice.toggle(minutes)}>
        {alertLabel(minutes)}
      </button>
    {/each}
    <button
      bind:this={other}
      class="press"
      aria-label="Another time"
      title="Another time"
      aria-expanded={choice.typing}
      onclick={() => (choice.typing ? choice.cancel() : choice.open())}
    >
      <Icon name="plus" size={16} />
    </button>
  </div>
  {#if choice.custom.length > 0}
    <div class="custom" role="group" aria-labelledby="{id}-label">
      {#each choice.custom as minutes (minutes)}
        <button
          class="press"
          aria-label="Remove {alertLabel(minutes)} before"
          in:fade={arrive()}
          out:fade={depart()}
          onclick={() => void settle(() => choice.toggle(minutes))}
        >
          {alertLabel(minutes)}<Icon name="close" size={12} />
        </button>
      {/each}
    </div>
  {/if}
</div>
{#if choice.typing}
  <PhraseField
    bind:value={choice.phrase}
    {spans}
    placeholder="30 min, 2 hours, 3 days…"
    label="How long before"
    action="Add"
    {result}
    hint={HINTS[typed.kind]}
    onApply={() => void settle(() => choice.apply())}
    onCancel={() => void settle(() => choice.cancel())}
  />
{/if}

<style>
  .presets {
    display: grid;
    grid-template-columns: repeat(4, 1fr) 40px;
    gap: 2px;
    padding: 2px;
    border-radius: 10px;
    background: var(--bg);
    box-shadow: inset 0 0 0 1px var(--edge);
  }

  button {
    height: 32px;
    border-radius: 8px;
    color: var(--ink-2);
    font-size: 13.5px;
    font-weight: 500;
  }

  .presets button {
    display: grid;
    place-items: center;
  }

  .custom {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .custom button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px 0 12px;
  }

  [aria-pressed='true'],
  [aria-expanded='true'],
  .custom button {
    background: var(--on);
    color: var(--on-ink);
    font-weight: 600;
  }
</style>
