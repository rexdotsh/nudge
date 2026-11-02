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
  import ComposerSummary from './ComposerSummary.svelte';

  let { autofocus = false }: { autofocus?: boolean } = $props();

  const LIFTED_TOP = 72;
  const SETTLE_MS = 900;

  let input: HTMLInputElement | undefined = $state();
  let focused = $state(false);
  let lift = $state(0);

  const parsed = $derived(ui.composing.trim() === '' ? null : parseQuickAdd(ui.composing, app.now, app.zone));
  const start = $derived(parsed ? (parsed.start ?? suggestedStart(app.now, app.zone)) : null);
  const when = $derived(start ? summaryWhen(toInstant(local(start), app.zone), app.now, app.zone) : '');
  const cadence = $derived(parsed?.repeat && start ? repeatLabel(parsed.repeat, start, app.zone) : null);
  const important = $derived(parsed?.important ?? false);
  const summary = $derived([when, cadence, important ? 'important' : null].filter(Boolean).join(', '));

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (await add(ui.composing)) ui.composing = '';
    input?.focus();
  }

  // iOS lays its keyboard over the page instead of shrinking it, so while the composer has focus it rises by however
  // much of the screen the keyboard covers. Nothing is kept once focus leaves, so a missed event can't strand it.
  $effect(() => {
    const viewport = window.visualViewport;
    if (!focused || !viewport) return;
    const root = document.documentElement.style;
    const stop = new AbortController();
    let frame = 0;
    const measure = () => {
      const keyboard = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      root.setProperty('--keyboard', `${keyboard}px`);
      if (keyboard > 0) settle();
    };
    // iOS can skip the last event of the keyboard's animation, so each one is read again on the next frame.
    const update = () => {
      measure();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    update();
    const options = { signal: stop.signal };
    viewport.addEventListener('resize', update, options);
    viewport.addEventListener('scroll', update, options);
    window.addEventListener('resize', update, options);
    window.addEventListener('pageshow', update, options);
    document.addEventListener('visibilitychange', update, options);
    return () => {
      stop.abort();
      cancelAnimationFrame(frame);
      root.removeProperty('--keyboard');
    };
  });

  // Lift the iOS input before focus so Safari has no reason to pan; the mirror stays in place until the keyboard opens.
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
    return () => clearTimeout(timer);
  });

  $effect(() => {
    if (autofocus) input?.focus();
  });
</script>

<form class="surface composer" onsubmit={submit}>
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
        onfocus={() => (focused = true)}
        onblur={() => {
          focused = false;
          settle();
        }}
        placeholder="Remind me to…"
        maxlength={LIMITS.title}
        aria-label="New reminder"
        enterkeyhint="done"
        spellcheck="true"
      />
    </div>
    {#if parsed?.title}
      <ComposerSummary {when} {cadence} {important} {summary} />
    {:else}
      <kbd>{hint(NEW_REMINDER)}</kbd>
    {/if}
  </div>
  <p class="sr-only" aria-live="polite">{parsed?.title ? summary : ''}</p>
</form>

<style>
  .composer {
    position: fixed;
    left: 12px;
    right: 12px;
    bottom: var(--dock);
    z-index: 20;
    max-width: 536px;
    margin: 0 auto;
    border-radius: 18px;
    --surface-lift: 0 -16px 32px 12px var(--bg);
    transition: translate var(--base) var(--ease);
  }

  /* It keeps up with the keyboard without easing, so the field is never left under the keys, and eases only back down. */
  .composer:focus-within {
    --surface-edge: var(--faint);
    translate: 0 var(--raise);
    transition: none;
  }

  .bar {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: var(--dock-height);
    padding: 0 8px 0 16px;
  }

  .entry {
    position: relative;
    flex: 1;
    min-width: 0;
  }

  kbd {
    display: none;
    color: var(--muted);
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
