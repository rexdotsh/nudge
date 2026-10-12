<script lang="ts">
  import { LIMITS } from '../../shared/input';
  import { parseQuickAdd, suggestedStart } from '../../shared/quick-add';
  import { local } from '../../shared/reminder';
  import type { SpanKind } from '../../shared/scanner';
  import { toInstant } from '../../shared/time';
  import { add } from '../lib/actions';
  import { app } from '../lib/app.svelte';
  import { repeatLabel, whenLabel } from '../lib/format';
  import Icon from './Icon.svelte';

  let { autofocus = false }: { autofocus?: boolean } = $props();

  let text = $state('');
  let input: HTMLInputElement | undefined = $state();
  let mirror: HTMLDivElement | undefined = $state();
  let keyboard = $state(0);

  const parsed = $derived(text.trim() === '' ? null : parseQuickAdd(text, app.now, app.zone));
  const segments = $derived.by(() => {
    const parts: { text: string; kind: SpanKind | null }[] = [];
    let cursor = 0;
    for (const span of parsed?.spans ?? []) {
      if (span.start > cursor) parts.push({ text: text.slice(cursor, span.start), kind: null });
      parts.push({ text: text.slice(span.start, span.end), kind: span.kind });
      cursor = span.end;
    }
    parts.push({ text: text.slice(cursor), kind: null });
    return parts;
  });
  const start = $derived(parsed ? (parsed.start ?? suggestedStart(app.now, app.zone)) : null);
  const when = $derived(start ? whenLabel(toInstant(local(start), app.zone), app.now, app.zone) : null);
  const cadence = $derived(parsed?.repeat && start ? repeatLabel(parsed.repeat, start, app.zone) : null);
  const preview = $derived(
    [cadence ? `repeats ${cadence.toLowerCase()}` : null, parsed?.important ? 'important' : null]
      .filter((part) => part !== null)
      .join(' · '),
  );

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (await add(text)) text = '';
    input?.focus();
  }

  function syncScroll() {
    if (mirror && input) mirror.scrollLeft = input.scrollLeft;
  }

  $effect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => (keyboard = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop));
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  });

  $effect(() => {
    if (autofocus) input?.focus();
  });

  function focusShortcut(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      input?.focus();
    }
  }
</script>

<svelte:window onkeydown={focusShortcut} />

<form class="composer" style:--keyboard="{keyboard}px" onsubmit={submit}>
  <div class="bar">
    <div class="entry">
      <div class="mirror" bind:this={mirror} aria-hidden="true">
        {#each segments as segment, index (index)}<span class={segment.kind ?? undefined}>{segment.text}</span>{/each}
      </div>
      <input
        bind:this={input}
        bind:value={text}
        onscroll={syncScroll}
        oninput={syncScroll}
        placeholder="Remind me to…"
        maxlength={LIMITS.title}
        aria-label="New reminder"
        aria-describedby="composer-preview"
        autocomplete="off"
        enterkeyhint="done"
        spellcheck="true"
      />
    </div>
    {#if parsed?.title}
      <button class="send" type="submit" aria-label="Add reminder"><Icon name="up" size={16} /></button>
    {:else}
      <kbd>{app.platform === 'mac' ? '⌘K' : 'Ctrl K'}</kbd>
    {/if}
  </div>
  <p id="composer-preview" class="preview" aria-live="polite" hidden={!parsed?.title}>
    <b>{when}</b>{preview ? ` · ${preview}` : ''}
  </p>
</form>

<style>
  .composer {
    position: fixed;
    left: 12px;
    right: 12px;
    bottom: calc(14px + env(safe-area-inset-bottom));
    z-index: 20;
    max-width: 536px;
    margin: 0 auto;
    border-radius: 18px;
    background: var(--surface);
    box-shadow:
      inset 0 0 0 1px var(--edge),
      0 -16px 32px 12px var(--bg);
    translate: 0 calc(-1 * var(--keyboard));
    transition: translate 0.25s var(--ease);
  }

  .composer:focus-within {
    box-shadow:
      inset 0 0 0 1px var(--faint),
      0 -16px 32px 12px var(--bg);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 0 8px 0 16px;
  }

  .entry {
    position: relative;
    flex: 1;
    min-width: 0;
  }

  .entry input,
  .mirror {
    width: 100%;
    padding: 0;
    font: 400 16px/22px var(--font);
    letter-spacing: normal;
    white-space: pre;
  }

  .entry input {
    position: relative;
    border: 0;
    outline: 0;
    background: transparent;
    color: transparent;
    caret-color: var(--accent);
  }

  .entry input::placeholder {
    color: var(--muted);
  }

  .mirror {
    position: absolute;
    inset: 0;
    overflow: hidden;
    color: var(--ink);
    pointer-events: none;
  }

  .mirror span.when,
  .mirror span.repeat,
  .mirror span.flag {
    color: var(--accent);
  }

  .send {
    flex: none;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--ink);
    color: var(--bg);
    animation: pop 0.2s var(--spring);
  }

  kbd {
    display: none;
    padding: 2px 6px;
    border-radius: 5px;
    background: var(--raised);
    color: var(--muted);
    font: 500 11px var(--font);
  }

  .preview {
    margin: 0 16px;
    padding: 8px 0 11px;
    overflow: hidden;
    border-top: 1px solid var(--edge);
    color: var(--ink-2);
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview b {
    color: var(--accent);
    font-weight: 600;
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.6);
    }
  }

  @media (min-width: 720px) {
    .composer {
      position: static;
      max-width: none;
      margin: 0 0 18px;
      box-shadow: inset 0 0 0 1px var(--edge);
      translate: none;
    }

    .composer:focus-within {
      box-shadow: inset 0 0 0 1px var(--faint);
    }

    kbd {
      display: block;
    }
  }
</style>
