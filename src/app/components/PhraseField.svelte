<script lang="ts">
  import type { Span } from '../../shared/scanner';
  import { composing } from '../lib/shortcuts';
  import HighlightedInput from './HighlightedInput.svelte';

  let {
    value = $bindable(),
    spans,
    placeholder,
    label,
    action,
    result,
    hint,
    onApply,
    onCancel,
  }: {
    value: string;
    spans: readonly Span[];
    placeholder: string;
    label: string;
    action: string;
    /** What the phrase will become, or null when it cannot be applied and the hint says why. */
    result: string | null;
    hint: string;
    onApply: () => void;
    onCancel: () => void;
  } = $props();

  const id = $props.id();

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (result !== null) onApply();
  }

  function escape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || composing(event)) return;
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  }
</script>

<form class="field stacked" onsubmit={submit}>
  <div class="typed">
    <HighlightedInput
      {@attach (node) => node.focus()}
      bind:value
      {spans}
      {placeholder}
      aria-label={label}
      aria-describedby="{id}-result"
      enterkeyhint="done"
      onkeydown={escape}
    />
    <button class="link" type="submit" disabled={result === null}>{action}</button>
  </div>
  <small id="{id}-result" aria-live="polite" hidden={value.trim() === ''}>
    {#if result !== null}<span class="result">{result}</span>{:else}{hint}{/if}
  </small>
</form>

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
