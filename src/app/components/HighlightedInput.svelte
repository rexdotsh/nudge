<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import type { Span } from '../../shared/scanner';

  let {
    value = $bindable(),
    spans,
    placeholder,
    input = $bindable(),
    lift = 0,
    ...rest
  }: {
    value: string;
    spans: readonly Span[];
    placeholder: string;
    input?: HTMLInputElement;
    /** How far the input is lifted out of sight, so the mirror stands in for it. */
    lift?: number;
  } & Omit<HTMLInputAttributes, 'value' | 'placeholder'> = $props();

  let mirror: HTMLDivElement | undefined = $state();

  const segments = $derived.by(() => {
    const parts: { text: string; understood: boolean }[] = [];
    let cursor = 0;
    for (const span of spans) {
      if (span.start > cursor) parts.push({ text: value.slice(cursor, span.start), understood: false });
      parts.push({ text: value.slice(span.start, span.end), understood: true });
      cursor = span.end;
    }
    parts.push({ text: value.slice(cursor), understood: false });
    return parts;
  });

  function syncScroll() {
    if (mirror && input) mirror.scrollLeft = input.scrollLeft;
  }
</script>

<div class="highlighted">
  <!-- The mirror keeps whitespace, so nothing may sit between its tags. -->
  <div class="mirror" bind:this={mirror} aria-hidden="true">
    {#if lift !== 0 && value === ''}<span class="hint">{placeholder}</span
      >{/if}{#each segments as segment, index (index)}<span class:understood={segment.understood}>{segment.text}</span
      >{/each}
  </div>
  <input
    {...rest}
    class="bare"
    bind:this={input}
    bind:value
    class:lifted={lift !== 0}
    style:translate={lift === 0 ? undefined : `0 ${-lift}px`}
    onscroll={syncScroll}
    oninput={syncScroll}
    {placeholder}
    autocomplete="off"
  />
</div>

<style>
  .highlighted {
    position: relative;
  }

  input,
  .mirror {
    width: 100%;
    padding: 0;
    font: 400 16px/22px var(--font);
    letter-spacing: normal;
    white-space: pre;
  }

  input {
    position: relative;
    color: transparent;
    caret-color: var(--ink);
  }

  input.lifted {
    opacity: 0;
  }

  .mirror {
    position: absolute;
    inset: 0;
    overflow: hidden;
    color: var(--ink);
    pointer-events: none;
  }

  .hint {
    color: var(--muted);
  }

  .understood {
    color: var(--accent);
  }
</style>
