<script lang="ts">
  import { describeRepeat } from '../../shared/describe';
  import { parseQuickAdd, suggestedStart, type SpanKind } from '../../shared/quick-add';
  import { local } from '../../shared/reminder';
  import { toInstant } from '../../shared/time';
  import { add } from '../lib/actions';
  import { app } from '../lib/app.svelte';
  import { whenLabel } from '../lib/format';
  import Icon from './Icon.svelte';

  let { floating = false }: { floating?: boolean } = $props();

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
  const cadence = $derived(
    parsed?.repeat && start
      ? describeRepeat(parsed.repeat, local(start), { locale: navigator.language, zone: app.zone, time: false })
      : null,
  );

  const QUICK = [
    { label: 'In 1 hour', text: 'in 1 hour' },
    { label: 'Tonight', text: 'tonight' },
    { label: 'Tomorrow', text: 'tomorrow 9am' },
    { label: 'Weekend', text: 'this weekend' },
    { label: 'Every day', text: 'every day' },
    { label: 'Important', text: '!' },
  ];

  function append(fragment: string) {
    text = `${text.trimEnd()} ${fragment} `.trimStart();
    input?.focus();
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
    if (!floating || !viewport) return;
    const update = () => (keyboard = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop));
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  });

  function focusShortcut(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      input?.focus();
    }
  }
</script>

<svelte:window onkeydown={focusShortcut} />

<div class="composer" class:floating style:--keyboard="{keyboard}px">
  {#if parsed}
    <div class="understood" aria-live="polite">
      <span class="chip when"><Icon name="clock" size={14} />{when}</span>
      {#if cadence}<span class="chip"><Icon name="repeat" size={14} />{cadence}</span>{/if}
      {#if parsed.important}<span class="chip important"><Icon name="star" size={14} filled />Important</span>{/if}
    </div>
  {/if}
  <form class="bar glass" onsubmit={submit}>
    <div class="field">
      <div class="mirror" bind:this={mirror} aria-hidden="true">
        {#each segments as segment, index (index)}<span class={segment.kind ?? undefined}>{segment.text}</span>{/each}
      </div>
      <input
        bind:this={input}
        bind:value={text}
        onscroll={syncScroll}
        oninput={syncScroll}
        placeholder="New reminder"
        aria-label="New reminder"
        autocomplete="off"
        enterkeyhint="done"
        spellcheck="true"
      />
    </div>
    <button class="send" type="submit" disabled={!parsed?.title} aria-label="Add reminder">
      <Icon name="up" size={18} />
    </button>
  </form>
  <div class="quick" role="group" aria-label="Quick times">
    {#each QUICK as option (option.label)}
      <button type="button" onclick={() => append(option.text)}>{option.label}</button>
    {/each}
  </div>
</div>

<style>
  .composer {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .floating {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    translate: 0 calc(-1 * var(--keyboard));
    z-index: 20;
    padding: 18px 12px calc(10px + env(safe-area-inset-bottom));
    background: linear-gradient(to bottom, transparent, var(--bg) 26px);
    transition: translate 0.25s var(--ease);
  }

  .understood {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 0 4px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 500;
    background: var(--surface);
    color: var(--label-2);
    box-shadow: inset 0 0 0 0.5px var(--separator);
    animation: rise 0.22s var(--spring);
  }

  .chip.when {
    background: var(--label);
    color: var(--bg);
  }

  .chip.important {
    color: var(--brand);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 18px;
    border-radius: 28px;
  }

  .field {
    position: relative;
    flex: 1;
    min-width: 0;
  }

  .field input,
  .mirror {
    width: 100%;
    padding: 8px 0;
    font-size: 17px;
    line-height: 22px;
    letter-spacing: normal;
    white-space: pre;
  }

  .field input {
    position: relative;
    border: 0;
    outline: 0;
    background: transparent;
    color: transparent;
    caret-color: var(--brand);
  }

  .field input::placeholder {
    color: var(--label-3);
  }

  .mirror {
    position: absolute;
    inset: 0;
    overflow: hidden;
    color: var(--label);
    pointer-events: none;
  }

  .mirror span.when,
  .mirror span.repeat {
    color: var(--brand);
    background: var(--brand-soft);
    border-radius: 5px;
    box-shadow: 0 0 0 2px var(--brand-soft);
  }

  .mirror span.flag {
    color: var(--brand);
    font-weight: 700;
  }

  .send {
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--brand-fill);
    color: #fff;
    transition:
      transform 0.2s var(--spring),
      opacity 0.2s;
  }

  .send:disabled {
    opacity: 0.35;
    transform: scale(0.88);
    cursor: default;
  }

  .quick {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding: 0 2px;
    scrollbar-width: none;
  }

  .quick::-webkit-scrollbar {
    display: none;
  }

  .quick button {
    flex: none;
    padding: 7px 13px;
    border-radius: 999px;
    font-size: 14px;
    font-weight: 500;
    background: var(--fill);
    color: var(--label);
  }

  .quick button:active {
    transform: scale(0.96);
  }

  :global([data-platform='windows']) .bar {
    border-radius: 8px;
    padding: 4px 4px 4px 14px;
    box-shadow:
      inset 0 0 0 1px var(--separator),
      inset 0 -2px 0 var(--brand);
    background: var(--surface-raised);
  }

  :global([data-platform='windows']) .field input,
  :global([data-platform='windows']) .mirror {
    font-size: 15px;
    padding: 6px 0;
  }

  :global([data-platform='windows']) .send {
    width: 32px;
    height: 32px;
    border-radius: 6px;
  }

  :global([data-platform='windows']) .quick button {
    border-radius: 6px;
    padding: 5px 11px;
    font-size: 13px;
    box-shadow: inset 0 0 0 1px var(--separator);
    background: var(--surface);
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px) scale(0.96);
    }
  }
</style>
