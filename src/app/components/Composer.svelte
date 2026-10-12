<script lang="ts">
  import { LIMITS } from '../../shared/input';
  import { parseQuickAdd, suggestedStart } from '../../shared/quick-add';
  import { local } from '../../shared/reminder';
  import type { SpanKind } from '../../shared/scanner';
  import { toInstant } from '../../shared/time';
  import { add } from '../lib/actions';
  import { app } from '../lib/app.svelte';
  import { repeatLabel, summaryWhen } from '../lib/format';
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
  const when = $derived(start ? summaryWhen(toInstant(local(start), app.zone), app.now, app.zone) : '');
  const cadence = $derived(parsed?.repeat && start ? repeatLabel(parsed.repeat, start, app.zone) : null);
  const important = $derived(parsed?.important ?? false);
  const detail = $derived(cadence ?? (important ? 'Important' : null));
  const summary = $derived([when, cadence, important ? 'important' : null].filter(Boolean).join(', '));

  const HOLD_MS = 450;
  let holding: ReturnType<typeof setTimeout> | undefined;
  let revealed = $state(false);

  // Touch has no tooltips, so pressing and holding the summary shows all of it instead of adding the reminder.
  function hold(event: PointerEvent) {
    if (event.pointerType === 'mouse') return;
    holding = setTimeout(() => (revealed = true), HOLD_MS);
  }

  function release() {
    clearTimeout(holding);
  }

  function click(event: MouseEvent) {
    if (!revealed) return;
    event.preventDefault();
    revealed = false;
  }

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

<form class="surface composer" style:--keyboard="{keyboard}px" onsubmit={submit}>
  <div class="bar">
    <div class="entry">
      <div class="mirror" bind:this={mirror} aria-hidden="true">
        {#each segments as segment, index (index)}<span class={segment.kind ?? undefined}>{segment.text}</span>{/each}
      </div>
      <input
        class="bare"
        bind:this={input}
        bind:value={text}
        onscroll={syncScroll}
        oninput={syncScroll}
        placeholder="Remind me to…"
        maxlength={LIMITS.title}
        aria-label="New reminder"
        autocomplete="off"
        enterkeyhint="done"
        spellcheck="true"
      />
    </div>
    {#if parsed?.title}
      <button
        class="summary"
        type="submit"
        title={[when, detail].filter(Boolean).join('\n')}
        aria-label={`Add, ${summary}`}
        onpointerdown={hold}
        onpointerup={release}
        onpointercancel={release}
        onpointerleave={release}
        oncontextmenu={(event) => event.preventDefault()}
        onclick={click}
      >
        <span class="what">
          <span class="at">{when}</span>
          {#if detail}
            <span class="rule"
              >{#if important}<b aria-hidden="true">!</b>{/if}{cadence ?? 'Important'}</span
            >
          {/if}
        </span>
        <span class="go"><Icon name="up" size={15} /></span>
      </button>
      {#if revealed}
        <p class="full" role="status">
          <b>{when}</b>{#if detail}<br />{important && cadence ? '! ' : ''}{detail}{/if}
        </p>
      {/if}
    {:else}
      <kbd>{app.platform === 'mac' ? '⌘K' : 'Ctrl K'}</kbd>
    {/if}
  </div>
  <p class="sr-only" aria-live="polite">{parsed?.title ? summary : ''}</p>
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
    --surface-lift: 0 -16px 32px 12px var(--bg);
    translate: 0 calc(-1 * var(--keyboard));
    transition: translate 0.25s var(--ease);
  }

  .composer:focus-within {
    --surface-edge: var(--faint);
  }

  .bar {
    position: relative;
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
    color: transparent;
    caret-color: var(--ink);
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

  .summary {
    flex: none;
    max-width: 64%;
    height: 40px;
    display: inline-flex;
    align-items: center;
    gap: 12px;
    padding: 0 4px 0 14px;
    border-radius: 999px;
    background: var(--raised);
    box-shadow: inset 0 0 0 1px var(--edge);
    color: var(--ink);
    white-space: nowrap;
    text-align: left;
    -webkit-touch-callout: none;
    user-select: none;
    animation: pop 0.2s var(--spring);
  }

  .what {
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    line-height: 1.15;
  }

  .at,
  .rule {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .at {
    font-size: 13.5px;
    font-weight: 600;
  }

  .rule {
    color: var(--muted);
    font-size: 11.5px;
  }

  .rule b {
    margin-right: 4px;
    color: var(--accent);
    font-weight: 700;
  }

  .go {
    flex: none;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--ink);
    color: var(--bg);
  }

  .full {
    position: absolute;
    right: 8px;
    bottom: calc(100% + 8px);
    max-width: calc(100% - 16px);
    margin: 0;
    padding: 9px 12px;
    border-radius: 12px;
    background: var(--raised);
    box-shadow: inset 0 0 0 1px var(--edge);
    color: var(--ink-2);
    font-size: 13px;
    animation: pop 0.15s var(--ease);
  }

  .full b {
    color: var(--ink);
    font-weight: 600;
  }

  kbd {
    display: none;
    padding: 2px 6px;
    border-radius: 5px;
    background: var(--raised);
    color: var(--muted);
    font: 500 11px var(--font);
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
      --surface-lift: 0 0 transparent;
      translate: none;
    }

    kbd {
      display: block;
    }
  }
</style>
