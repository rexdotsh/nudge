<script lang="ts">
  import { LIMITS } from '../../shared/input';
  import { parseQuickAdd, suggestedStart } from '../../shared/quick-add';
  import { local } from '../../shared/reminder';
  import { toInstant } from '../../shared/time';
  import { add } from '../lib/actions';
  import { NEW_REMINDER, hint } from '../lib/shortcuts';
  import { app } from '../lib/app.svelte';
  import { repeatLabel, summaryWhen } from '../lib/format';
  import { ui } from '../lib/ui.svelte';
  import HighlightedInput from './HighlightedInput.svelte';
  import Icon from './Icon.svelte';

  let { autofocus = false }: { autofocus?: boolean } = $props();

  const LIFTED_TOP = 72;
  const SETTLE_MS = 900;

  let input: HTMLInputElement | undefined = $state();
  let visibleBottom = $state(window.innerHeight);
  let lift = $state(0);

  const parsed = $derived(ui.composing.trim() === '' ? null : parseQuickAdd(ui.composing, app.now, app.zone));
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

  function cancel() {
    clearTimeout(holding);
    revealed = false;
  }

  function click(event: MouseEvent) {
    if (!revealed) return;
    event.preventDefault();
    revealed = false;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (await add(ui.composing)) ui.composing = '';
    input?.focus();
  }

  // iOS never shrinks the layout for the keyboard; it pans the page up to reveal the focused field. The composer is
  // placed against the bottom of what is visible instead, and the pan is undone so the list stays where it was.
  $effect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      if (document.activeElement === input && viewport.offsetTop > 0) window.scrollTo(0, 0);
      visibleBottom = viewport.offsetTop + viewport.height;
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  });

  // iOS slides the whole page up when a field the keyboard is about to cover takes focus. When a touch is about to focus
  // the composer, its input is lifted, invisibly, near the top of the screen so there is nothing to reveal, and it
  // settles back once the keyboard is up and the composer has risen above it.
  function liftForKeyboard(event: PointerEvent) {
    if (app.platform !== 'ios' || event.pointerType !== 'touch' || !input || document.activeElement === input) return;
    lift = input.getBoundingClientRect().top - LIFTED_TOP;
  }

  function focusLifted() {
    if (lift !== 0) input?.focus({ preventScroll: true });
  }

  function settle() {
    lift = 0;
  }

  $effect(() => {
    if (lift === 0) return;
    const timer = setTimeout(settle, SETTLE_MS);
    window.visualViewport?.addEventListener('resize', settle, { once: true });
    return () => {
      clearTimeout(timer);
      window.visualViewport?.removeEventListener('resize', settle);
    };
  });

  $effect(() => {
    if (autofocus) input?.focus();
  });
</script>

<form class="surface composer" style:--visible-bottom="{visibleBottom}px" onsubmit={submit}>
  <div class="bar">
    <div
      class="entry"
      role="presentation"
      onpointerdown={liftForKeyboard}
      onpointercancel={settle}
      onclick={focusLifted}
    >
      <HighlightedInput
        id="composer"
        bind:input
        bind:value={ui.composing}
        spans={parsed?.spans ?? []}
        {lift}
        onblur={settle}
        placeholder="Remind me to…"
        maxlength={LIMITS.title}
        aria-label="New reminder"
        enterkeyhint="done"
        spellcheck="true"
      />
    </div>
    {#if parsed?.title}
      <button
        class="summary press"
        type="submit"
        title={[when, detail].filter(Boolean).join('\n')}
        aria-label={`Add, ${summary}`}
        onpointerdown={hold}
        onpointerup={release}
        onpointercancel={cancel}
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
      <kbd>{hint(NEW_REMINDER)}</kbd>
    {/if}
  </div>
  <p class="sr-only" aria-live="polite">{parsed?.title ? summary : ''}</p>
</form>

<style>
  .composer {
    position: fixed;
    top: 0;
    left: 12px;
    right: 12px;
    z-index: 20;
    max-width: 536px;
    margin: 0 auto;
    border-radius: 18px;
    --gap: max(12px, env(safe-area-inset-bottom));
    --surface-lift: 0 -16px 32px 12px var(--bg);
    translate: 0 calc(var(--visible-bottom) - 100% - var(--gap));
    transition: translate 0.25s var(--ease);
  }

  /* Above the keyboard the home indicator's inset no longer applies, so the composer rides 8px over the keys. */
  .composer:focus-within {
    --surface-edge: var(--faint);
    --gap: 8px;
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
    animation: pop var(--base) var(--spring);
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
    background: var(--on);
    color: var(--on-ink);
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
    animation: pop var(--fast) var(--ease);
  }

  .full b {
    color: var(--ink);
    font-weight: 600;
  }

  kbd {
    display: none;
    color: var(--muted);
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.6);
    }
  }

  @media (min-width: 720px) {
    .composer,
    .composer:focus-within {
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
